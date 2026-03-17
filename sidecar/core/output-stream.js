/**
 * OutputStreamManager — stream worker output via Unix sockets (fast) or file tailing (fallback).
 *
 * Priority chain:
 *   1. Unix socket at /tmp/claude-worker-{taskId}.sock (~5ms latency)
 *   2. fs.watch() on result file (~50-100ms latency)
 *   3. fs.watchFile() polling at 150ms (~150-300ms latency)
 *
 * Workers write to ~/.claude/terminals/results/{taskId}.txt.
 * When the output-forwarder is active, it also streams to a Unix domain socket.
 * We prefer the socket when available (real-time, no file I/O in critical path).
 */

import fs from "fs";
import net from "net";
import EventEmitter from "events";

const RING_BUFFER_SIZE = 200;
const MAX_WATCHERS = 20;
const POLL_INTERVAL_MS = 150; // fs.watchFile fallback polling interval
const SOCKET_RETRY_MS = 500; // retry socket connection after this delay
const SOCKET_MAX_RETRIES = 10; // stop trying socket after this many failures

export class OutputStreamManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, { watcher: fs.FSWatcher | null, pollStat: ReturnType<typeof fs.watchFile> | null, socket: net.Socket | null, socketRetries: number, socketTimer: ReturnType<typeof setTimeout> | null, offset: number, buffer: string[], partial: string, filePath: string, workerName: string }>} */
    this.workers = new Map();
  }

  /**
   * Start watching a result file for a task.
   * Tries Unix socket first; falls back to file watching.
   * Safe to call multiple times — idempotent if already watching.
   */
  startWatching(taskId, filePath, workerName = taskId) {
    if (this.workers.has(taskId)) return;
    if (this.workers.size >= MAX_WATCHERS) {
      // Oldest entry falls back to polling; we still track it
      // but don't open another native watcher
    }

    const entry = {
      watcher: null,
      pollStat: null,
      socket: null,
      socketRetries: 0,
      socketTimer: null,
      offset: 0,
      buffer: [],
      partial: "", // incomplete line buffer for socket streaming
      filePath,
      workerName,
    };
    this.workers.set(taskId, entry);

    // Try socket first (if it exists on disk), fall back to file watching.
    // Synchronous existence check avoids async delays for the common case
    // where no forwarder is running and no socket exists.
    const socketPath = `/tmp/claude-worker-${taskId}.sock`;
    try {
      if (fs.existsSync(socketPath)) {
        this._trySocket(taskId, entry);
        return;
      }
    } catch {}
    // No socket — go straight to file watching
    this._attachWatcher(taskId, entry);
  }

  /**
   * Attempt to connect to the worker's Unix domain socket.
   * If the socket doesn't exist yet (worker hasn't started), retry a few times
   * then fall back to file watching.
   */
  _trySocket(taskId, entry) {
    const socketPath = `/tmp/claude-worker-${taskId}.sock`;

    const conn = net.createConnection(socketPath, () => {
      // Connected — socket is the primary source now
      entry.socket = conn;
      entry.socketRetries = 0;
    });

    conn.on("data", (chunk) => {
      this._processSocketData(taskId, entry, chunk.toString("utf-8"));
    });

    conn.on("error", () => {
      // Socket not available — retry or fall back
      entry.socket = null;
      entry.socketRetries++;
      if (entry.socketRetries < SOCKET_MAX_RETRIES) {
        entry.socketTimer = setTimeout(
          () => this._trySocket(taskId, entry),
          SOCKET_RETRY_MS,
        );
      } else {
        // Max retries — fall back to file watching permanently
        this._attachWatcher(taskId, entry);
      }
    });

    conn.on("close", () => {
      entry.socket = null;
      // Worker may have finished — don't retry, file watcher will handle cleanup
      // But do attach file watcher as fallback if not already watching
      if (!entry.watcher && !entry.pollStat) {
        this._attachWatcher(taskId, entry);
      }
    });
  }

  /**
   * Process raw data from socket stream into lines and emit events.
   */
  _processSocketData(taskId, entry, data) {
    // Prepend any partial line from previous chunk
    const text = entry.partial + data;
    const lines = text.split("\n");

    // Last element is either empty (if data ended with \n) or a partial line
    entry.partial = lines.pop() || "";

    if (lines.length === 0) return;

    // Append to ring buffer
    for (const l of lines) entry.buffer.push(l);
    if (entry.buffer.length > RING_BUFFER_SIZE) {
      entry.buffer = entry.buffer.slice(entry.buffer.length - RING_BUFFER_SIZE);
    }

    this.emit("output", {
      task_id: taskId,
      worker_name: entry.workerName,
      lines,
      total_lines: entry.buffer.length,
      timestamp: new Date().toISOString(),
    });
  }

  _attachWatcher(taskId, entry) {
    // Skip if already watching via file or socket is active
    if (entry.watcher || entry.pollStat) return;
    if (entry.socket) return;

    // Try native fs.watch first; fall back to fs.watchFile polling on unreliable macOS
    try {
      const watcher = fs.watch(
        entry.filePath,
        { persistent: false },
        (eventType) => {
          if (eventType === "change") this._readDelta(taskId, entry);
        },
      );
      watcher.on("error", () => {
        // Native watcher failed — switch to polling
        try {
          watcher.close();
        } catch {}
        entry.watcher = null;
        this._attachPollWatcher(taskId, entry);
      });
      entry.watcher = watcher;
      // Read whatever already exists on initial attach
      this._readDelta(taskId, entry);
    } catch {
      // File may not exist yet; fall back to polling which handles creation
      this._attachPollWatcher(taskId, entry);
    }
  }

  _attachPollWatcher(taskId, entry) {
    if (entry.pollStat) return;
    const listener = () => this._readDelta(taskId, entry);
    fs.watchFile(
      entry.filePath,
      { persistent: false, interval: POLL_INTERVAL_MS },
      listener,
    );
    // Store a reference so we can remove it later
    entry.pollStat = listener;
    // Attempt initial read
    this._readDelta(taskId, entry);
  }

  _readDelta(taskId, entry) {
    let stat;
    try {
      stat = fs.statSync(entry.filePath);
    } catch {
      return;
    }
    if (stat.size <= entry.offset) return;

    let newBytes = "";
    try {
      const fd = fs.openSync(entry.filePath, "r");
      const length = stat.size - entry.offset;
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, entry.offset);
      fs.closeSync(fd);
      newBytes = buf.toString("utf-8");
    } catch {
      return;
    }

    entry.offset = stat.size;

    const lines = newBytes.split("\n");
    // Last element may be an incomplete line; keep it for next delta
    // (unless the file ended with \n in which case last element is '')
    const complete =
      lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines.slice(0, -1);
    // Remaining partial line is discarded (acceptable — next read picks it up when complete)

    if (complete.length === 0) return;

    // Append to ring buffer
    for (const l of complete) entry.buffer.push(l);
    if (entry.buffer.length > RING_BUFFER_SIZE) {
      entry.buffer = entry.buffer.slice(entry.buffer.length - RING_BUFFER_SIZE);
    }

    this.emit("output", {
      task_id: taskId,
      worker_name: entry.workerName,
      lines: complete,
      total_lines: entry.buffer.length,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Stop watching a task and free resources.
   */
  stopWatching(taskId) {
    const entry = this.workers.get(taskId);
    if (!entry) return;
    if (entry.watcher) {
      try {
        entry.watcher.close();
      } catch {}
    }
    if (entry.pollStat) {
      try {
        fs.unwatchFile(entry.filePath, entry.pollStat);
      } catch {}
    }
    if (entry.socket) {
      try {
        entry.socket.destroy();
      } catch {}
    }
    if (entry.socketTimer) {
      clearTimeout(entry.socketTimer);
    }
    this.workers.delete(taskId);
  }

  /**
   * Return buffered lines for a task (instant, no I/O).
   */
  getBuffer(taskId) {
    return this.workers.get(taskId)?.buffer || [];
  }

  /**
   * Register a listener for output events.
   * Callback receives { task_id, worker_name, lines, total_lines, timestamp }.
   */
  onOutput(callback) {
    this.on("output", callback);
  }

  /**
   * Stop all watchers (called on server shutdown).
   */
  stopAll() {
    for (const taskId of [...this.workers.keys()]) this.stopWatching(taskId);
  }
}

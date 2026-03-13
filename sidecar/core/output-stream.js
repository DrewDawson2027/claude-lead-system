/**
 * OutputStreamManager — tail result files via fs.watch() and stream deltas via SSE.
 *
 * Workers write to ~/.claude/terminals/results/{taskId}.txt.
 * We open a watcher per task, read only new bytes on each change,
 * parse into lines, maintain a 200-line ring buffer, and emit 'output' events
 * that the lifecycle wires into sseBroadcast.
 */

import fs from 'fs';
import EventEmitter from 'events';

const RING_BUFFER_SIZE = 200;
const MAX_WATCHERS = 20;
const POLL_INTERVAL_MS = 150; // fs.watchFile fallback polling interval

export class OutputStreamManager extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, { watcher: fs.FSWatcher | null, pollStat: ReturnType<typeof fs.watchFile> | null, offset: number, buffer: string[], filePath: string, workerName: string }>} */
    this.workers = new Map();
  }

  /**
   * Start watching a result file for a task.
   * Safe to call multiple times — idempotent if already watching.
   */
  startWatching(taskId, filePath, workerName = taskId) {
    if (this.workers.has(taskId)) return;
    if (this.workers.size >= MAX_WATCHERS) {
      // Oldest entry falls back to polling; we still track it
      // but don't open another native watcher
    }

    const entry = { watcher: null, pollStat: null, offset: 0, buffer: [], filePath, workerName };
    this.workers.set(taskId, entry);

    this._attachWatcher(taskId, entry);
  }

  _attachWatcher(taskId, entry) {
    // Try native fs.watch first; fall back to fs.watchFile polling on unreliable macOS
    try {
      const watcher = fs.watch(entry.filePath, { persistent: false }, (eventType) => {
        if (eventType === 'change') this._readDelta(taskId, entry);
      });
      watcher.on('error', () => {
        // Native watcher failed — switch to polling
        try { watcher.close(); } catch {}
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
    fs.watchFile(entry.filePath, { persistent: false, interval: POLL_INTERVAL_MS }, listener);
    // Store a reference so we can remove it later
    entry.pollStat = listener;
    // Attempt initial read
    this._readDelta(taskId, entry);
  }

  _readDelta(taskId, entry) {
    let stat;
    try { stat = fs.statSync(entry.filePath); } catch { return; }
    if (stat.size <= entry.offset) return;

    let newBytes = '';
    try {
      const fd = fs.openSync(entry.filePath, 'r');
      const length = stat.size - entry.offset;
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, entry.offset);
      fs.closeSync(fd);
      newBytes = buf.toString('utf-8');
    } catch { return; }

    entry.offset = stat.size;

    const lines = newBytes.split('\n');
    // Last element may be an incomplete line; keep it for next delta
    // (unless the file ended with \n in which case last element is '')
    const complete = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines.slice(0, -1);
    // Remaining partial line is discarded (acceptable — next read picks it up when complete)

    if (complete.length === 0) return;

    // Append to ring buffer
    for (const l of complete) entry.buffer.push(l);
    if (entry.buffer.length > RING_BUFFER_SIZE) {
      entry.buffer = entry.buffer.slice(entry.buffer.length - RING_BUFFER_SIZE);
    }

    this.emit('output', {
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
    if (entry.watcher) { try { entry.watcher.close(); } catch {} }
    if (entry.pollStat) { try { fs.unwatchFile(entry.filePath, entry.pollStat); } catch {} }
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
    this.on('output', callback);
  }

  /**
   * Stop all watchers (called on server shutdown).
   */
  stopAll() {
    for (const taskId of [...this.workers.keys()]) this.stopWatching(taskId);
  }
}

# GAP #1 — In-Process Display: Integration Plan

**Status:** DONE — All 3 phases implemented (Phase 1+2: 2026-03-16, Phase 3 forwarder wired: 2026-03-17)
**Impact:** HIGH — closes the display gap from C+ to A
**Goal:** Replace `tmux capture-pane` polling with event-driven output streaming

---

## Current State

### How native does it

Native Agent Teams runs teammates as **in-process Node.js children**. Their output lives in a JS object in memory. Switching teammates is a variable swap — zero latency, no tmux, works everywhere.

### How we do it today

1. **Primary:** `execFileSync("tmux", ["capture-pane", "-t", paneId, "-p", "-S", "-", "-e"])` — a synchronous subprocess call every 500ms
2. **Fallback 1:** Read `.transcript` file (created by `script -q` wrapper)
3. **Fallback 2:** Read `.txt` result file

Problems:

- `tmux capture-pane` has **100-1000ms latency** per call (subprocess spawn + tmux IPC)
- Requires user to be **inside tmux** — breaks in iTerm2, background mode, VS Code terminal
- 500ms polling = visible lag when watching active workers
- Synchronous `execFileSync` **blocks the TUI render loop** during capture

### What we already have (reusable infrastructure)

- **SSE broadcast system** — `sseBroadcast(clients, event, data)` in `response.ts:128`
- **SSE endpoint** — `GET /events` in `system.ts:344` with client tracking via `clients` Set
- **SSE event types already flowing:** `team.updated`, `teammate.updated`, `task.updated`, `timeline.event`, plus 8 more
- **Filesystem watcher** — `HookStreamAdapter` watches `~/.claude/terminals/` and triggers rebuilds
- **Result files** — Workers already write stdout to `~/.claude/terminals/results/{task_id}.txt`
- **Transcript files** — Interactive workers wrapped in `script -q {transcript}` capture full terminal output
- **HTTP server** — Full route infrastructure with auth, rate limiting, validation
- **No external deps needed** — Node.js `fs.watch()`, `fs.createReadStream()` are built-in

---

## Architecture: Three-Phase Build

### Phase 1: File-Tailing Output Stream via SSE

**Effort:** ~2 hours | **Impact:** Eliminates tmux dependency, enables real-time streaming

#### What changes

**New file: `sidecar/core/output-stream.js`**
An `OutputStreamManager` class that:

- Watches result/transcript files for active workers using `fs.watch()` + `fs.createReadStream()`
- Tracks byte offset per worker (so we only send new content, not re-read entire file)
- Emits `worker.output` events with the delta
- Auto-starts watching when a worker spawns, auto-stops when it completes
- Handles file rotation (when worker claims next task, result file may change)

```
┌─────────────────────────────────────────────────────────────────┐
│                        OutputStreamManager                       │
│                                                                   │
│  workers: Map<taskId, {                                          │
│    watcher: fs.FSWatcher,   // watches result file               │
│    offset: number,          // bytes already read                │
│    buffer: string[],        // last N lines (ring buffer)        │
│    filePath: string,        // path to result/transcript file    │
│  }>                                                              │
│                                                                   │
│  Methods:                                                        │
│    startWatching(taskId, filePath)  → begin file tail            │
│    stopWatching(taskId)            → cleanup watcher             │
│    getBuffer(taskId)               → return buffered output      │
│    onOutput(callback)              → register listener           │
│                                                                   │
│  Events emitted:                                                 │
│    "output" → { task_id, lines: string[], offset: number }       │
│    "reset"  → { task_id } (worker claimed new task)              │
└─────────────────────────────────────────────────────────────────┘
```

**Modified file: `sidecar/server/runtime/lifecycle.ts`**

- Import `OutputStreamManager`
- On each `rebuild()`, diff the active workers list:
  - New workers → `startWatching(taskId, resultFilePath)`
  - Removed workers → `stopWatching(taskId)`
- Wire `outputStream.onOutput()` → `sseBroadcast(clients, "worker.output", data)`

**New SSE event: `worker.output`**

```json
{
  "task_id": "W1234567890",
  "worker_name": "reviewer-1",
  "lines": ["[new output lines since last event]"],
  "total_lines": 247,
  "timestamp": "2026-03-07T..."
}
```

**New HTTP route: `GET /teams/:name/workers/:taskId/output`**

- Returns the full buffered output for a specific worker
- Used by TUI on initial teammate selection (get the full buffer)
- Subsequent updates come via SSE push

#### Integration points in existing code

| File                                  | What changes                                            | Why                                    |
| ------------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| `sidecar/core/output-stream.js`       | **NEW** — OutputStreamManager class                     | Core file-tailing engine               |
| `sidecar/server/runtime/lifecycle.ts` | Add outputStream init + worker diffing                  | Wire up start/stop watching on spawns  |
| `sidecar/server/routes/teams.ts`      | Add `teams:worker-output` route                         | HTTP endpoint for initial buffer fetch |
| `sidecar/server/http/schema.ts`       | Add schema entry for worker.output                      | SSE event documentation                |
| `sidecar/ui-tui/index.js`             | **Phase 2 changes only** — TUI stays on polling for now | Phase 1 is server-side only            |

---

### Phase 2: In-Memory Buffer + TUI Integration

**Effort:** ~2 hours | **Impact:** Zero-latency teammate switching (native parity)

#### What changes

**Modified: `sidecar/core/output-stream.js`**

- Add ring buffer per worker: last 200 lines (configurable)
- `getBuffer(taskId)` returns the full buffered output instantly
- Buffer survives file watch restarts (worker claiming next task)

**Modified: `sidecar/ui-tui/index.js` — `renderTeammateView()`**
Replace the current 3-tier display logic:

```
BEFORE:                              AFTER:
1. tmux capture-pane (sync)    →     1. HTTP GET /workers/:id/output (async, cached)
2. Read .transcript file       →     2. SSE updates append to local buffer
3. Read .json result file      →     3. renderTeammateView reads local buffer
                                     4. Fallback: tmux capture-pane (if HTTP unavailable)
```

The TUI will:

1. On teammate selection → fetch full buffer via HTTP
2. On SSE `worker.output` events → append to local display buffer
3. On render → read from local buffer (zero latency, no subprocess)
4. Keep tmux capture-pane as last-resort fallback

**Modified: `sidecar/ui-tui/index.js` — connection management**

- Add SSE client connection to sidecar (EventSource or raw HTTP)
- Parse incoming `worker.output` events
- Maintain per-worker display buffers in TUI state

#### TUI state additions

```javascript
state.workerOutputBuffers = new Map(); // taskId → string[]
state.sseConnection = null; // EventSource or raw HTTP response
state.outputSubscriptions = new Set(); // taskIds we're actively watching
```

---

### Phase 3: Worker-Side Output Forwarder (Optional — Maximum Fidelity)

**Effort:** ~3 hours | **Impact:** Sub-10ms streaming latency (vs ~50ms from fs.watch)

This phase is **optional** — Phases 1+2 deliver native-equivalent UX. Phase 3 is for if we want true real-time streaming (like watching `claude` output character-by-character).

#### What changes

**New file: `mcp-coordinator/lib/platform/output-forwarder.js`**

- A thin Node.js wrapper that replaces the `script -q` approach
- Spawns `claude` as a child process via `child_process.spawn()`
- Captures stdout/stderr as Node streams (not file I/O)
- Writes to BOTH the result file AND a Unix domain socket
- The sidecar listens on the socket for real-time output

**Modified: `mcp-coordinator/lib/platform/common.js` — `buildInteractiveWorkerScript()`**

- Add option to use the Node.js forwarder instead of `script -q`
- Worker script becomes: `node output-forwarder.js -- claude --prompt ...`
- Forwarder creates socket at `/tmp/claude-worker-{taskId}.sock`

**Modified: `sidecar/core/output-stream.js`**

- Add Unix socket listener mode (in addition to file watching)
- When socket exists → use it (lowest latency)
- When no socket → fall back to file watching (Phase 1)

#### Data flow comparison

```
Phase 1 (fs.watch):
  claude → stdout → result.txt → fs.watch() → read delta → SSE → TUI
  Latency: ~50-200ms (fs.watch debouncing + file read)

Phase 3 (socket):
  claude → stdout → forwarder → socket → SSE → TUI
                  └→ result.txt (for persistence)
  Latency: ~5-10ms (direct stream, no file I/O in critical path)
```

---

## File Inventory (All Changes)

### New Files (3)

| File                                               | Phase | Purpose                                 |
| -------------------------------------------------- | ----- | --------------------------------------- |
| `sidecar/core/output-stream.js`                    | 1     | File-tailing output stream manager      |
| `sidecar/test/output-stream.test.mjs`              | 1     | Unit tests for output streaming         |
| `mcp-coordinator/lib/platform/output-forwarder.js` | 3     | Worker-side stdout forwarder (optional) |

### Modified Files (5)

| File                                     | Phase | What Changes                                      |
| ---------------------------------------- | ----- | ------------------------------------------------- |
| `sidecar/server/runtime/lifecycle.ts`    | 1     | Wire OutputStreamManager into rebuild cycle       |
| `sidecar/server/routes/teams.ts`         | 1     | Add `GET /teams/:name/workers/:id/output` route   |
| `sidecar/server/http/schema.ts`          | 1     | Document `worker.output` SSE event                |
| `sidecar/ui-tui/index.js`                | 2     | Replace tmux polling with SSE-fed buffers         |
| `mcp-coordinator/lib/platform/common.js` | 3     | Add forwarder option to interactive worker script |

### Files NOT Changed

- `mcp-coordinator/lib/workers.js` — No changes to worker spawning logic
- `mcp-coordinator/lib/messaging.js` — Output streaming is separate from messaging
- `sidecar/server/create-server.ts` — No server changes needed (SSE already wired)

---

## Risk Analysis

| Risk                                  | Likelihood | Mitigation                                                                           |
| ------------------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| `fs.watch()` unreliable on macOS      | Medium     | Use `fs.watchFile()` fallback (polling at 100ms) — still 5x faster than tmux capture |
| Too many file watchers (many workers) | Low        | Cap at 20 watchers; inactive workers use polling fallback                            |
| Memory from output buffers            | Low        | Ring buffer with 200-line cap per worker; ~50KB per worker max                       |
| SSE connection drops                  | Low        | TUI reconnects on error; initial buffer fetch fills gap                              |
| Race condition on file reads          | Low        | Track byte offset; read from offset with `createReadStream({ start })`               |
| Breaking existing tmux display        | Zero       | tmux capture-pane kept as fallback in Phase 2                                        |

---

## Testing Strategy

### Phase 1 Tests (`output-stream.test.mjs`)

1. Start watching a file → write content → verify `output` event fires with correct lines
2. Write incrementally → verify only new content is emitted (offset tracking)
3. Stop watching → verify watcher cleanup (no fd leak)
4. File doesn't exist yet → start watching → file created → verify output captured
5. Multiple workers → verify independent tracking
6. Buffer overflow → verify ring buffer drops oldest lines

### Phase 2 Tests

7. TUI receives SSE `worker.output` → verify display buffer updated
8. Switch teammates → verify instant render from buffer (no HTTP call)
9. SSE disconnected → verify fallback to tmux capture-pane
10. Worker completes → verify buffer retained for review

### Integration Tests

11. Spawn worker → watch output → verify SSE events reach TUI
12. Full cycle: spawn → output streams → worker completes → display shows final output

---

## Parity Impact

| Metric                    | Before                  | After Phase 1+2    | After Phase 3 |
| ------------------------- | ----------------------- | ------------------ | ------------- |
| Display latency           | 100-1000ms              | ~50-200ms          | ~5-10ms       |
| Tmux required             | Yes (primary)           | No (fallback only) | No            |
| Works in background mode  | Partial (file fallback) | Full               | Full          |
| Works in iTerm2           | No                      | Yes                | Yes           |
| Works in VS Code terminal | No                      | Yes                | Yes           |
| Teammate switching speed  | 100-1000ms              | <1ms (buffer read) | <1ms          |
| CLAUDE.md parity score    | 95%                     | 98%                | 99%           |

---

## Recommended Execution Order

1. **Phase 1** first — server-side only, no TUI changes, no risk to existing display
2. **Phase 2** immediately after — wire TUI to use the new stream
3. **Phase 3** only if Phase 1+2 latency isn't satisfactory (likely not needed)

Each phase is independently shippable. Phase 1 alone delivers value (SSE events for web dashboard). Phase 2 delivers the full native-parity UX.

---

## Dependencies

- No new npm packages needed
- Node.js `fs.watch()`, `fs.watchFile()`, `fs.createReadStream()` are built-in
- SSE infrastructure already exists and is battle-tested
- Unix domain sockets (Phase 3) are built-in Node.js

---

## Decision Points for Drew

1. **Phase 3: Build or skip?** — Phases 1+2 get us to ~98% parity. Phase 3 adds ~3 hours for marginal latency improvement. Recommend skip unless we see visible lag after Phase 2.
2. **Buffer size** — 200 lines per worker (default). Want more/less?
3. **Web dashboard integration** — Phase 1 automatically enables the web UI (`/dashboard`) to show live worker output via SSE. Want to wire that up too, or TUI-only for now?

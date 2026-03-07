# Compatibility Matrix

Platform, terminal emulator, and runtime support for the claude-lead-system.

## Platform + Terminal Support

| Feature              | macOS (iTerm2) | macOS (Terminal.app) | Linux (gnome-terminal) | Linux (kitty/alacritty) | Linux (tmux) | Windows (Windows Terminal) | Windows (cmd) |
| -------------------- | :------------: | :------------------: | :--------------------: | :---------------------: | :----------: | :------------------------: | :-----------: |
| Worker spawn (tab)   |      Yes       |         Yes          |          Yes           |           Yes           |     Yes      |            Yes             |      No       |
| Worker spawn (split) |      Yes       |          No          |           No           |           No            |     Yes      |             No             |      No       |
| Session wake (Enter) |      Yes       |         Yes          |          Yes           |           Yes           |     Yes      |          Partial           |      No       |
| Hook execution (.sh) |      Yes       |         Yes          |          Yes           |           Yes           |     Yes      |          Git Bash          |   Git Bash    |
| Python hooks         |      Yes       |         Yes          |          Yes           |           Yes           |     Yes      |            Yes             |      Yes      |
| Sidecar dashboard    |      Yes       |         Yes          |          Yes           |           Yes           |     Yes      |            Yes             |      Yes      |
| File locking (flock) |    Fallback    |       Fallback       |          Yes           |           Yes           |     Yes      |           msvcrt           |    msvcrt     |
| Lead tools (.sh)     |      Yes       |         Yes          |          Yes           |           Yes           |     Yes      |          Git Bash          |   Git Bash    |

### Notes

- **macOS flock fallback**: stock macOS lacks `flock`. Hooks use `mkdir`-based locking with auto-expiry (60s).
- **Windows Git Bash**: Shell hooks require Git Bash or WSL. Stock cmd.exe cannot run `.sh` files.
- **Windows session wake**: Partial support via PowerShell `SendKeys`. Stock cmd.exe not supported.
- **Linux tmux splits**: Worker spawn uses `tmux split-window` for split pane support.

## Runtime Version Matrix

Tested in CI (`.github/workflows/ci.yml`):

| Runtime | Tested Versions | Minimum |
| ------- | :-------------: | :-----: |
| Node.js |   18.x, 20.x    |  18.0   |
| Python  |   3.10, 3.11    |  3.10   |

### Node.js Requirements

- `Array.findLastIndex` (Node 18+)
- `AbortSignal.timeout` (Node 18+)
- ES module syntax (`import`/`export`)
- `crypto.randomUUID()` (Node 19+ or with `--experimental-global-webcrypto`)

### Python Requirements

- `fcntl` module (Unix) / `msvcrt` module (Windows)
- `json`, `os`, `sys`, `time` (stdlib)
- No pip packages required for hooks

## CI Platform Matrix

From `.github/workflows/ci.yml` `platform-matrix` job:

| Platform         | Runner           | Status |
| ---------------- | ---------------- | :----: |
| Ubuntu (latest)  | `ubuntu-latest`  | Tested |
| macOS (latest)   | `macos-latest`   | Tested |
| Windows (latest) | `windows-latest` | Tested |

## CI Compatibility Matrix

From `.github/workflows/ci.yml` `compatibility-matrix` job:

| Node.js | Python | Status |
| :-----: | :----: | :----: |
|   18    |  3.10  | Tested |
|   18    |  3.11  | Tested |
|   20    |  3.10  | Tested |
|   20    |  3.11  | Tested |

## Feature Support by Install Mode

| Feature          |     lite     | hybrid | full |
| ---------------- | :----------: | :----: | :--: |
| Sidecar server   |     Yes      |  Yes   | Yes  |
| MCP coordinator  |     Yes      |  Yes   | Yes  |
| Commands         |     Yes      |  Yes   | Yes  |
| Agents + modes   |     Yes      |  Yes   | Yes  |
| Shell hooks      |      No      |  Yes   | Yes  |
| Python hooks     |      No      |  Yes   | Yes  |
| Settings merge   |     Yes      |  Yes   | Yes  |
| Health check     | Sidecar-only |  Full  | Full |
| Policy templates |      No      |   No   | Yes  |

## References

- `.github/workflows/ci.yml` — CI job definitions
- `install.sh` — Install mode documentation
- `docs/KNOWN_LIMITATIONS.md` — Platform-specific limitations

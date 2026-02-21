# POSTING GUIDE — Claude Lead System X Thread

**Post at:** 9-11 AM PST (Tuesday-Thursday for peak tech engagement)
**Total thread:** 7 tweets + 1 reply (2-3 min after thread)

---

## Tweet 1 (The Hook) — ATTACH: `demo.mp4` (native video upload)

```
Running multiple Claude Code agents in parallel is a nightmare.

They are completely blind to each other. They step on the same files. They duplicate work. And you spend your own API tokens just babysitting them.

I got sick of the chaos. So I built a fix.

Introducing the Claude Lead System.
```

**Media:** Upload `assets/demo/demo.mp4` as native X video (NOT a link)

---

## Tweet 2 (The Core Problem) — no media

```
The problem with multi-agent coding isn't the AI; it's the orchestration.

If Terminal A is writing the backend and Terminal B is writing the frontend, they will inevitably cause a merge conflict in your types file.

Standard agent frameworks solve this by dumping logs into the context window, burning massive API tokens.
```

---

## Tweet 3 (The Technical Flex) — ATTACH: `screenshots/screenshot_dashboard.png`

```
I bypassed the context window entirely.

The Claude Lead System wires every terminal together through native shell hooks (PostToolUse, PreToolUse) and a lightweight filesystem protocol.

It enriches a 3KB session JSON state on every tool invocation.

Total cost for cross-terminal coordination? Exactly 0 API tokens.
```

**Media:** Upload `assets/demo/screenshots/screenshot_dashboard.png`

---

## Tweet 4 (The Commands) — ATTACH: `screenshots/screenshot_conflicts.png`

```
By typing /lead in any session, that terminal becomes the "Project Lead."

It suddenly sees every other Claude terminal on your machine.

- tell [session] to [task] → sends messages via inbox hooks
- conflicts → cross-references files_touched across all sessions
- run [task] in [dir] → spawns autonomous workers
- wake [session] → injects AppleScript to wake idle terminals
```

**Media:** Upload `assets/demo/screenshots/screenshot_conflicts.png`

---

## Tweet 5 (The Proof) — ATTACH: `screenshots/screenshot_messaging.png`

```
Instead of parsing MBs of expensive transcripts, the Lead reads a few KB of JSON to build a live dashboard with active/stale sessions and W/E/B/R counters.

Messages are delivered via PreToolUse hooks — the recipient sees the message on their very next tool call.

Zero context window pollution. Zero API overhead.

The benchmarks? 207x faster than transcript scanning.
```

**Media:** Upload `assets/demo/screenshots/screenshot_messaging.png`

---

## Tweet 6 (Value Drop) — ATTACH: `screenshots/screenshot_worker.png`

```
It works natively on macOS, Linux, and Windows.
It supports Node 18+ and Python 3.10+.
It operates independently of MCP (though it includes an MCP coordinator with 14 tools for power users).

Spawn autonomous workers. Chain multi-step pipelines. Detect file conflicts before they become merge conflicts.

Stop babysitting your AI agents. Let them coordinate themselves.
```

**Media:** Upload `assets/demo/screenshots/screenshot_worker.png`

---

## Tweet 7 (The Ask) — no media

```
I just open-sourced the entire system.

If you are building complex software and want your Claude Code sessions to actually talk to each other without burning your wallet, you can install it with one line.

What's the most painful multi-agent coordination problem you've hit?
```

---

## FIRST REPLY — post 2-3 minutes after thread ends

```
The algorithm hates external links, so here is the repo.

One command to install. Star it if it saves your codebase from AI-induced merge conflicts:

github.com/DrewDawson2027/claude-lead-system

curl -fsSL https://raw.githubusercontent.com/DrewDawson2027/claude-lead-system/main/install.sh | bash

@AnthropicAI
```

---

## Asset Locations (all relative to repo root)

| Tweet | File | Dimensions |
|-------|------|-----------|
| 1 | `assets/demo/demo.mp4` | 1920x1080 video |
| 3 | `assets/demo/screenshots/screenshot_dashboard.png` | 1600x820 |
| 4 | `assets/demo/screenshots/screenshot_conflicts.png` | 1600x700 |
| 5 | `assets/demo/screenshots/screenshot_messaging.png` | 1600x680 |
| 6 | `assets/demo/screenshots/screenshot_worker.png` | 1600x730 |

## Additional Assets Available

| File | Use |
|------|-----|
| `assets/demo/demo.gif` | GitHub README hero, alternative to video |
| `assets/demo/before-after.png` | Quote tweet / standalone post |
| `assets/demo/screenshots/screenshot_healthcheck.png` | Bonus tweet if thread gets traction |
| `assets/demo/social/carousel/slide_01-04.png` | LinkedIn / carousel post alternative |
| `assets/demo/social/thumbnails/thumb_*.png` | Cross-platform thumbnails |

---

## Algorithm Optimizations Applied

- **No external links in main tweets** — GitHub link in first reply only (links reduce reach 40%)
- **Native video on Tweet 1** — 10x engagement vs text-only, stops the scroll
- **Images on Tweets 3-6** — visual dominance, each screenshot tells a story
- **Question CTA on Tweet 7** — replies weighted 150x, sparks engagement loop
- **"Contrarian problem" hook** — not clickbait, establishes technical authority
- **No hashtags** — 2026 algorithm deprioritizes hashtag-heavy tech posts
- **@AnthropicAI in reply only** — signals to algorithm without looking promotional
- **Thread length: 7** — sweet spot (not too short to lack substance, not too long to lose readers)
- **End with question** — drives reply velocity in first hour (need 50+ for broader distribution)

## Engagement Playbook (First Hour)

1. Post thread at 9-10 AM PST
2. Wait 2-3 min, post first reply with GitHub link
3. Reply to every comment in first 30 min (this is critical for velocity)
4. Quote-tweet your own Tweet 1 with a one-liner hot take: "Most 'agent frameworks' waste tokens coordinating inside the context window. Coordination should happen outside it."
5. If it picks up: post the `before-after.png` as a standalone tweet 2-3 hours later referencing the thread

## Cross-Posting (Same Day)

- **LinkedIn:** Adapt Tweet 1-3 into a single long-form post, more professional tone, include the before-after image
- **Reddit r/ClaudeAI:** Title: "I built a coordination layer for multiple Claude Code terminals — 0 API tokens, 207x faster than transcript scanning", link to GitHub
- **Hacker News:** Title: "Show HN: Claude Lead System – Multi-agent Claude Code orchestration via filesystem hooks", link to GitHub

# POSTING GUIDE — Claude Lead System X Thread

**Post at:** 9-11 AM PST (Tuesday-Thursday for peak tech engagement)
**Total thread:** 7 tweets + 1 reply (2-3 min after thread)

---

## Tweet 1 (The Hook) — ATTACH: `demo.mp4` (native video upload)

```
I wanted a local coordination layer for Claude Code.

So I built one.

`/lead` turns one session into a local operator: it can see other sessions, send messages, detect file overlap, and manage coordinator-mode workers.

Here’s the demo.
```

**Media:** Upload `assets/demo/demo.mp4` as native X video (NOT a link)

---

## Tweet 2 (The Core Problem) — no media

```
Agent Teams is the right default if you want first-party collaboration inside Claude Code.

Lead is for a different job: heavier multi-terminal workflows where you want coordination state outside the model context.

That means local session state, inbox files, conflict checks, and worker control without treating it like a native-team replacement.
```

---

## Tweet 3 (The Technical Flex) — ATTACH: `screenshots/screenshot_dashboard.png`

```
The core idea is simple:

shell hooks write small JSON state files and inbox files on disk.

`/lead` reads that local state instead of scanning transcripts for coordination metadata.

For the coordination path itself, that avoids pushing that coordination state through the API context.
```

**Media:** Upload `assets/demo/screenshots/screenshot_dashboard.png`

---

## Tweet 4 (The Commands) — ATTACH: `screenshots/screenshot_conflicts.png`

```
Type `/lead` in a Claude Code session and that session becomes the local lead.

In coordinator mode, it can inspect local session state and do things like:

- tell [session] to [task] → sends messages via inbox hooks
- conflicts → cross-references files_touched across all sessions
- run [task] in [dir] → spawns autonomous workers
- wake [session] → tries to wake an idle session, with inbox fallback
```

**Media:** Upload `assets/demo/screenshots/screenshot_conflicts.png`

---

## Tweet 5 (The Proof) — ATTACH: `screenshots/screenshot_messaging.png`

```
Instead of parsing transcripts for coordination state, the lead reads small local state files to build a dashboard of active/stale sessions and recent activity.

In coordinator mode, messages are delivered via hooks and the recipient sees them on the next tool call.

The point is not parity theater.

It’s a practical local control layer for messaging, conflict checks, and worker coordination.
```

**Media:** Upload `assets/demo/screenshots/screenshot_messaging.png`

---

## Tweet 6 (Value Drop) — ATTACH: `screenshots/screenshot_worker.png`

```
Current posture:

- strongest verified path: macOS coordinator workflows
- Linux/Windows: partial, should be treated cautiously in public copy
- hybrid/native paths: experimental

Spawn autonomous workers. Chain multi-step pipelines. Detect file conflicts before they become merge conflicts.

If you live in heavier Claude Code workflows, that operator layer can be useful.
```

**Media:** Upload `assets/demo/screenshots/screenshot_worker.png`

---

## Tweet 7 (The Ask) — no media

```
I just open-sourced the entire system.

If you want a local coordination layer for Claude Code, the repo is here.

What's the most painful multi-agent coordination problem you've hit?
```

---

## FIRST REPLY — post 2-3 minutes after thread ends

```
Here is the repo.

Install docs and demo assets are in the README:

github.com/DrewDawson2027/claude-lead-system

@AnthropicAI
```

---

## Asset Locations (all relative to repo root)

| Tweet | File                                               | Dimensions      |
| ----- | -------------------------------------------------- | --------------- |
| 1     | `assets/demo/demo.mp4`                             | 1920x1080 video |
| 3     | `assets/demo/screenshots/screenshot_dashboard.png` | 1600x820        |
| 4     | `assets/demo/screenshots/screenshot_conflicts.png` | 1600x700        |
| 5     | `assets/demo/screenshots/screenshot_messaging.png` | 1600x680        |
| 6     | `assets/demo/screenshots/screenshot_worker.png`    | 1600x730        |

## Additional Assets Available

| File                                                 | Use                                      |
| ---------------------------------------------------- | ---------------------------------------- |
| `assets/demo/demo.gif`                               | GitHub README hero, alternative to video |
| `assets/demo/before-after.png`                       | Quote tweet / standalone post            |
| `assets/demo/screenshots/screenshot_healthcheck.png` | Bonus tweet if thread gets traction      |
| `assets/demo/social/carousel/slide_01-04.png`        | LinkedIn / carousel post alternative     |
| `assets/demo/social/thumbnails/thumb_*.png`          | Reusable post thumbnails                 |

---

## Posting Notes

- **No external links in main tweets** — keeps the thread cleaner; GitHub link can live in the first reply
- **Native video on Tweet 1** — usually performs better than text-only for demo posts
- **Images on Tweets 3-6** — each screenshot supports a concrete product claim
- **Question CTA on Tweet 7** — invites replies from people with similar workflow pain
- **"Contrarian problem" hook** — not clickbait, establishes technical authority
- **No hashtags** — 2026 algorithm deprioritizes hashtag-heavy tech posts
- **@AnthropicAI in reply only** — signals to algorithm without looking promotional
- **Thread length: 7** — enough room for demo + positioning without dragging on
- **End with question** — helps turn the post into a conversation instead of a broadcast

## Engagement Playbook (First Hour)

1. Post thread at 9-10 AM PST
2. Wait 2-3 min, post first reply with GitHub link
3. Reply to every comment in first 30 min (this is critical for velocity)
4. Quote-tweet your own Tweet 1 with a one-liner follow-up like: "I wanted coordination state outside the context window, not buried inside transcripts."
5. If it picks up: post the `before-after.png` as a standalone tweet 2-3 hours later referencing the thread

## Cross-Posting (Same Day)

- **LinkedIn:** Adapt Tweet 1-3 into a single long-form post, more professional tone, include the before-after image
- **Reddit r/ClaudeAI:** Title: "I built a local coordination layer for Claude Code terminals", link to GitHub
- **Hacker News:** Title: "Show HN: Claude Lead System – Local coordination layer for Claude Code", link to GitHub

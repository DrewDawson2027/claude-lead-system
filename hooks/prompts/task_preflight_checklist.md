MANDATORY AGENT PRE-FLIGHT — Hard rules, no exceptions:

HARD BLOCKS (cancel this Task call immediately):
- User message under 50 words AND names specific files -> Use Read directly
- Task is 'search/find/grep X' -> Use Grep (~2k tokens, not ~50k agent)
- Task is 'read/check/look at file' -> Use Read (~5k, not ~50k)
- You're in plan mode -> Use Grep/Read first

SOFT CHECK (proceed only if ALL pass):
1. This genuinely requires 10+ files across multiple directories
2. Grep + 3 Read calls cannot answer this
3. User didn't already provide file paths and instructions

IF PROCEEDING:
- model MUST be 'sonnet' unless genuinely hard reasoning needed
- EXCEPTION: If user explicitly said 'use agents'/'autonomous'/'vibe code', proceed

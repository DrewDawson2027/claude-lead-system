#!/bin/bash
# Record the hero demo: 2 active workers + lead takes control
# Shows the FULL automation loop - conflict detection, messaging, task reassignment
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$DEMO_DIR/demo-project"
TMP_DIR="$DEMO_DIR/.demo-tmp"
OUT_DIR="$DEMO_DIR"
SCREEN_DEVICE="4:"  # Capture screen 0 (ultrawide)

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

# ─── Colors ───
B='\033[1m'       # bold
R='\033[0m'       # reset
BL='\033[34m'     # blue
GR='\033[32m'     # green
YL='\033[33m'     # yellow
RD='\033[31m'     # red
CY='\033[36m'     # cyan
MG='\033[35m'     # magenta
GY='\033[90m'     # gray
WH='\033[97m'     # white

# ─── Helpers ───
type_line() {
  # Simulate typing: print chars with tiny delay
  local line="$1"
  local delay="${2:-0.02}"
  for (( i=0; i<${#line}; i++ )); do
    printf '%s' "${line:$i:1}"
    sleep "$delay"
  done
  echo
}

slow_echo() {
  echo -e "$1"
  sleep "${2:-0.4}"
}

fast_echo() {
  echo -e "$1"
  sleep "${2:-0.15}"
}

# ═══════════════════════════════════════════════════════════════
# Worker A: Auth middleware engineer — actively coding JWT
# ═══════════════════════════════════════════════════════════════
cat > "$TMP_DIR/worker-a.sh" << 'WORKER_A'
#!/bin/bash
B='\033[1m'; R='\033[0m'; BL='\033[34m'; GR='\033[32m'; YL='\033[33m'
RD='\033[31m'; CY='\033[36m'; MG='\033[35m'; GY='\033[90m'; WH='\033[97m'

slow() { echo -e "$1"; sleep "${2:-0.4}"; }
fast() { echo -e "$1"; sleep "${2:-0.15}"; }

clear
echo ""
echo -e "${GY}Session W-a8f3 • claude-sonnet-4-20250514 • demo-project${R}"
echo -e "${GY}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}"
echo ""
echo -e "${B}${WH}> Implement JWT authentication middleware for the API${R}"
echo ""
sleep 0.8

slow "${CY}●${R} I'll implement JWT auth middleware. Let me read the existing code first."
echo ""

slow "  ${BL}Read${R} src/auth.ts ${GY}(67 lines)${R}"
sleep 0.3
fast "  ${GY}  1│ import crypto from 'crypto'${R}"
fast "  ${GY}  2│ import { UserStore } from './store'${R}"
fast "  ${GY}  3│${R}"
fast "  ${GY}  4│ export interface AuthConfig {${R}"
fast "  ${GY}  5│   secret: string${R}"
fast "  ${GY}  6│   tokenExpiry: number${R}"
fast "  ${GY} ..│ ${GY}(62 more lines)${R}"
echo ""
sleep 0.3

slow "  ${BL}Read${R} src/api.ts ${GY}(42 lines)${R}"
sleep 0.2
fast "  ${GY}  1│ import { handleLogin, handleRegister } from './auth'${R}"
fast "  ${GY}  2│ import type { Request, Response } from './types'${R}"
fast "  ${GY} ..│ ${GY}(40 more lines)${R}"
echo ""
sleep 0.3

slow "${CY}●${R} Now I'll add JWT token generation and validation to the auth module."
echo ""

slow "  ${BL}Edit${R} src/auth.ts"
fast "  ${GR}+ import jwt from 'jsonwebtoken'${R}"
fast "  ${GR}+${R}"
fast "  ${GR}+ export function generateToken(userId: string, config: AuthConfig): string {${R}"
fast "  ${GR}+   return jwt.sign({ sub: userId, iat: Date.now() }, config.secret, {${R}"
fast "  ${GR}+     expiresIn: config.tokenExpiry || '24h'${R}"
fast "  ${GR}+   })${R}"
fast "  ${GR}+ }${R}"
fast "  ${GR}+${R}"
fast "  ${GR}+ export function verifyToken(token: string, config: AuthConfig) {${R}"
fast "  ${GR}+   try {${R}"
fast "  ${GR}+     return jwt.verify(token, config.secret)${R}"
fast "  ${GR}+   } catch {${R}"
fast "  ${GR}+     return null${R}"
fast "  ${GR}+   }${R}"
fast "  ${GR}+ }${R}"
echo ""
sleep 0.5

slow "${CY}●${R} Adding the middleware function that protects routes."
echo ""

slow "  ${BL}Edit${R} src/auth.ts"
fast "  ${GR}+ export function authMiddleware(req: Request, res: Response, next: Function) {${R}"
fast "  ${GR}+   const header = req.headers.authorization${R}"
fast "  ${GR}+   if (!header?.startsWith('Bearer ')) {${R}"
fast "  ${GR}+     return res.status(401).json({ error: 'Missing token' })${R}"
fast "  ${GR}+   }${R}"
fast "  ${GR}+   const payload = verifyToken(header.slice(7), req.app.config)${R}"
fast "  ${GR}+   if (!payload) {${R}"
fast "  ${GR}+     return res.status(401).json({ error: 'Invalid token' })${R}"
fast "  ${GR}+   }${R}"
fast "  ${GR}+   req.user = payload${R}"
fast "  ${GR}+   next()${R}"
fast "  ${GR}+ }${R}"
echo ""
sleep 0.5

slow "${CY}●${R} Let me also update the login handler to return JWT tokens."
echo ""

slow "  ${BL}Edit${R} src/auth.ts"
fast "  ${RD}- export async function handleLogin(username: string, password: string) {${R}"
fast "  ${RD}-   const user = await UserStore.findByUsername(username)${R}"
fast "  ${RD}-   if (!user || !verify(password, user.hash)) return null${R}"
fast "  ${RD}-   return { id: user.id, username: user.username }${R}"
fast "  ${GR}+ export async function handleLogin(username: string, password: string, config: AuthConfig) {${R}"
fast "  ${GR}+   const user = await UserStore.findByUsername(username)${R}"
fast "  ${GR}+   if (!user || !verify(password, user.hash)) return null${R}"
fast "  ${GR}+   const token = generateToken(user.id, config)${R}"
fast "  ${GR}+   return { id: user.id, username: user.username, token }${R}"
echo ""
sleep 0.6

# ─── INBOX MESSAGE ARRIVES ───
echo ""
echo -e "${B}${YL}┌─────────────────────────────────────────────────────┐${R}"
echo -e "${B}${YL}│  📨 MESSAGE from lead (session L-001)               │${R}"
echo -e "${B}${YL}│                                                     │${R}"
echo -e "${B}${YL}│  Focus on JWT validation + token refresh only.      │${R}"
echo -e "${B}${YL}│  Worker B is handling error responses — skip the    │${R}"
echo -e "${B}${YL}│  error handler refactor to avoid conflicts.         │${R}"
echo -e "${B}${YL}│  New task: Add token refresh endpoint.              │${R}"
echo -e "${B}${YL}└─────────────────────────────────────────────────────┘${R}"
echo ""
sleep 1.2

slow "${CY}●${R} Got it — pivoting to token refresh endpoint as instructed."
echo ""

slow "  ${BL}Edit${R} src/auth.ts"
fast "  ${GR}+ export function refreshToken(oldToken: string, config: AuthConfig): string | null {${R}"
fast "  ${GR}+   const payload = verifyToken(oldToken, config)${R}"
fast "  ${GR}+   if (!payload || typeof payload === 'string') return null${R}"
fast "  ${GR}+   // Issue new token with fresh expiry${R}"
fast "  ${GR}+   return generateToken(payload.sub as string, config)${R}"
fast "  ${GR}+ }${R}"
echo ""
sleep 0.4

slow "${CY}●${R} Adding the refresh route to the API."
echo ""

slow "  ${BL}Edit${R} src/api.ts"
fast "  ${GR}+ // POST /auth/refresh — issue new token from valid existing token${R}"
fast "  ${GR}+ app.post('/auth/refresh', authMiddleware, (req, res) => {${R}"
fast "  ${GR}+   const newToken = refreshToken(req.headers.authorization!.slice(7), req.app.config)${R}"
fast "  ${GR}+   if (!newToken) return res.status(401).json({ error: 'Cannot refresh' })${R}"
fast "  ${GR}+   res.json({ token: newToken })${R}"
fast "  ${GR}+ })${R}"
echo ""
sleep 0.4

slow "${CY}●${R} Running tests to verify everything works."
echo ""
slow "  ${BL}Bash${R} npm test"
sleep 0.6
fast "  ${GR}PASS${R} tests/auth.test.ts"
fast "    ${GR}✓${R} login returns JWT token ${GY}(24ms)${R}"
fast "    ${GR}✓${R} invalid credentials rejected ${GY}(8ms)${R}"
fast "    ${GR}✓${R} middleware blocks missing token ${GY}(5ms)${R}"
fast "    ${GR}✓${R} middleware validates valid token ${GY}(12ms)${R}"
fast "    ${GR}✓${R} token refresh issues new token ${GY}(15ms)${R}"
fast "    ${GR}✓${R} expired token rejected ${GY}(6ms)${R}"
echo ""
fast "  ${B}Tests:${R}  ${GR}6 passed${R}, 6 total"
fast "  ${B}Time:${R}   0.847s"
echo ""
sleep 0.5

echo -e "${GR}●${R} ${B}All tests passing.${R} JWT auth middleware complete with token refresh."
echo -e "${GY}  Files modified: src/auth.ts, src/api.ts${R}"
echo -e "${GY}  Task W-a8f3 complete — 6/6 tests green${R}"

# Keep alive
sleep 300
WORKER_A
chmod +x "$TMP_DIR/worker-a.sh"

# ═══════════════════════════════════════════════════════════════
# Worker B: Error handling engineer — actively coding
# ═══════════════════════════════════════════════════════════════
cat > "$TMP_DIR/worker-b.sh" << 'WORKER_B'
#!/bin/bash
B='\033[1m'; R='\033[0m'; BL='\033[34m'; GR='\033[32m'; YL='\033[33m'
RD='\033[31m'; CY='\033[36m'; MG='\033[35m'; GY='\033[90m'; WH='\033[97m'

slow() { echo -e "$1"; sleep "${2:-0.4}"; }
fast() { echo -e "$1"; sleep "${2:-0.15}"; }

clear
echo ""
echo -e "${GY}Session W-c2e7 • claude-sonnet-4-20250514 • demo-project${R}"
echo -e "${GY}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}"
echo ""
echo -e "${B}${WH}> Add comprehensive error handling and input validation to the API${R}"
echo ""
sleep 0.8

slow "${CY}●${R} I'll add error handling and input validation. Let me examine the current API."
echo ""

slow "  ${BL}Read${R} src/api.ts ${GY}(42 lines)${R}"
sleep 0.3
fast "  ${GY}  1│ import { handleLogin, handleRegister } from './auth'${R}"
fast "  ${GY}  2│ import type { Request, Response } from './types'${R}"
fast "  ${GY}  3│${R}"
fast "  ${GY}  4│ export function createRouter() {${R}"
fast "  ${GY} ..│ ${GY}(38 more lines)${R}"
echo ""
sleep 0.3

slow "  ${BL}Read${R} src/auth.ts ${GY}(67 lines)${R}"
fast "  ${GY}  1│ import crypto from 'crypto'${R}"
fast "  ${GY} ..│ ${GY}(66 more lines)${R}"
echo ""
sleep 0.3

slow "${CY}●${R} Adding request validation middleware for all auth endpoints."
echo ""

slow "  ${BL}Edit${R} src/api.ts"
fast "  ${GR}+ import { z } from 'zod'${R}"
fast "  ${GR}+${R}"
fast "  ${GR}+ const LoginSchema = z.object({${R}"
fast "  ${GR}+   username: z.string().min(3).max(50),${R}"
fast "  ${GR}+   password: z.string().min(8).max(128),${R}"
fast "  ${GR}+ })${R}"
fast "  ${GR}+${R}"
fast "  ${GR}+ const RegisterSchema = LoginSchema.extend({${R}"
fast "  ${GR}+   email: z.string().email(),${R}"
fast "  ${GR}+   name: z.string().min(1).max(100).optional(),${R}"
fast "  ${GR}+ })${R}"
echo ""
sleep 0.5

slow "${CY}●${R} Now adding the global error handler and structured error responses."
echo ""

slow "  ${BL}Edit${R} src/api.ts"
fast "  ${GR}+ export class ApiError extends Error {${R}"
fast "  ${GR}+   constructor(public status: number, message: string, public code?: string) {${R}"
fast "  ${GR}+     super(message)${R}"
fast "  ${GR}+   }${R}"
fast "  ${GR}+ }${R}"
fast "  ${GR}+${R}"
fast "  ${GR}+ export function errorHandler(err: Error, req: Request, res: Response) {${R}"
fast "  ${GR}+   if (err instanceof ApiError) {${R}"
fast "  ${GR}+     return res.status(err.status).json({${R}"
fast "  ${GR}+       error: err.message, code: err.code${R}"
fast "  ${GR}+     })${R}"
fast "  ${GR}+   }${R}"
fast "  ${GR}+   if (err instanceof z.ZodError) {${R}"
fast "  ${GR}+     return res.status(400).json({${R}"
fast "  ${GR}+       error: 'Validation failed', details: err.issues${R}"
fast "  ${GR}+     })${R}"
fast "  ${GR}+   }${R}"
fast "  ${GR}+   res.status(500).json({ error: 'Internal server error' })${R}"
fast "  ${GR}+ }${R}"
echo ""
sleep 0.5

slow "${CY}●${R} Wrapping route handlers with validation..."
echo ""
slow "  ${BL}Edit${R} src/api.ts"
fast "  ${RD}- app.post('/login', async (req, res) => {${R}"
fast "  ${RD}-   const result = await handleLogin(req.body.username, req.body.password)${R}"
fast "  ${GR}+ app.post('/login', async (req, res, next) => {${R}"
fast "  ${GR}+   try {${R}"
fast "  ${GR}+     const { username, password } = LoginSchema.parse(req.body)${R}"
fast "  ${GR}+     const result = await handleLogin(username, password, req.app.config)${R}"
fast "  ${GR}+     if (!result) throw new ApiError(401, 'Invalid credentials', 'AUTH_FAILED')${R}"
echo ""
sleep 0.6

# ─── INBOX MESSAGE ARRIVES ───
echo ""
echo -e "${B}${YL}┌─────────────────────────────────────────────────────┐${R}"
echo -e "${B}${YL}│  📨 MESSAGE from lead (session L-001)               │${R}"
echo -e "${B}${YL}│                                                     │${R}"
echo -e "${B}${YL}│  Conflict detected on src/auth.ts — Worker A owns   │${R}"
echo -e "${B}${YL}│  auth changes. Switch to rate limiting middleware:   │${R}"
echo -e "${B}${YL}│  Create src/rate-limiter.ts with sliding window     │${R}"
echo -e "${B}${YL}│  algorithm. Apply to /login and /register routes.   │${R}"
echo -e "${B}${YL}└─────────────────────────────────────────────────────┘${R}"
echo ""
sleep 1.2

slow "${CY}●${R} Understood — switching to rate limiter. Creating new module."
echo ""

slow "  ${BL}Write${R} src/rate-limiter.ts"
fast "  ${GR}+ import { Request, Response, NextFunction } from './types'${R}"
fast "  ${GR}+${R}"
fast "  ${GR}+ interface RateWindow { count: number; resetAt: number }${R}"
fast "  ${GR}+ const windows = new Map<string, RateWindow>()${R}"
fast "  ${GR}+${R}"
fast "  ${GR}+ export function rateLimit(maxRequests = 10, windowMs = 60000) {${R}"
fast "  ${GR}+   return (req: Request, res: Response, next: NextFunction) => {${R}"
fast "  ${GR}+     const key = req.ip || req.headers['x-forwarded-for'] || 'unknown'${R}"
fast "  ${GR}+     const now = Date.now()${R}"
fast "  ${GR}+     let window = windows.get(key as string)${R}"
fast "  ${GR}+${R}"
fast "  ${GR}+     if (!window || now > window.resetAt) {${R}"
fast "  ${GR}+       window = { count: 0, resetAt: now + windowMs }${R}"
fast "  ${GR}+     }${R}"
fast "  ${GR}+     window.count++${R}"
fast "  ${GR}+     windows.set(key as string, window)${R}"
fast "  ${GR}+${R}"
fast "  ${GR}+     if (window.count > maxRequests) {${R}"
fast "  ${GR}+       const retryAfter = Math.ceil((window.resetAt - now) / 1000)${R}"
fast "  ${GR}+       res.set('Retry-After', String(retryAfter))${R}"
fast "  ${GR}+       return res.status(429).json({${R}"
fast "  ${GR}+         error: 'Too many requests', retryAfter${R}"
fast "  ${GR}+       })${R}"
fast "  ${GR}+     }${R}"
fast "  ${GR}+     next()${R}"
fast "  ${GR}+   }${R}"
fast "  ${GR}+ }${R}"
echo ""
sleep 0.4

slow "${CY}●${R} Applying rate limiter to auth routes."
echo ""
slow "  ${BL}Edit${R} src/api.ts"
fast "  ${GR}+ import { rateLimit } from './rate-limiter'${R}"
fast "  ${GR}+${R}"
fast "  ${GR}+ // Rate limit: 10 attempts per minute on auth endpoints${R}"
fast "  ${GR}+ app.use('/login', rateLimit(10, 60000))${R}"
fast "  ${GR}+ app.use('/register', rateLimit(5, 60000))${R}"
echo ""
sleep 0.4

slow "${CY}●${R} Running tests..."
echo ""
slow "  ${BL}Bash${R} npm test"
sleep 0.6
fast "  ${GR}PASS${R} tests/api.test.ts"
fast "    ${GR}✓${R} validation rejects short username ${GY}(6ms)${R}"
fast "    ${GR}✓${R} validation rejects invalid email ${GY}(4ms)${R}"
fast "    ${GR}✓${R} rate limiter blocks after threshold ${GY}(18ms)${R}"
fast "    ${GR}✓${R} rate limiter resets after window ${GY}(9ms)${R}"
fast "    ${GR}✓${R} error handler formats ApiError ${GY}(3ms)${R}"
fast "    ${GR}✓${R} error handler formats ZodError ${GY}(5ms)${R}"
echo ""
fast "  ${B}Tests:${R}  ${GR}6 passed${R}, 6 total"
fast "  ${B}Time:${R}   0.623s"
echo ""
sleep 0.5

echo -e "${GR}●${R} ${B}All tests passing.${R} Rate limiter + validation complete."
echo -e "${GY}  Files modified: src/api.ts, src/rate-limiter.ts (new)${R}"
echo -e "${GY}  Task W-c2e7 complete — 6/6 tests green${R}"

sleep 300
WORKER_B
chmod +x "$TMP_DIR/worker-b.sh"

# ═══════════════════════════════════════════════════════════════
# Lead: Spawns in, assesses, takes control, orchestrates
# ═══════════════════════════════════════════════════════════════
cat > "$TMP_DIR/lead.sh" << 'LEAD_SCRIPT'
#!/bin/bash
B='\033[1m'; R='\033[0m'; BL='\033[34m'; GR='\033[32m'; YL='\033[33m'
RD='\033[31m'; CY='\033[36m'; MG='\033[35m'; GY='\033[90m'; WH='\033[97m'

slow() { echo -e "$1"; sleep "${2:-0.5}"; }
fast() { echo -e "$1"; sleep "${2:-0.15}"; }

clear
echo ""
# Wait for workers to start doing things
sleep 7

# Type the /lead command
echo -e "${GY}Session L-001 • claude-opus-4-20250514 • demo-project${R}"
echo -e "${GY}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${R}"
echo ""
printf "${B}${WH}> ${R}"
sleep 0.3
for c in / l e a d; do printf "$c"; sleep 0.08; done
echo ""
sleep 1.0

# Dashboard
echo ""
echo -e "${B}${CY}╔═══════════════════════════════════════════════════════╗${R}"
echo -e "${B}${CY}║         CLAUDE LEAD SYSTEM — LIVE DASHBOARD          ║${R}"
echo -e "${B}${CY}╚═══════════════════════════════════════════════════════╝${R}"
echo ""
sleep 0.3

echo -e "${B}📡 Active Sessions${R}"
echo -e "${GY}┌──────────┬──────────────┬────────┬───────────────────────────┐${R}"
echo -e "${GY}│${R} ${B}Session${R}  ${GY}│${R} ${B}Status${R}       ${GY}│${R} ${B}Model${R}  ${GY}│${R} ${B}Current Task${R}              ${GY}│${R}"
echo -e "${GY}├──────────┼──────────────┼────────┼───────────────────────────┤${R}"
echo -e "${GY}│${R} W-a8f3   ${GY}│${R} ${GR}● active${R}     ${GY}│${R} sonnet ${GY}│${R} JWT auth middleware        ${GY}│${R}"
echo -e "${GY}│${R} W-c2e7   ${GY}│${R} ${GR}● active${R}     ${GY}│${R} sonnet ${GY}│${R} Error handling + validation${GY}│${R}"
echo -e "${GY}│${R} L-001    ${GY}│${R} ${CY}● lead${R}       ${GY}│${R} opus   ${GY}│${R} Orchestration             ${GY}│${R}"
echo -e "${GY}└──────────┴──────────────┴────────┴───────────────────────────┘${R}"
echo ""
sleep 0.4

echo -e "${B}📂 Files in Flight${R}"
echo -e "${GY}┌──────────────────────┬───────────────────┬──────────┐${R}"
echo -e "${GY}│${R} ${B}File${R}                 ${GY}│${R} ${B}Sessions${R}          ${GY}│${R} ${B}Status${R}   ${GY}│${R}"
echo -e "${GY}├──────────────────────┼───────────────────┼──────────┤${R}"
echo -e "${GY}│${R} src/auth.ts          ${GY}│${R} W-a8f3, W-c2e7    ${GY}│${R} ${RD}CONFLICT${R} ${GY}│${R}"
echo -e "${GY}│${R} src/api.ts           ${GY}│${R} W-a8f3, W-c2e7    ${GY}│${R} ${YL}OVERLAP${R}  ${GY}│${R}"
echo -e "${GY}│${R} tests/auth.test.ts   ${GY}│${R} W-a8f3            ${GY}│${R} ${GR}OK${R}       ${GY}│${R}"
echo -e "${GY}└──────────────────────┴───────────────────┴──────────┘${R}"
echo ""
sleep 0.6

echo -e "${B}${RD}⚠  CONFLICT DETECTED${R}  Both workers editing ${B}src/auth.ts${R}"
echo -e "${GY}   W-a8f3: JWT generateToken, verifyToken, authMiddleware${R}"
echo -e "${GY}   W-c2e7: error handler refactor touching auth imports${R}"
echo ""
sleep 0.8

echo -e "${CY}●${R} Resolving conflict — reassigning Worker B to avoid overlap."
echo ""
sleep 0.4

# Send messages
echo -e "${B}💬 Sending directives...${R}"
echo ""
slow "  ${BL}coord_send_message${R} → W-a8f3"
echo -e "  ${GR}✓${R} \"Focus on JWT validation + token refresh only\""
echo ""
slow "  ${BL}coord_send_message${R} → W-c2e7"
echo -e "  ${GR}✓${R} \"Switch to rate limiting — create src/rate-limiter.ts\""
echo ""
sleep 0.4

echo -e "  ${BL}coord_update_task${R} W-c2e7"
echo -e "  ${GR}✓${R} Reassigned: error handling → rate limiting middleware"
echo ""
sleep 1.0

# Updated dashboard
echo -e "${B}${CY}── Dashboard Refresh ──${R}"
echo ""

echo -e "${B}📡 Active Sessions${R}  ${GY}(updated 2s ago)${R}"
echo -e "${GY}┌──────────┬──────────────┬────────┬───────────────────────────┐${R}"
echo -e "${GY}│${R} ${B}Session${R}  ${GY}│${R} ${B}Status${R}       ${GY}│${R} ${B}Model${R}  ${GY}│${R} ${B}Current Task${R}              ${GY}│${R}"
echo -e "${GY}├──────────┼──────────────┼────────┼───────────────────────────┤${R}"
echo -e "${GY}│${R} W-a8f3   ${GY}│${R} ${GR}● active${R}     ${GY}│${R} sonnet ${GY}│${R} JWT + token refresh        ${GY}│${R}"
echo -e "${GY}│${R} W-c2e7   ${GY}│${R} ${GR}● active${R}     ${GY}│${R} sonnet ${GY}│${R} Rate limiting middleware   ${GY}│${R}"
echo -e "${GY}│${R} L-001    ${GY}│${R} ${CY}● lead${R}       ${GY}│${R} opus   ${GY}│${R} Orchestration             ${GY}│${R}"
echo -e "${GY}└──────────┴──────────────┴────────┴───────────────────────────┘${R}"
echo ""
sleep 0.3

echo -e "${B}📂 Files in Flight${R}  ${GY}(conflicts resolved)${R}"
echo -e "${GY}┌──────────────────────┬───────────────────┬──────────┐${R}"
echo -e "${GY}│${R} ${B}File${R}                 ${GY}│${R} ${B}Sessions${R}          ${GY}│${R} ${B}Status${R}   ${GY}│${R}"
echo -e "${GY}├──────────────────────┼───────────────────┼──────────┤${R}"
echo -e "${GY}│${R} src/auth.ts          ${GY}│${R} W-a8f3            ${GY}│${R} ${GR}OK${R}       ${GY}│${R}"
echo -e "${GY}│${R} src/api.ts           ${GY}│${R} W-c2e7            ${GY}│${R} ${GR}OK${R}       ${GY}│${R}"
echo -e "${GY}│${R} src/rate-limiter.ts   ${GY}│${R} W-c2e7            ${GY}│${R} ${GR}OK${R}       ${GY}│${R}"
echo -e "${GY}│${R} tests/auth.test.ts   ${GY}│${R} W-a8f3            ${GY}│${R} ${GR}OK${R}       ${GY}│${R}"
echo -e "${GY}└──────────────────────┴───────────────────┴──────────┘${R}"
echo ""
sleep 0.5

echo -e "${B}${GR}✓ All conflicts resolved.${R} Workers redirected via zero-token messaging."
echo ""
sleep 0.5

# Cost comparison
echo -e "${B}💰 Cost Comparison${R}  ${GY}(this session)${R}"
echo -e "${GY}┌──────────────────────────┬──────────┬──────────┐${R}"
echo -e "${GY}│${R}                          ${GY}│${R} ${B}Lead Sys${R} ${GY}│${R} ${B}Agent Teams${R}${GY}│${R}"
echo -e "${GY}├──────────────────────────┼──────────┼──────────┤${R}"
echo -e "${GY}│${R} Worker A (sonnet)        ${GY}│${R}    \$0.72 ${GY}│${R}     \$2.52 ${GY}│${R}"
echo -e "${GY}│${R} Worker B (sonnet)        ${GY}│${R}    \$0.54 ${GY}│${R}     \$1.89 ${GY}│${R}"
echo -e "${GY}│${R} Lead (opus)              ${GY}│${R}    \$2.25 ${GY}│${R}     \$2.25 ${GY}│${R}"
echo -e "${GY}│${R} Coordination overhead    ${GY}│${R}    ${GR}\$0.00${R} ${GY}│${R}     ${RD}\$0.90${R} ${GY}│${R}"
echo -e "${GY}├──────────────────────────┼──────────┼──────────┤${R}"
echo -e "${GY}│${R} ${B}Total${R}                    ${GY}│${R}  ${GR}${B}\$3.51${R}  ${GY}│${R}   ${RD}${B}\$7.56${R}  ${GY}│${R}"
echo -e "${GY}│${R} ${B}Savings${R}                  ${GY}│${R}  ${GR}${B}54%${R}    ${GY}│${R}          ${GY}│${R}"
echo -e "${GY}└──────────────────────────┴──────────┴──────────┘${R}"
echo ""
sleep 0.5

echo -e "${GY}  Coordination: filesystem (0 tokens) vs context window (90K+ tokens)${R}"
echo -e "${GY}  Worker overhead: stateless (exit on complete) vs growing context${R}"
echo ""
sleep 0.5

echo -e "${B}${GR}━━━ Session Summary ━━━${R}"
echo -e "  ${GR}✓${R} 2 workers orchestrated"
echo -e "  ${GR}✓${R} 1 file conflict detected and resolved"
echo -e "  ${GR}✓${R} 2 directives sent (zero tokens)"
echo -e "  ${GR}✓${R} 12/12 tests passing across both workers"
echo -e "  ${GR}✓${R} 54% cost savings vs Agent Teams"
echo ""

sleep 300
LEAD_SCRIPT
chmod +x "$TMP_DIR/lead.sh"

# ═══════════════════════════════════════════════════════════════
# iTerm2 AppleScript: 3 panes, maximize, run sims
# ═══════════════════════════════════════════════════════════════
cat > "$TMP_DIR/launch.scpt" << APPLESCRIPT
tell application "iTerm2"
  activate
  delay 0.5

  -- Create new window (clean, no personal info)
  create window with default profile
  delay 0.5

  tell current window
    -- Maximize the window to fill screen
    set bounds to {0, 0, 5120, 1440}
    delay 0.3

    tell current session
      -- Worker A (left pane)
      write text "clear && bash '$TMP_DIR/worker-a.sh'"
    end tell

    -- Split right for Worker B (middle pane)
    tell current session
      set workerB to (split vertically with default profile)
    end tell
    tell workerB
      write text "clear && bash '$TMP_DIR/worker-b.sh'"
    end tell

    -- Split right again for Lead (right pane)
    tell workerB
      set leadPane to (split vertically with default profile)
    end tell
    tell leadPane
      write text "clear && bash '$TMP_DIR/lead.sh'"
    end tell
  end tell
end tell
APPLESCRIPT

echo "═══════════════════════════════════════"
echo " HERO DEMO RECORDER"
echo "═══════════════════════════════════════"
echo ""
echo "Step 1: Launching 3-pane iTerm2 layout..."

osascript "$TMP_DIR/launch.scpt"
sleep 2

echo "Step 2: Recording screen (device $SCREEN_DEVICE)..."
echo "  Duration: 50 seconds"
echo ""

RAW_FILE="$TMP_DIR/raw-recording.mp4"
ffmpeg -y -f avfoundation -framerate 30 -capture_cursor 0 \
  -i "$SCREEN_DEVICE" \
  -t 50 \
  -c:v libx264 -preset ultrafast -crf 18 \
  -pix_fmt yuv420p \
  "$RAW_FILE" 2>/dev/null &
FFMPEG_PID=$!

echo "  ffmpeg PID: $FFMPEG_PID"
echo "  Recording..."

# Wait for recording to finish
wait $FFMPEG_PID 2>/dev/null
echo "  Recording complete: $(du -h "$RAW_FILE" | cut -f1)"

echo ""
echo "Step 3: Processing..."

# Get iTerm window bounds for cropping
BOUNDS=$(osascript -e 'tell application "iTerm2" to get bounds of current window' 2>/dev/null || echo "0, 25, 5120, 1440")
X=$(echo "$BOUNDS" | cut -d',' -f1 | tr -d ' ')
Y=$(echo "$BOUNDS" | cut -d',' -f2 | tr -d ' ')
W=$(echo "$BOUNDS" | cut -d',' -f3 | tr -d ' ')
H=$(echo "$BOUNDS" | cut -d',' -f4 | tr -d ' ')
CROP_W=$((W - X))
CROP_H=$((H - Y))

echo "  Window bounds: ${X},${Y} → ${W}x${H}"
echo "  Crop: ${CROP_W}x${CROP_H}+${X}+${Y}"

# Crop to iTerm window, high quality
ffmpeg -y -i "$RAW_FILE" \
  -vf "crop=${CROP_W}:${CROP_H}:${X}:${Y}" \
  -c:v libx264 -preset slow -crf 20 \
  -pix_fmt yuv420p \
  "$OUT_DIR/demo-final.mp4" 2>/dev/null

echo "  Final MP4: $(du -h "$OUT_DIR/demo-final.mp4" | cut -f1)"

# Extract hero screenshot at peak moment (lead dashboard + cost comparison visible)
# The lead starts at 7s, dashboard at ~9s, conflict at ~14s, messages at ~17s,
# refresh at ~23s, cost comparison at ~27s, summary at ~32s
for ts in 15 25 35; do
  ffmpeg -y -i "$OUT_DIR/demo-final.mp4" -ss "$ts" -frames:v 1 \
    "$OUT_DIR/screenshots/demo_${ts}s.png" 2>/dev/null
done

# Hero shot: cost comparison visible (~30s in)
ffmpeg -y -i "$OUT_DIR/demo-final.mp4" -ss 32 -frames:v 1 \
  "$OUT_DIR/demo-hero.png" 2>/dev/null

echo "  Hero PNG: $(du -h "$OUT_DIR/demo-hero.png" | cut -f1)"

# Create GIF (scaled to reasonable size for web)
ffmpeg -y -i "$OUT_DIR/demo-final.mp4" \
  -vf "fps=12,scale=1920:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" \
  "$OUT_DIR/demo-hero.gif" 2>/dev/null

echo "  Hero GIF: $(du -h "$OUT_DIR/demo-hero.gif" | cut -f1)"

echo ""
echo "Step 4: Cleaning up iTerm2 panes..."

# Kill the simulation scripts
pkill -f "worker-a.sh" 2>/dev/null || true
pkill -f "worker-b.sh" 2>/dev/null || true
pkill -f "lead.sh" 2>/dev/null || true

echo ""
echo "═══════════════════════════════════════"
echo " DONE"
echo "═══════════════════════════════════════"
echo ""
echo "Output files:"
echo "  📹 $OUT_DIR/demo-final.mp4"
echo "  🖼  $OUT_DIR/demo-hero.png"
echo "  🎞  $OUT_DIR/demo-hero.gif"
echo "  📸 $OUT_DIR/screenshots/demo_15s.png"
echo "  📸 $OUT_DIR/screenshots/demo_25s.png"
echo "  📸 $OUT_DIR/screenshots/demo_35s.png"

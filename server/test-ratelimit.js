/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║         SyncUp — Rate Limiter Test                      ║
 * ╠══════════════════════════════════════════════════════════╣
 * ║ Usage:   node test-ratelimit.js                          ║
 * ║                                                          ║
 * ║   1. Logs in with a real user account                    ║
 * ║   2. Picks the first conversation found                  ║
 * ║   3. Fires messages fast via Socket.IO                   ║
 * ║   4. Watches when the rate limiter kicks in              ║
 * ║   5. Verifies blocked sends report a cooldown            ║
 * ║   6. Prints PASS/FAIL and saves it to results/           ║
 * ║                                                          ║
 * ║ Requires Redis configured on the server, else the        ║
 * ║ limiter allows everything and nothing gets blocked.      ║
 * ╚══════════════════════════════════════════════════════════╝
 */

import { io } from 'socket.io-client'
import fs from 'fs'
import path from 'path'

// ─── Configuration ───────────────────────────────────────
// ─── Configuration ───────────────────────────────────────
// IMPORTANT: SERVER_URL must match the port your server prints on startup
// (look for "🚀 Server running on http://localhost:XXXX"). Default is 5000.
const SERVER_URL    = 'http://127.0.0.1:5000'
const USER_EMAIL    = 'abc@gmail.com'   // ← change to a real account in your app
const USER_PASSWORD = '123456'          // ← change to that account's password

const EXPECTED_LIMIT = 20               // must match MAX_IN_WINDOW in config/ratelimit.js
const NUM_MESSAGES   = 30               // fire more than the limit to trip it

const RESULTS_DIR = path.resolve('./results')
// ─────────────────────────────────────────────────────────// ─────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * Step 1 — Login via REST API to get a JWT token
 */
async function login() {
  console.log(`\n🔐 Logging in as ${USER_EMAIL} at ${SERVER_URL}...`)

  let res
  try {
    res = await fetch(`${SERVER_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD })
    })
  } catch (err) {
    // fetch throws (not an HTTP error) when it can't reach the server at all
    throw new Error(
      `Could not reach the server at ${SERVER_URL}. ` +
      `Is it running (npm run dev) and is the port correct? ` +
      `Underlying error: ${err.message}`
    )
  }

  const data = await res.json()
  if (!res.ok || !data.token) {
    throw new Error(`Login failed (HTTP ${res.status}): ${data.message || 'check email/password'}`)
  }

  console.log(`   ✅ Logged in as ${data.user.name} (${data.user.id})`)
  return { token: data.token, user: data.user }
}
/**
 * Step 2 — Fetch conversations via REST API
 */
async function getConversations(token) {
  console.log(`📋 Fetching conversations...`)
  const res = await fetch(`${SERVER_URL}/api/conversations`, {
    headers: { Authorization: token }
  })
  const data = await res.json()
  if (!data.conversations || data.conversations.length === 0) {
    throw new Error('No conversations found. Create a conversation in the app first.')
  }
  const conv = data.conversations[0]
  console.log(`   ✅ Using conversation: "${conv.name || conv.id}" (${conv.id})`)
  return conv.id
}

/**
 * Step 3 — Connect Socket.IO with the JWT
 */
function connectSocket(token) {
  return new Promise((resolve, reject) => {
    console.log(`🔌 Connecting to Socket.IO...`)
    const socket = io(SERVER_URL, {
      auth: { token: token.replace('Bearer ', '') },
      transports: ['websocket']
    })
    socket.on('connect', () => {
      console.log(`   ✅ Connected (socket: ${socket.id})`)
      resolve(socket)
    })
    socket.on('connect_error', (err) => {
      reject(new Error(`Socket connection failed: ${err.message}`))
    })
  })
}

/**
 * Step 4 — Fire messages and record accepted vs blocked for each.
 */
async function runTest(socket, conversationId) {
  console.log(`\n🚀 Firing ${NUM_MESSAGES} messages (limit is ${EXPECTED_LIMIT})...`)
  console.log(`   ─────────────────────────────────────────────`)

  socket.emit('join-conversation', conversationId)
  await sleep(500)

  const attempts = []

  for (let i = 0; i < NUM_MESSAGES; i++) {
    const attempt = await new Promise((resolve) => {
      socket.emit('send-message', {
        conversationId,
        body: `[ratelimit-test] message ${i + 1} — ${Date.now()}`
      }, (response) => {
        if (response.error) {
          resolve({
            index: i + 1,
            accepted: false,
            rateLimited: !!response.rateLimited,
            retryAfter: response.retryAfter || 0,
            error: response.error
          })
        } else {
          resolve({ index: i + 1, accepted: true, rateLimited: false, retryAfter: 0 })
        }
      })
    })

    attempts.push(attempt)

    if (attempt.accepted) {
      process.stdout.write(`   ✓ #${attempt.index} accepted\n`)
    } else if (attempt.rateLimited) {
      process.stdout.write(`   ⛔ #${attempt.index} BLOCKED — retry after ${attempt.retryAfter}s\n`)
    } else {
      process.stdout.write(`   ❌ #${attempt.index} error: ${attempt.error}\n`)
    }
  }

  return attempts
}

/**
 * Step 5 — Evaluate the attempts into a PASS/FAIL verdict.
 */
function evaluate(attempts) {
  const accepted = attempts.filter(a => a.accepted)
  const blocked  = attempts.filter(a => a.rateLimited)
  const errored  = attempts.filter(a => !a.accepted && !a.rateLimited)
  const firstBlock = blocked.length > 0 ? blocked[0].index : null

  const checks = {
    someAccepted: {
      pass: accepted.length > 0,
      detail: `${accepted.length} message(s) accepted`
    },
    limiterFired: {
      pass: blocked.length > 0,
      detail: `${blocked.length} message(s) blocked as rate-limited`
    },
    cooldownReported: {
      pass: blocked.length > 0 && blocked.every(b => b.retryAfter > 0),
      detail: blocked.length > 0
        ? `all blocked sends reported retryAfter > 0 (e.g. ${blocked[0].retryAfter}s)`
        : 'no blocked sends to check'
    },
    firstBlockNearLimit: {
      pass: firstBlock !== null && Math.abs(firstBlock - (EXPECTED_LIMIT + 1)) <= 2,
      detail: firstBlock !== null
        ? `first block at #${firstBlock} (expected ~#${EXPECTED_LIMIT + 1})`
        : 'never blocked'
    },
    noUnexpectedErrors: {
      pass: errored.length === 0,
      detail: errored.length === 0
        ? 'no non-rate-limit errors'
        : `${errored.length} unexpected error(s): ${errored.map(e => e.error).join('; ')}`
    }
  }

  const overallPass = Object.values(checks).every(c => c.pass)

  return {
    overallPass,
    checks,
    summary: {
      totalSent: attempts.length,
      accepted: accepted.length,
      blocked: blocked.length,
      errored: errored.length,
      firstBlockIndex: firstBlock,
      expectedLimit: EXPECTED_LIMIT
    }
  }
}

/**
 * Step 6 — Print the verdict and save the full result to a JSON file.
 */
function reportAndSave(attempts, evaluation, user) {
  const { overallPass, checks, summary } = evaluation

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                 RATE LIMITER TEST RESULTS                     ║
╠═══════════════════════════════════════════════════════════════╣
║  Sent: ${String(summary.totalSent).padEnd(4)}  Accepted: ${String(summary.accepted).padEnd(4)}  Blocked: ${String(summary.blocked).padEnd(4)}  Errors: ${String(summary.errored).padEnd(4)}   ║
║  First block at message #${String(summary.firstBlockIndex ?? 'none').padEnd(4)} (expected ~#${String(summary.expectedLimit + 1).padEnd(4)})        ║
╠═══════════════════════════════════════════════════════════════╣`)

  for (const [name, c] of Object.entries(checks)) {
    const mark = c.pass ? '✅' : '❌'
    console.log(`║  ${mark} ${name.padEnd(22)} ${c.detail.slice(0, 33).padEnd(33)}║`)
  }

  console.log(`╠═══════════════════════════════════════════════════════════════╣`)
  console.log(`║  OVERALL: ${(overallPass ? '✅ PASS' : '❌ FAIL').padEnd(52)}║`)
  console.log(`╚═══════════════════════════════════════════════════════════════╝`)

  if (!summary.blocked) {
    console.log(`
⚠️  Nothing was blocked. Likely causes:
   • Redis isn't configured on the server (limiter allows everything), or
   • The limit is higher than ${NUM_MESSAGES}. Raise NUM_MESSAGES or check REDIS_URL.`)
  }

  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true })
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(RESULTS_DIR, `ratelimit-${stamp}.json`)

  const payload = {
    testedAt: new Date().toISOString(),
    server: SERVER_URL,
    user: { id: user.id, name: user.name },
    config: { expectedLimit: EXPECTED_LIMIT, numMessages: NUM_MESSAGES },
    overallPass,
    checks,
    summary,
    attempts
  }

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2))
  console.log(`\n💾 Results saved to: ${filePath}\n`)

  return overallPass
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  try {
    console.log(`
╔════════════════════════════════════════════════╗
║    SyncUp — Rate Limiter Test                 ║
║    Messages to send: ${NUM_MESSAGES.toString().padEnd(26)}║
║    Expected limit:   ${EXPECTED_LIMIT.toString().padEnd(26)}║
╚════════════════════════════════════════════════╝`)

    const { token, user } = await login()
    const conversationId  = await getConversations(token)
    const socket          = await connectSocket(token)

    const attempts   = await runTest(socket, conversationId)
    const evaluation = evaluate(attempts)
    const passed     = reportAndSave(attempts, evaluation, user)

    socket.disconnect()
    console.log('🔌 Socket disconnected. Test complete.\n')
    process.exit(passed ? 0 : 1)
  } catch (err) {
    console.error(`\n❌ Test failed to run: ${err.message}`)
    process.exit(1)
  }
}

main()
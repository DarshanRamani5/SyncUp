/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║         SyncUp — Kafka vs Sync-DB Benchmark             ║
 * ╠══════════════════════════════════════════════════════════╣
 * ║ Usage:                                                   ║
 * ║   node benchmark.js                                      ║
 * ║                                                          ║
 * ║ What it does:                                            ║
 * ║   1. Logs in to SyncUp with a real user account          ║
 * ║   2. Picks the first conversation found                  ║
 * ║   3. Fires N messages as fast as possible via Socket.IO  ║
 * ║   4. Collects server-side timing from each callback      ║
 * ║   5. Prints a performance summary with percentiles       ║
 * ║                                                          ║
 * ║ How to compare Kafka vs Sync-DB:                         ║
 * ║   Run 1 — with Kafka env vars active   → "kafka" mode    ║
 * ║   Run 2 — comment out AIVEN_KAFKA_HOST → "sync-db" mode  ║
 * ║   Compare the two outputs!                               ║
 * ╚══════════════════════════════════════════════════════════╝
 */

import { io } from 'socket.io-client'

// ─── Configuration ───────────────────────────────────────
const SERVER_URL     = 'http://localhost:5000'
const USER_EMAIL     = 'abc@gmail.com'          // change to your test user
const USER_PASSWORD  = '123456'                 // change to your test user's password
const NUM_MESSAGES   = 50                       // how many messages to fire
// ─────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * Step 1 — Login via REST API to get a JWT token
 */
async function login() {
  console.log(`\n🔐 Logging in as ${USER_EMAIL}...`)
  const res = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD })
  })
  const data = await res.json()
  if (!data.token) {
    throw new Error(`Login failed: ${data.message}`)
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
 * Step 4 — Fire messages and collect timing data
 */
async function runBenchmark(socket, conversationId) {
  console.log(`\n🚀 Firing ${NUM_MESSAGES} messages...`)
  console.log(`   ─────────────────────────────────────────────`)

  // Join the conversation room first
  socket.emit('join-conversation', conversationId)
  await sleep(500)

  const results = []
  let mode = null

  for (let i = 0; i < NUM_MESSAGES; i++) {
    const clientSendTime = performance.now()

    const result = await new Promise((resolve) => {
      socket.emit('send-message', {
        conversationId,
        body: `[benchmark] message ${i + 1} of ${NUM_MESSAGES} — ${Date.now()}`
      }, (response) => {
        const clientRoundTrip = performance.now() - clientSendTime
        if (response.error) {
          console.error(`   ❌ Message ${i + 1} failed: ${response.error}`)
          resolve(null)
        } else {
          const t = response.timing
          if (!mode) mode = t.mode
          resolve({
            index: i + 1,
            mode: t.mode,
            broadcastMs: parseFloat(t.broadcastMs),
            persistMs: parseFloat(t.persistMs),
            totalServerMs: parseFloat(t.totalMs),
            clientRoundTripMs: parseFloat(clientRoundTrip.toFixed(2))
          })
        }
      })
    })

    if (result) {
      results.push(result)
      // Print a dot every 10 messages for progress
      if ((i + 1) % 10 === 0) {
        process.stdout.write(`   ✓ ${i + 1}/${NUM_MESSAGES}\n`)
      }
    }
  }

  return { results, mode }
}

/**
 * Calculate percentiles from a sorted array
 */
function percentile(arr, p) {
  const idx = Math.ceil(arr.length * p / 100) - 1
  return arr[Math.max(0, idx)]
}

/**
 * Step 5 — Print results
 */
function printResults({ results, mode }) {
  if (results.length === 0) {
    console.log('\n❌ No results to display')
    return
  }

  const broadcasts = results.map(r => r.broadcastMs).sort((a, b) => a - b)
  const persists   = results.map(r => r.persistMs).sort((a, b) => a - b)
  const totals     = results.map(r => r.totalServerMs).sort((a, b) => a - b)
  const roundTrips = results.map(r => r.clientRoundTripMs).sort((a, b) => a - b)

  const avg = (arr) => (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)
  const min = (arr) => arr[0].toFixed(2)
  const max = (arr) => arr[arr.length - 1].toFixed(2)

  const modeLabel = mode === 'kafka'
    ? '🟢 KAFKA (async persistence)'
    : '🟡 SYNC-DB (synchronous Prisma write)'

  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           BENCHMARK RESULTS — ${mode.toUpperCase().padEnd(10)}                     ║
║           Mode: ${modeLabel.padEnd(45)}║
║           Messages: ${results.length.toString().padEnd(42)}║
╠═══════════════════════════════════════════════════════════════╣
║  Metric            │  Avg     │  Min     │  P50    │  P95    ║
╠═══════════════════════════════════════════════════════════════╣
║  Broadcast (ms)    │ ${avg(broadcasts).padStart(7)} │ ${min(broadcasts).padStart(7)} │ ${percentile(broadcasts, 50).toFixed(2).padStart(6)} │ ${percentile(broadcasts, 95).toFixed(2).padStart(6)} ║
║  Persist (ms)      │ ${avg(persists).padStart(7)} │ ${min(persists).padStart(7)} │ ${percentile(persists, 50).toFixed(2).padStart(6)} │ ${percentile(persists, 95).toFixed(2).padStart(6)} ║
║  Total Server (ms) │ ${avg(totals).padStart(7)} │ ${min(totals).padStart(7)} │ ${percentile(totals, 50).toFixed(2).padStart(6)} │ ${percentile(totals, 95).toFixed(2).padStart(6)} ║
║  Client RTT (ms)   │ ${avg(roundTrips).padStart(7)} │ ${min(roundTrips).padStart(7)} │ ${percentile(roundTrips, 50).toFixed(2).padStart(6)} │ ${percentile(roundTrips, 95).toFixed(2).padStart(6)} ║
╚═══════════════════════════════════════════════════════════════╝

📝 What these numbers mean:
   • Broadcast: Time to emit the message to all connected clients
   • Persist:   Time to either push to Kafka queue OR write to DB synchronously
   • Total:     End-to-end server processing time per message
   • Client RTT: Round-trip from client send → server callback received

   In Kafka mode, "Persist" = time to enqueue (should be fast).
   In Sync-DB mode, "Persist" = time to write to PostgreSQL (slower).
   The difference in "Persist" is the throughput gain from Kafka.
`)
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  try {
    console.log(`
╔════════════════════════════════════════════════╗
║    SyncUp — Kafka vs Sync-DB Benchmark        ║
║    Messages to send: ${NUM_MESSAGES.toString().padEnd(26)}║
╚════════════════════════════════════════════════╝`)

    const { token, user } = await login()
    const conversationId  = await getConversations(token)
    const socket          = await connectSocket(token)

    const data = await runBenchmark(socket, conversationId)
    printResults(data)

    socket.disconnect()
    console.log('🔌 Socket disconnected. Benchmark complete.\n')
    process.exit(0)
  } catch (err) {
    console.error(`\n❌ Benchmark failed: ${err.message}`)
    process.exit(1)
  }
}

main()

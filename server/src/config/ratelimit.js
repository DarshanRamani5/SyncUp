import { getRedisClient } from './redis.js'

/**
 * Rate Limiter — Sliding Window + Cooldown (Redis-backed)
 *
 * Stops message-flooding spam on the Socket.IO send-message path.
 *
 * How it works:
 *   1. Every send records a timestamp in a Redis sorted set per user:
 *        ratelimit:msgs:<userId>  (score = timestamp ms, member = unique id)
 *   2. On each send we drop timestamps older than the window, then count what's
 *      left. If the count would exceed the limit, the user has been flooding.
 *   3. When the limit is exceeded we set a cooldown key with a TTL:
 *        ratelimit:cooldown:<userId>
 *      While that key exists, every send is blocked and the sender is told how
 *      many seconds remain.
 *
 * Why a sliding window (not fixed): a fixed window lets someone send a full
 * burst at the end of one window and another full burst at the start of the
 * next — double the limit across the boundary. The sliding window looks at the
 * trailing WINDOW_MS continuously, so there's no boundary to exploit.
 *
 * Why Lua: the check (read cooldown → trim old → count → maybe record → maybe
 * set cooldown) must be atomic. Two messages arriving at once could otherwise
 * both read "count = limit - 1" and both pass. Redis runs a Lua script
 * atomically and in a single round-trip.
 *
 * Graceful fallback: if Redis isn't configured, we allow everything (we never
 * want the limiter to block real users just because Redis is down in dev).
 */

// ---- Tunable limits ----
const WINDOW_MS = 10 * 1000      // sliding window length: 10 seconds
const MAX_IN_WINDOW = 20         // max messages allowed within the window
const COOLDOWN_SECONDS = 2 * 60  // how long a tripped user is muted: 2 minutes

/**
 * Lua script run atomically on Redis.
 *
 * KEYS[1] = cooldown key   (ratelimit:cooldown:<userId>)
 * KEYS[2] = sorted-set key  (ratelimit:msgs:<userId>)
 * ARGV[1] = now (ms)
 * ARGV[2] = window start (now - WINDOW_MS)
 * ARGV[3] = max in window
 * ARGV[4] = cooldown seconds
 * ARGV[5] = unique member id (so identical-timestamp sends don't collide)
 *
 * Returns: { allowed (1/0), retryAfterSeconds }
 *   allowed = 1 → message may proceed
 *   allowed = 0 → blocked; retryAfterSeconds = seconds until cooldown ends
 */
const SLIDING_WINDOW_LUA = `
-- 1. If a cooldown is active, block immediately and report remaining time.
local cooldownTtl = redis.call('TTL', KEYS[1])
if cooldownTtl and cooldownTtl > 0 then
  return { 0, cooldownTtl }
end

-- 2. Drop timestamps older than the window (the "sliding" part).
redis.call('ZREMRANGEBYSCORE', KEYS[2], 0, ARGV[2])

-- 3. Count messages remaining in the window.
local count = redis.call('ZCARD', KEYS[2])

-- 4. If adding this one would exceed the limit, start a cooldown and block.
if count >= tonumber(ARGV[3]) then
  redis.call('SET', KEYS[1], '1', 'EX', tonumber(ARGV[4]))
  return { 0, tonumber(ARGV[4]) }
end

-- 5. Otherwise record this message and allow it.
redis.call('ZADD', KEYS[2], ARGV[1], ARGV[5])
-- Keep the set from living forever if the user goes quiet.
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[1]) - tonumber(ARGV[2]))
return { 1, 0 }
`

/**
 * Check whether a user may send a message right now, recording the attempt.
 *
 * @param {string} userId
 * @returns {Promise<{ allowed: boolean, retryAfter: number }>}
 *   allowed    — true if the message may proceed
 *   retryAfter — seconds until the user can send again (0 when allowed)
 */
export const checkMessageRateLimit = async (userId) => {
  const redis = getRedisClient()

  // No Redis → don't rate limit (dev/single-server fallback)
  if (!redis) {
    return { allowed: true, retryAfter: 0 }
  }

  const now = Date.now()
  const windowStart = now - WINDOW_MS
  const cooldownKey = `ratelimit:cooldown:${userId}`
  const setKey = `ratelimit:msgs:${userId}`
  // Unique member: timestamp + random suffix so two sends in the same ms differ
  const member = `${now}-${Math.random().toString(36).slice(2, 8)}`

  try {
    const result = await redis.eval(
      SLIDING_WINDOW_LUA,
      2,                       // number of KEYS
      cooldownKey,             // KEYS[1]
      setKey,                  // KEYS[2]
      now.toString(),          // ARGV[1]
      windowStart.toString(),  // ARGV[2]
      MAX_IN_WINDOW.toString(),// ARGV[3]
      COOLDOWN_SECONDS.toString(), // ARGV[4]
      member                   // ARGV[5]
    )

    // ioredis returns Lua arrays as JS arrays of (mostly) numbers
    const allowed = Number(result[0]) === 1
    const retryAfter = Number(result[1]) || 0
    return { allowed, retryAfter }
  } catch (err) {
    // If the limiter itself errors, fail open — never block real users on a bug
    console.error('Rate limiter error:', err.message)
    return { allowed: true, retryAfter: 0 }
  }
}

export default { checkMessageRateLimit }
import Redis from 'ioredis'

/**
 * Redis Client Factory
 * 
 * Creates and exports Redis client instances for:
 * 1. Socket.IO Redis adapter (pub/sub for multi-server broadcasting)
 * 2. General caching/presence tracking
 * 
 * Uses ioredis which supports:
 * - Upstash Redis (TLS connections)
 * - Local Redis instances
 * - Redis Cluster
 * 
 * Connection string format for Upstash:
 *   rediss://default:<password>@<endpoint>:6379
 *   (note: rediss:// with double 's' for TLS)
 * 
 * For local Redis:
 *   redis://localhost:6379
 */

const REDIS_URL = process.env.REDIS_URL

if (!REDIS_URL) {
  console.warn('⚠️  REDIS_URL not set — Socket.IO will run without Redis adapter (single-server mode)')
}

/**
 * Create a new Redis client instance.
 * Each caller gets its own connection (required for pub/sub).
 * 
 * Why separate instances?
 * Redis pub/sub requires dedicated connections — a client in "subscribe" mode
 * can't run normal commands. So Socket.IO's adapter needs two clients:
 * one for publishing, one for subscribing.
 */
export const createRedisClient = () => {
  if (!REDIS_URL) return null

  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 500,
    // Upstash requires TLS — ioredis auto-detects from rediss:// URL
    lazyConnect: true,
    // Reconnect strategy: exponential backoff, max 5 seconds
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000)
      return delay
    }
  })

  client.on('connect', () => {
    console.log('🔴 Redis client connected')
  })

  client.on('error', (err) => {
    console.error('🔴 Redis client error:', err.message)
  })

  return client
}

/**
 * Singleton Redis client for general use (caching, presence, etc.)
 * Not for pub/sub — use createRedisClient() for that.
 */
let mainClient = null

export const getRedisClient = () => {
  if (!mainClient && REDIS_URL) {
    mainClient = createRedisClient()
    mainClient.connect().catch(err => {
      console.error('🔴 Redis main client connection failed:', err.message)
    })
  }
  return mainClient
}

export default { createRedisClient, getRedisClient }

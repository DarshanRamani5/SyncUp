import jwt from 'jsonwebtoken'
import { createAdapter } from '@socket.io/redis-adapter'
import { createRedisClient, getRedisClient } from './config/redis.js'
import { produceMessage } from './config/kafka.js'
import { deleteImage } from './config/cloudinary.js'
import { checkMessageRateLimit } from './config/ratelimit.js'
import prisma from './lib/prisma.js'
import crypto from 'crypto'

/**
 * Socket.IO Server Setup
 * 
 * This file handles the entire real-time layer:
 * 
 * 1. AUTH HANDSHAKE
 *    - Client connects with { auth: { token: "<jwt>" } }
 *    - We verify the JWT in the middleware before allowing connection
 *    - Attach user data to socket.user for later use
 * 
 * 2. REDIS ADAPTER (optional)
 *    - If REDIS_URL is set, Socket.IO uses Redis pub/sub to broadcast
 *      events across multiple server instances (horizontal scaling)
 *    - If not set, falls back to in-memory (single-server mode)
 * 
 * 3. SOCKET EVENTS
 *    - join-conversation: Client joins a conversation room
 *    - send-message: Client sends a message (broadcast + persist)
 *    - receive-message: Server → Client, a new message arrived
 *    - user-online / user-offline: Presence system
 *    - typing: Typing indicators
 * 
 * 4. PRESENCE TRACKING (Redis-backed with in-memory fallback)
 * 
 *    Redis keys used:
 *      "presence:online"           → SET of all online userIds
 *      "presence:sockets:<userId>" → SET of socketIds for that user
 *      "presence:socket-user"      → HASH mapping socketId → userId
 * 
 *    Why Redis for presence?
 *    - Survives server restarts (users don't all appear offline briefly)
 *    - Works across multiple server instances (horizontal scaling)
 *    - Fast: ~1-2ms per operation via Upstash
 * 
 *    Fallback: If REDIS_URL is not set, uses a plain JavaScript Map
 *    (works fine for single-server development).
 */

// ============================================================
// PRESENCE STORE — Redis-backed with in-memory fallback
// ============================================================
const presenceStore = {
  /**
   * In-memory fallback: userId → Set<socketId>
   * Only used when Redis is unavailable
   */
  _inMemory: new Map(),

  /**
   * Register a socket connection for a user.
   * Returns true if this is the user's FIRST socket (they just came online).
   * 
   * Redis keys touched:
   *   SADD presence:sockets:<userId> <socketId>
   *   SADD presence:online <userId>
   *   HSET presence:socket-user <socketId> <userId>
   */
  async addSocket(userId, socketId) {
    const redis = getRedisClient()

    if (redis) {
      try {
        // Add socket to user's socket set
        await redis.sadd(`presence:sockets:${userId}`, socketId)
        // Add user to the global online set
        await redis.sadd('presence:online', userId)
        // Reverse lookup: socketId → userId (needed on disconnect)
        await redis.hset('presence:socket-user', socketId, userId)
        // Check how many sockets this user has
        const count = await redis.scard(`presence:sockets:${userId}`)
        return count === 1 // true = first socket = user just came online
      } catch (err) {
        console.error('Presence addSocket Redis error:', err.message)
        // Fall through to in-memory
      }
    }

    // In-memory fallback
    if (!this._inMemory.has(userId)) {
      this._inMemory.set(userId, new Set())
    }
    this._inMemory.get(userId).add(socketId)
    return this._inMemory.get(userId).size === 1
  },

  /**
   * Remove a socket connection for a user.
   * Returns true if the user has NO remaining sockets (they went fully offline).
   * 
   * Redis keys touched:
   *   SREM presence:sockets:<userId> <socketId>
   *   HDEL presence:socket-user <socketId>
   *   SCARD presence:sockets:<userId>  → if 0:
   *     SREM presence:online <userId>
   *     DEL  presence:sockets:<userId>
   */
  async removeSocket(userId, socketId) {
    const redis = getRedisClient()

    if (redis) {
      try {
        // Remove this socket from the user's set
        await redis.srem(`presence:sockets:${userId}`, socketId)
        // Remove the reverse lookup
        await redis.hdel('presence:socket-user', socketId)
        // Check remaining sockets
        const remaining = await redis.scard(`presence:sockets:${userId}`)

        if (remaining === 0) {
          // User has no more connections — fully offline
          await redis.srem('presence:online', userId)
          await redis.del(`presence:sockets:${userId}`)
          return true // user went offline
        }
        return false // user still has other tabs open
      } catch (err) {
        console.error('Presence removeSocket Redis error:', err.message)
        // Fall through to in-memory
      }
    }

    // In-memory fallback
    const sockets = this._inMemory.get(userId)
    if (sockets) {
      sockets.delete(socketId)
      if (sockets.size === 0) {
        this._inMemory.delete(userId)
        return true
      }
    }
    return false
  },

  /**
   * Get all currently online user IDs.
   * 
   * Redis: SMEMBERS presence:online
   * Fallback: Map.keys()
   */
  async getOnlineUsers() {
    const redis = getRedisClient()

    if (redis) {
      try {
        return await redis.smembers('presence:online')
      } catch (err) {
        console.error('Presence getOnlineUsers Redis error:', err.message)
      }
    }

    // In-memory fallback
    return Array.from(this._inMemory.keys())
  }
}

/**
 * Set up the Socket.IO server with auth, Redis adapter, and event handlers
 * @param {Server} io — Socket.IO server instance
 */
export const setupSocketServer = async (io) => {
  // --- Redis Adapter Setup ---
  // Creates two dedicated Redis connections for pub/sub
  const pubClient = createRedisClient()
  const subClient = createRedisClient()

  if (pubClient && subClient) {
    try {
      await pubClient.connect()
      await subClient.connect()
      io.adapter(createAdapter(pubClient, subClient))
      console.log('🔌 Socket.IO Redis adapter connected')
    } catch (err) {
      console.error('🔌 Redis adapter failed, using in-memory:', err.message)
    }
  } else {
    console.log('🔌 Socket.IO running in single-server mode (no Redis)')
  }

  // Initialize the general-purpose Redis client (for presence tracking)
  // This is a no-op if REDIS_URL is not set
  const redis = getRedisClient()

  // Clear stale presence data from previous server sessions
  // Without this, users who were online before a restart appear permanently online
  if (redis) {
    try {
      // Get all keys matching presence:sockets:* and delete them
      const socketKeys = await redis.keys('presence:sockets:*')
      if (socketKeys.length > 0) {
        await redis.del(socketKeys)
      }
      await redis.del('presence:online')
      await redis.del('presence:socket-user')
      console.log('🔌 Cleared stale presence data from Redis')
    } catch (err) {
      console.error('🔌 Failed to clear stale presence:', err.message)
    }
  }
  // Also clear in-memory fallback
  presenceStore._inMemory.clear()

  // --- Auth Middleware ---
  // Runs BEFORE the connection is established
  // If the token is invalid, the client gets a "connect_error" event
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token

    if (!token) {
      return next(new Error('Authentication error — no token provided'))
    }

    const secret = process.env.JWT_SECRET
    if (!secret) {
      return next(new Error('Server configuration error'))
    }

    try {
      // Verify the JWT — same secret as the REST API
      const decoded = jwt.verify(token, secret)
      // Attach user data to the socket for use in event handlers
      socket.user = {
        id: decoded.id,
        name: decoded.name,
        email: decoded.email
      }
      next()
    } catch (err) {
      return next(new Error('Authentication error — invalid token'))
    }
  })

  // --- Connection Handler ---
  io.on('connection', async (socket) => {
    const userId = socket.user.id
    console.log(`🔌 User connected: ${socket.user.name} (${userId}) — socket: ${socket.id}`)

    // --- Track online status via Redis (or in-memory fallback) ---
    const isFirstSocket = await presenceStore.addSocket(userId, socket.id)

    // Broadcast that this user is online (only if first connection)
    if (isFirstSocket) {
      socket.broadcast.emit('user-online', { userId })
    }

    // Send the current online users list to the newly connected client
    const onlineUserIds = await presenceStore.getOnlineUsers()
    socket.emit('online-users', onlineUserIds)

    // --------------------------------------------------
    // EVENT: join-conversation
    // --------------------------------------------------
    // Client calls this when they select a conversation
    // The socket joins a "room" named by the conversation ID
    // All messages for that conversation are broadcast to the room
    socket.on('join-conversation', (conversationId) => {
      socket.join(conversationId)
      console.log(`   ${socket.user.name} joined room: ${conversationId}`)
    })

    // --------------------------------------------------
    // EVENT: leave-conversation
    // --------------------------------------------------
    socket.on('leave-conversation', (conversationId) => {
      socket.leave(conversationId)
      console.log(`   ${socket.user.name} left room: ${conversationId}`)
    })

    // --------------------------------------------------
    // EVENT: send-message
    // --------------------------------------------------
    // Client sends a message to a conversation
    //
    // Flow (Kafka mode — optimistic, matching PulseChat architecture):
    //   1. Build an optimistic message object with user data + timestamp
    //   2. Broadcast IMMEDIATELY to all users in the room
    //   3. Publish to Kafka topic "MESSAGES" for async DB persistence
    //   4. Kafka consumer picks it up → Prisma $transaction → PostgreSQL
    //
    // Fallback (no Kafka):
    //   If Kafka is not configured or produce fails, falls back to
    //   synchronous Prisma write (the pre-Kafka behavior).
    socket.on('send-message', async (data, callback) => {
      const t0 = performance.now()
      try {
        const { conversationId, body, image, public_id } = data

        // A message must have at least text or an image (image-only is allowed)
        if (!conversationId || (!body && !image)) {
          if (callback) callback({ error: 'conversationId and a body or image are required' })
          return
        }

        // --- Rate limit (anti-spam) ---
        // Sliding-window check BEFORE we broadcast or persist anything. If the
        // user is flooding, they're put on a short cooldown and the message is
        // dropped. We tell the sender how long until they can send again.
        const { allowed, retryAfter } = await checkMessageRateLimit(userId)
        if (!allowed) {
          if (callback) {
            callback({
              error: `You're sending messages too fast. Please wait ${retryAfter}s.`,
              rateLimited: true,
              retryAfter
            })
          }
          return
        }

        const now = new Date()
        const messageId = crypto.randomUUID()

        // Build the optimistic message object
        // This is what clients will see immediately (before DB persistence)
        const optimisticMessage = {
          id: messageId,
          body: body || null,
          image: image || null,
          public_id: public_id || null,
          conversationId,
          userId,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          createdBy: {
            id: socket.user.id,
            name: socket.user.name,
            email: socket.user.email,
            avatarUrl: socket.user.avatarUrl || null
          }
        }

        // ---- BROADCAST IMMEDIATELY (optimistic) ----
        // Clients see the message instantly — no waiting for DB write
        io.to(conversationId).emit('receive-message', optimisticMessage)

        // Notify sidebar about the conversation update
        io.emit('conversation-updated', {
          conversationId,
          lastMessage: optimisticMessage
        })

        const tBroadcast = performance.now()

        // ---- PUBLISH TO KAFKA (async persistence) ----
        const kafkaPayload = {
          id: messageId,
          body: body || null,
          image: image || null,
          public_id: public_id || null,
          conversationId,
          userId,
          createdAt: now.toISOString()
        }

        const produced = await produceMessage(kafkaPayload)

        if (!produced) {
          // ---- FALLBACK: Synchronous Prisma write ----
          // Kafka not available — save to DB directly (pre-Kafka behavior)
          console.log('📨 Kafka unavailable, falling back to synchronous DB write')

          await prisma.$transaction([
            prisma.message.create({
              data: {
                id: messageId,
                body: body || null,
                image: image || null,
                public_id: public_id || null,
                conversationId,
                userId,
                createdAt: now
              }
            }),
            prisma.conversation.update({
              where: { id: conversationId },
              data: { lastMessageAt: now }
            })
          ])
        }

        const tPersist = performance.now()
        const mode = produced ? 'kafka' : 'sync-db'
        const broadcastMs = (tBroadcast - t0).toFixed(2)
        const persistMs = (tPersist - tBroadcast).toFixed(2)
        const totalMs = (tPersist - t0).toFixed(2)
        console.log(`⏱️  [${mode}] broadcast=${broadcastMs}ms  persist=${persistMs}ms  total=${totalMs}ms`)

        // Acknowledge success to the sender
        if (callback) callback({ success: true, message: optimisticMessage, timing: { mode, broadcastMs, persistMs, totalMs } })

      } catch (error) {
        console.error('send-message error:', error)
        if (callback) callback({ error: 'Failed to send message' })
      }
    })

    // --------------------------------------------------
    // EVENT: typing
    // --------------------------------------------------
    // Broadcast typing indicators to the conversation room
    socket.on('typing', ({ conversationId, isTyping }) => {
      socket.to(conversationId).emit('user-typing', {
        userId,
        userName: socket.user.name,
        conversationId,
        isTyping
      })
    })

    // --------------------------------------------------
    // EVENT: mark-messages-read
    // --------------------------------------------------
    socket.on('mark-messages-read', async ({ conversationId, messageIds }) => {
      try {
        if (!messageIds || messageIds.length === 0) return

        // Filter out optimistic temp IDs (those aren't in the DB)
        const realMessageIds = messageIds.filter(id => !id.startsWith('temp-'))

        if (realMessageIds.length > 0) {
          // Connect the current user to each message's seenBy relation.
          //
          // Why the retry: messages sent via Kafka are broadcast instantly but
          // persisted to PostgreSQL a moment later by the consumer. If we try to
          // mark one read before the consumer has written it, the row doesn't
          // exist yet. Previously that error was swallowed and the "seen" status
          // was lost forever — so on restart those messages re-counted as unread
          // (the phantom "45 unseen"). We now retry any IDs that weren't found
          // yet, giving Kafka time to catch up.
          const connectSeen = async (ids) => {
            const results = await Promise.all(
              ids.map(async (msgId) => {
                try {
                  await prisma.message.update({
                    where: { id: msgId },
                    data: { seenBy: { connect: { id: userId } } }
                  })
                  return { msgId, ok: true }
                } catch {
                  // Row not in the DB yet (Kafka still persisting) → mark for retry
                  return { msgId, ok: false }
                }
              })
            )
            // Return the IDs that didn't land, so we can retry just those
            return results.filter(r => !r.ok).map(r => r.msgId)
          }

          let pending = await connectSeen(realMessageIds)

          // Retry the stragglers a couple of times, giving the Kafka consumer
          // time to persist them. Short and bounded — not an infinite loop.
          for (let attempt = 0; attempt < 2 && pending.length > 0; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 600))
            pending = await connectSeen(pending)
          }
        }
        // Broadcast to room so the sender sees the blue double-tick
        socket.to(conversationId).emit('messages-read', {
          conversationId,
          messageIds,
          userId
        })
      } catch (error) {
        console.error('mark-messages-read error:', error)
      }
    })

    // --------------------------------------------------
    // EVENT: edit-message
    // --------------------------------------------------
    socket.on('edit-message', async ({ messageId, conversationId, body }, callback) => {
      try {
        if (!messageId || !body) return

        // Update DB
        const updatedMessage = await prisma.message.update({
          where: { 
            id: messageId,
            userId: userId // Ensure user owns the message
          },
          data: { 
            body,
            isEdited: true 
          }
        })

        // Broadcast to room
        io.to(conversationId).emit('message-edited', {
          messageId,
          conversationId,
          body,
          updatedAt: updatedMessage.updatedAt
        })

        if (callback) callback({ success: true })
      } catch (error) {
        console.error('edit-message error:', error)
        if (callback) callback({ error: 'Failed to edit message' })
      }
    })

    // --------------------------------------------------
    // EVENT: delete-message (Delete for Everyone)
    // --------------------------------------------------
    // Only the sender can delete for everyone.
    // Sets isDeleted = true so the message shows as "This message was deleted".
    socket.on('delete-message', async ({ messageId, conversationId }, callback) => {
      try {
        if (!messageId) return

        // Soft-delete: mark as deleted (only sender can do this).
        // We also clear the image fields and remove the Cloudinary asset so we
        // don't leave orphaned files in the media library. We read the message
        // first to grab its public_id before clearing it.
        const existing = await prisma.message.findFirst({
          where: { id: messageId, userId },
          select: { public_id: true }
        })

        await prisma.message.update({
          where: { 
            id: messageId,
            userId: userId // Ensure user owns the message
          },
          data: { 
            isDeleted: true,
            body: null,      // Clear the body
            image: null,     // Clear the image URL
            public_id: null  // Clear the Cloudinary reference
          }
        })

        // Remove the underlying file from Cloudinary (no-op if there wasn't one)
        if (existing?.public_id) {
          await deleteImage(existing.public_id)
        }

        // Broadcast to room so everyone sees the "deleted" placeholder
        io.to(conversationId).emit('message-deleted', {
          messageId,
          conversationId
        })

        // Also broadcast via io.emit for users not in the room (sidebar update)
        io.emit('conversation-updated-delete', {
          conversationId,
          messageId
        })

        if (callback) callback({ success: true })
      } catch (error) {
        console.error('delete-message error:', error)
        if (callback) callback({ error: 'Failed to delete message' })
      }
    })

    // --------------------------------------------------
    // EVENT: delete-for-me
    // --------------------------------------------------
    // Any user can delete any message for themselves only.
    // The message remains visible to the other user.
    socket.on('delete-for-me', async ({ messageIds, conversationId }, callback) => {
      try {
        if (!messageIds || messageIds.length === 0) return

        // Connect the current user to the deletedBy relation for each message
        await Promise.all(
          messageIds.map(msgId =>
            prisma.message.update({
              where: { id: msgId },
              data: { deletedBy: { connect: { id: userId } } }
            }).catch(e => { /* ignore if already connected or not found */ })
          )
        )

        if (callback) callback({ success: true })
      } catch (error) {
        console.error('delete-for-me error:', error)
        if (callback) callback({ error: 'Failed to delete messages' })
      }
    })

    // --------------------------------------------------
    // EVENT: disconnect
    // --------------------------------------------------
    socket.on('disconnect', async (reason) => {
      console.log(`🔌 User disconnected: ${socket.user.name} (${reason})`)

      // Remove this socket from presence tracking
      const isFullyOffline = await presenceStore.removeSocket(userId, socket.id)

      // If no more sockets, user is fully offline
      if (isFullyOffline) {
        socket.broadcast.emit('user-offline', { userId })
      }
    })
  })
}

/**
 * Get the list of currently online user IDs
 * Useful for REST API endpoints that need presence info
 */
export const getOnlineUsers = async () => {
  return presenceStore.getOnlineUsers()
}

export default { setupSocketServer, getOnlineUsers }

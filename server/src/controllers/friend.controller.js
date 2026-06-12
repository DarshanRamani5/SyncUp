import prisma from '../lib/prisma.js'
import { getIO } from '../socket.js'

/**
 * Friend Controller
 *
 * The "Friends Only" system (WhatsApp/Facebook style):
 * - sendRequest:      POST   /api/friends/requests        — send a friend request
 * - getRequests:      GET    /api/friends/requests        — my pending requests (incoming + outgoing)
 * - respondToRequest: PUT    /api/friends/requests/:id    — accept or decline (receiver only)
 * - cancelRequest:    DELETE /api/friends/requests/:id    — cancel my pending request (sender only)
 * - getFriends:       GET    /api/friends                 — my friends list
 * - unfriend:         DELETE /api/friends/:friendId       — remove a friend
 *
 * REAL-TIME (NEW):
 * - 'friend-request-received' { from }  → receiver, when a request arrives
 * - 'friend-requests-updated' {}        → the OTHER party after accept /
 *                                         decline / cancel / unfriend,
 *                                         so badges and lists refresh live
 */

// Safe fields to return for any user in friend-related responses.
const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  username: true,
  avatarUrl: true,
  color: true
}

/** Best-effort socket push to users' personal rooms */
const notifyUsers = (userIds, event, payload = {}) => {
  try {
    const io = getIO()
    if (!io) return
    userIds.forEach(id => io.to(`user:${id}`).emit(event, payload))
  } catch (err) {
    console.error('notifyUsers error:', err.message)
  }
}

const areFriends = async (userIdA, userIdB) => {
  const user = await prisma.user.findFirst({
    where: {
      id: userIdA,
      OR: [
        { friendsWith: { some: { id: userIdB } } },
        { friendOf: { some: { id: userIdB } } }
      ]
    },
    select: { id: true }
  })
  return !!user
}

/**
 * POST /api/friends/requests
 */
const sendRequest = async (req, res) => {
  try {
    const senderId = req.user.id
    const { receiverId } = req.body

    if (!receiverId) {
      return res.status(400).json({ status: 400, message: 'receiverId is required' })
    }

    if (receiverId === senderId) {
      return res.status(400).json({ status: 400, message: "You can't send a friend request to yourself" })
    }

    const receiver = await prisma.user.findUnique({
      where: { id: receiverId },
      select: PUBLIC_USER_SELECT
    })
    if (!receiver) {
      return res.status(404).json({ status: 404, message: 'User not found' })
    }

    if (await areFriends(senderId, receiverId)) {
      return res.status(409).json({ status: 409, message: 'You are already friends with this user' })
    }

    const reverseRequest = await prisma.friendRequest.findUnique({
      where: {
        senderId_receiverId: { senderId: receiverId, receiverId: senderId }
      }
    })
    if (reverseRequest?.status === 'pending') {
      return res.status(409).json({
        status: 409,
        message: `@${receiver.username} already sent you a friend request — check your Requests tab`
      })
    }

    const existingRequest = await prisma.friendRequest.findUnique({
      where: {
        senderId_receiverId: { senderId, receiverId }
      }
    })

    let request

    if (existingRequest) {
      if (existingRequest.status === 'pending') {
        return res.status(409).json({ status: 409, message: 'Friend request already sent' })
      }
      request = await prisma.friendRequest.update({
        where: { id: existingRequest.id },
        data: { status: 'pending' },
        include: { receiver: { select: PUBLIC_USER_SELECT } }
      })
    } else {
      request = await prisma.friendRequest.create({
        data: { senderId, receiverId },
        include: { receiver: { select: PUBLIC_USER_SELECT } }
      })
    }

    // Live notification → receiver's badge updates instantly
    notifyUsers([receiverId], 'friend-request-received', {
      from: { id: senderId, name: req.user.name, username: req.user.username }
    })

    return res.status(201).json({
      status: 201,
      message: `Friend request sent to @${receiver.username}`,
      request
    })
  } catch (error) {
    console.error('sendRequest error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

/**
 * GET /api/friends/requests
 */
const getRequests = async (req, res) => {
  try {
    const userId = req.user.id

    const [incoming, outgoing] = await Promise.all([
      prisma.friendRequest.findMany({
        where: { receiverId: userId, status: 'pending' },
        include: { sender: { select: PUBLIC_USER_SELECT } },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.friendRequest.findMany({
        where: { senderId: userId, status: 'pending' },
        include: { receiver: { select: PUBLIC_USER_SELECT } },
        orderBy: { createdAt: 'desc' }
      })
    ])

    return res.status(200).json({ status: 200, incoming, outgoing })
  } catch (error) {
    console.error('getRequests error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

/**
 * PUT /api/friends/requests/:id
 */
const respondToRequest = async (req, res) => {
  try {
    const userId = req.user.id
    const requestId = parseInt(req.params.id, 10)
    const { action } = req.body

    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ status: 400, message: "action must be 'accept' or 'decline'" })
    }

    const request = await prisma.friendRequest.findUnique({
      where: { id: requestId },
      include: { sender: { select: PUBLIC_USER_SELECT } }
    })

    if (!request) {
      return res.status(404).json({ status: 404, message: 'Friend request not found' })
    }

    if (request.receiverId !== userId) {
      return res.status(403).json({ status: 403, message: 'This request was not sent to you' })
    }

    if (request.status !== 'pending') {
      return res.status(409).json({ status: 409, message: 'This request has already been handled' })
    }

    if (action === 'decline') {
      await prisma.friendRequest.update({
        where: { id: requestId },
        data: { status: 'declined' }
      })
      // Sender's "Sent by you" list refreshes (their pending item is gone)
      notifyUsers([request.senderId], 'friend-requests-updated')
      return res.status(200).json({ status: 200, message: 'Friend request declined' })
    }

    // --- Accept: transaction (request status + both relation sides) ---
    await prisma.$transaction([
      prisma.friendRequest.update({
        where: { id: requestId },
        data: { status: 'accepted' }
      }),
      prisma.user.update({
        where: { id: userId },
        data: { friendsWith: { connect: { id: request.senderId } } }
      }),
      prisma.user.update({
        where: { id: request.senderId },
        data: { friendsWith: { connect: { id: userId } } }
      })
    ])

    // Sender instantly sees the new friend / cleared outgoing request
    notifyUsers([request.senderId], 'friend-requests-updated')

    return res.status(200).json({
      status: 200,
      message: `You are now friends with @${request.sender.username}`,
      friend: request.sender
    })
  } catch (error) {
    console.error('respondToRequest error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

/**
 * DELETE /api/friends/requests/:id
 */
const cancelRequest = async (req, res) => {
  try {
    const userId = req.user.id
    const requestId = parseInt(req.params.id, 10)

    const request = await prisma.friendRequest.findUnique({ where: { id: requestId } })

    if (!request) {
      return res.status(404).json({ status: 404, message: 'Friend request not found' })
    }

    if (request.senderId !== userId) {
      return res.status(403).json({ status: 403, message: 'You can only cancel requests you sent' })
    }

    if (request.status !== 'pending') {
      return res.status(409).json({ status: 409, message: 'This request has already been handled' })
    }

    await prisma.friendRequest.delete({ where: { id: requestId } })

    // Receiver's badge count drops instantly
    notifyUsers([request.receiverId], 'friend-requests-updated')

    return res.status(200).json({ status: 200, message: 'Friend request cancelled' })
  } catch (error) {
    console.error('cancelRequest error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

/**
 * GET /api/friends
 */
const getFriends = async (req, res) => {
  try {
    const me = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        friendsWith: { select: PUBLIC_USER_SELECT },
        friendOf: { select: PUBLIC_USER_SELECT }
      }
    })

    if (!me) {
      return res.status(404).json({ status: 404, message: 'User not found' })
    }

    const map = new Map()
    for (const f of [...me.friendsWith, ...me.friendOf]) {
      map.set(f.id, f)
    }
    const friends = Array.from(map.values()).sort((a, b) =>
      (a.name || '').localeCompare(b.name || '')
    )

    return res.status(200).json({ status: 200, friends })
  } catch (error) {
    console.error('getFriends error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

/**
 * DELETE /api/friends/:friendId
 */
const unfriend = async (req, res) => {
  try {
    const userId = req.user.id
    const { friendId } = req.params

    if (!(await areFriends(userId, friendId))) {
      return res.status(404).json({ status: 404, message: 'This user is not in your friends list' })
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          friendsWith: { disconnect: { id: friendId } },
          friendOf: { disconnect: { id: friendId } }
        }
      }),
      prisma.user.update({
        where: { id: friendId },
        data: {
          friendsWith: { disconnect: { id: userId } },
          friendOf: { disconnect: { id: userId } }
        }
      }),
      prisma.friendRequest.deleteMany({
        where: {
          OR: [
            { senderId: userId, receiverId: friendId },
            { senderId: friendId, receiverId: userId }
          ]
        }
      })
    ])

    // The other person's friends list / open chat refreshes
    notifyUsers([friendId], 'friend-requests-updated')

    return res.status(200).json({ status: 200, message: 'Friend removed' })
  } catch (error) {
    console.error('unfriend error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

export {
  sendRequest,
  getRequests,
  respondToRequest,
  cancelRequest,
  getFriends,
  unfriend
}
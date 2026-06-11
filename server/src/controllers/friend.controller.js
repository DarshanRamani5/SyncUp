import prisma from '../lib/prisma.js'

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
 */

// Safe fields to return for any user in friend-related responses.
// NEVER include email — friends find each other by @username.
const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  username: true,
  avatarUrl: true,
  color: true
}

/**
 * Helper: are these two users already friends?
 * We connect the relation BOTH ways on accept, so checking one side is enough,
 * but we check both to be safe against any older one-sided data.
 */
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
 * Body: { receiverId }
 *
 * Rules:
 * - Can't friend yourself
 * - Can't send if already friends
 * - If THEY already sent YOU a pending request → tell user to accept it instead
 * - If you already have a pending request to them → 409
 * - If an old request exists (declined, or accepted-then-unfriended) → reset it
 *   back to pending (this is why FriendRequest has @@unique([senderId, receiverId]))
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

    // Receiver must exist
    const receiver = await prisma.user.findUnique({
      where: { id: receiverId },
      select: PUBLIC_USER_SELECT
    })
    if (!receiver) {
      return res.status(404).json({ status: 404, message: 'User not found' })
    }

    // Already friends?
    if (await areFriends(senderId, receiverId)) {
      return res.status(409).json({ status: 409, message: 'You are already friends with this user' })
    }

    // Did THEY already send ME a pending request? (reverse direction)
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

    // My own previous request to them (if any)
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
      // declined (or stale accepted after an unfriend) → reset to pending
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
 *
 * Returns BOTH directions of pending requests:
 * - incoming: requests sent TO me (I can accept/decline)
 * - outgoing: requests sent BY me (I can cancel)
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
 * Body: { action: 'accept' | 'decline' }
 *
 * Only the RECEIVER of a pending request can respond to it.
 * On accept, we do THREE writes in one transaction (all-or-nothing):
 *   1. mark the request accepted
 *   2. connect sender → receiver in the Friends relation
 *   3. connect receiver → sender in the Friends relation
 * Connecting both directions makes "who are my friends" queries trivial.
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

    // Only the receiver can accept/decline
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
 *
 * Cancel a pending request you sent. Sender only.
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

    return res.status(200).json({ status: 200, message: 'Friend request cancelled' })
  } catch (error) {
    console.error('cancelRequest error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

/**
 * GET /api/friends
 *
 * Returns the current user's friends list.
 * We read both sides of the self-relation and merge + dedupe,
 * which keeps this correct even if some old data is one-sided.
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

    // Merge both directions, dedupe by id
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
 *
 * Unfriend: disconnect BOTH directions of the relation, and delete any
 * FriendRequest rows between the pair so a future re-add starts clean
 * (important because of the @@unique([senderId, receiverId]) constraint).
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
import prisma from '../lib/prisma.js'

/**
 * Group Controller
 *
 * Group chat lifecycle:
 * - createGroup:  POST   /api/conversations/group                 — create a group from your friends
 * - updateGroup:  PUT    /api/conversations/:id/group             — rename (admin only)
 * - addMembers:   POST   /api/conversations/:id/members           — add friends (admin only)
 * - removeMember: DELETE /api/conversations/:id/members/:userId   — kick a member (admin only)
 * - leaveGroup:   POST   /api/conversations/:id/leave             — leave; promotes a new admin if needed
 *
 * Admin rules:
 * - The creator is the first admin.
 * - Only admins can rename, add, or remove members.
 * - Admins cannot remove themselves (they leave instead).
 * - If the last admin leaves, the longest-standing remaining member is promoted.
 * - If the last member leaves, the group and its messages are deleted.
 */

// What we return for each participant. No emails — usernames only.
const GROUP_USERS_INCLUDE = {
  users: {
    include: {
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          avatarUrl: true,
          color: true
        }
      }
    }
  }
}

/**
 * Helper: the current user's friend ids (both relation directions, deduped).
 */
const getFriendIds = async (userId) => {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      friendsWith: { select: { id: true } },
      friendOf: { select: { id: true } }
    }
  })
  if (!me) return new Set()
  return new Set([...me.friendsWith, ...me.friendOf].map(f => f.id))
}

/**
 * Helper: load a group conversation and the requester's membership row.
 * Returns { error, status } on failure, or { conversation, membership }.
 */
const loadGroupAndMembership = async (conversationId, userId) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { users: true }
  })

  if (!conversation) return { error: 'Conversation not found', status: 404 }
  if (!conversation.isGroup) return { error: 'This is not a group conversation', status: 400 }

  const membership = conversation.users.find(u => u.userId === userId)
  if (!membership) return { error: 'You are not a member of this group', status: 403 }

  return { conversation, membership }
}

/**
 * POST /api/conversations/group
 * Body: { name: "Weekend Trip", memberIds: ["id1", "id2", ...] }
 *
 * Creates a group with the current user as admin.
 * Rules: name required; at least 2 other members (a group is 3+ people);
 * every member must be on the creator's friends list.
 */
const createGroup = async (req, res) => {
  try {
    const creatorId = req.user.id
    const name = (req.body.name || '').trim()
    // Dedupe and drop the creator if they included themselves
    const memberIds = [...new Set(req.body.memberIds || [])].filter(id => id !== creatorId)

    if (!name) {
      return res.status(400).json({ status: 400, message: 'Group name is required' })
    }
    if (name.length > 100) {
      return res.status(400).json({ status: 400, message: 'Group name must be under 100 characters' })
    }
    if (memberIds.length < 2) {
      return res.status(400).json({ status: 400, message: 'Select at least 2 friends — a group needs 3+ people' })
    }

    // Every member must be the creator's friend
    const friendIds = await getFriendIds(creatorId)
    const nonFriends = memberIds.filter(id => !friendIds.has(id))
    if (nonFriends.length > 0) {
      return res.status(403).json({
        status: 403,
        message: 'You can only add people from your friends list to a group'
      })
    }

    const conversation = await prisma.conversation.create({
      data: {
        isGroup: true,
        name,
        users: {
          create: [
            { userId: creatorId, isAdmin: true },          // creator = admin
            ...memberIds.map(id => ({ userId: id }))       // members
          ]
        }
      },
      include: GROUP_USERS_INCLUDE
    })

    return res.status(201).json({
      status: 201,
      message: 'Group created',
      conversation
    })
  } catch (error) {
    console.error('createGroup error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

/**
 * PUT /api/conversations/:id/group
 * Body: { name }
 * Rename the group — admin only.
 */
const updateGroup = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.id
    const name = (req.body.name || '').trim()

    if (!name) {
      return res.status(400).json({ status: 400, message: 'Group name is required' })
    }
    if (name.length > 100) {
      return res.status(400).json({ status: 400, message: 'Group name must be under 100 characters' })
    }

    const result = await loadGroupAndMembership(id, userId)
    if (result.error) {
      return res.status(result.status).json({ status: result.status, message: result.error })
    }
    if (!result.membership.isAdmin) {
      return res.status(403).json({ status: 403, message: 'Only group admins can rename the group' })
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: { name },
      include: GROUP_USERS_INCLUDE
    })

    return res.status(200).json({ status: 200, message: 'Group renamed', conversation })
  } catch (error) {
    console.error('updateGroup error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

/**
 * POST /api/conversations/:id/members
 * Body: { memberIds: [...] }
 * Add members — admin only; new members must be the admin's friends.
 */
const addMembers = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.id
    const memberIds = [...new Set(req.body.memberIds || [])]

    if (memberIds.length === 0) {
      return res.status(400).json({ status: 400, message: 'memberIds is required' })
    }

    const result = await loadGroupAndMembership(id, userId)
    if (result.error) {
      return res.status(result.status).json({ status: result.status, message: result.error })
    }
    if (!result.membership.isAdmin) {
      return res.status(403).json({ status: 403, message: 'Only group admins can add members' })
    }

    // Must be friends of the admin doing the adding
    const friendIds = await getFriendIds(userId)
    if (memberIds.some(mid => !friendIds.has(mid))) {
      return res.status(403).json({
        status: 403,
        message: 'You can only add people from your friends list'
      })
    }

    // Skip anyone who's already in the group
    const existingIds = new Set(result.conversation.users.map(u => u.userId))
    const toAdd = memberIds.filter(mid => !existingIds.has(mid))

    if (toAdd.length === 0) {
      return res.status(409).json({ status: 409, message: 'Those users are already in the group' })
    }

    await prisma.conversationsOnUsers.createMany({
      data: toAdd.map(mid => ({ userId: mid, conversationId: id }))
    })

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: GROUP_USERS_INCLUDE
    })

    return res.status(200).json({
      status: 200,
      message: `Added ${toAdd.length} member(s)`,
      conversation
    })
  } catch (error) {
    console.error('addMembers error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

/**
 * DELETE /api/conversations/:id/members/:userId
 * Remove a member — admin only. Admins leave (not remove) themselves.
 */
const removeMember = async (req, res) => {
  try {
    const { id, userId: targetId } = req.params
    const userId = req.user.id

    const result = await loadGroupAndMembership(id, userId)
    if (result.error) {
      return res.status(result.status).json({ status: result.status, message: result.error })
    }
    if (!result.membership.isAdmin) {
      return res.status(403).json({ status: 403, message: 'Only group admins can remove members' })
    }
    if (targetId === userId) {
      return res.status(400).json({ status: 400, message: 'Use "Leave group" to remove yourself' })
    }

    const targetMembership = result.conversation.users.find(u => u.userId === targetId)
    if (!targetMembership) {
      return res.status(404).json({ status: 404, message: 'That user is not in this group' })
    }

    await prisma.conversationsOnUsers.delete({
      where: {
        userId_conversationId: { userId: targetId, conversationId: id }
      }
    })

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: GROUP_USERS_INCLUDE
    })

    return res.status(200).json({ status: 200, message: 'Member removed', conversation })
  } catch (error) {
    console.error('removeMember error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

/**
 * POST /api/conversations/:id/leave
 *
 * Leave the group. Special cases handled in order:
 * - Last member leaving → delete the whole group (messages cascade).
 * - Last ADMIN leaving  → promote one remaining member so the group
 *   is never left without an admin.
 */
const leaveGroup = async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.user.id

    const result = await loadGroupAndMembership(id, userId)
    if (result.error) {
      return res.status(result.status).json({ status: result.status, message: result.error })
    }

    const remaining = result.conversation.users.filter(u => u.userId !== userId)

    // --- Last member: delete the group entirely ---
    if (remaining.length === 0) {
      // Clear implicit many-to-many relations on messages first, then rely on
      // the conversation cascade for the messages themselves.
      const messages = await prisma.message.findMany({
        where: { conversationId: id },
        select: { id: true }
      })
      await Promise.all(
        messages.map(m =>
          prisma.message.update({
            where: { id: m.id },
            data: { seenBy: { set: [] }, deletedBy: { set: [] } }
          })
        )
      )
      await prisma.conversationsOnUsers.deleteMany({ where: { conversationId: id } })
      await prisma.message.deleteMany({ where: { conversationId: id } })
      await prisma.conversation.delete({ where: { id } })

      return res.status(200).json({ status: 200, message: 'You left and the empty group was deleted' })
    }

    // --- Leave, promoting a new admin if I was the only one ---
    const stillHasAdmin = remaining.some(u => u.isAdmin)
    const operations = [
      prisma.conversationsOnUsers.delete({
        where: { userId_conversationId: { userId, conversationId: id } }
      })
    ]

    if (!stillHasAdmin) {
      operations.push(
        prisma.conversationsOnUsers.update({
          where: {
            userId_conversationId: { userId: remaining[0].userId, conversationId: id }
          },
          data: { isAdmin: true }
        })
      )
    }

    await prisma.$transaction(operations)

    return res.status(200).json({ status: 200, message: 'You left the group' })
  } catch (error) {
    console.error('leaveGroup error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

export { createGroup, updateGroup, addMembers, removeMember, leaveGroup }
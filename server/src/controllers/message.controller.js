import prisma from '../lib/prisma.js'

/**
 * Message Controller
 * 
 * Handles message operations via REST API.
 * Note: In the final app, messages will primarily be sent via Socket.IO
 * for real-time delivery. This REST endpoint serves as a fallback
 * and is useful for testing before Socket.IO is set up.
 */

/**
 * POST /api/messages
 * Body: { conversationId: "uuid", body: "Hello!" }
 * 
 * Creates a new message in a conversation.
 * Also updates the conversation's lastMessageAt timestamp so it
 * sorts to the top of the conversation list.
 */
const sendMessage = async (req, res) => {
  try {
    const { conversationId, body } = req.body
    const userId = req.user.id

    if (!conversationId || !body) {
      return res.status(400).json({
        status: 400,
        message: 'conversationId and body are required'
      })
    }

    // Verify the sender is a participant in this conversation
    // Using the composite key on ConversationsOnUsers
    const participant = await prisma.conversationsOnUsers.findUnique({
      where: {
        userId_conversationId: {
          userId,
          conversationId
        }
      }
    })

    if (!participant) {
      return res.status(403).json({
        status: 403,
        message: 'You are not a participant in this conversation'
      })
    }

    // --- Use a Prisma transaction ---
    // A transaction ensures both operations succeed or both fail.
    // We don't want a message created but the conversation's timestamp not updated.
    const [message] = await prisma.$transaction([
      // 1. Create the message
      prisma.message.create({
        data: {
          body,
          conversationId,
          userId
        },
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true
            }
          }
        }
      }),
      // 2. Update the conversation's lastMessageAt (bumps it to top of list)
      prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() }
      })
    ])

    return res.status(201).json({
      status: 201,
      message
    })
  } catch (error) {
    console.error('sendMessage error:', error)
    return res.status(500).json({
      status: 500,
      message: 'Internal server error'
    })
  }
}

export { sendMessage }

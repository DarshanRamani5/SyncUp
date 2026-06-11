import prisma from '../lib/prisma.js'
import { deleteImage } from '../config/cloudinary.js'
import { areFriends } from '../lib/friendship.js'

/**
 * Conversation Controller
 * 
 * Handles conversation operations:
 * - create: Start a 1-1 conversation (or return existing one)
 * - getConversations: List all conversations for the current user
 * - getMessages: Get paginated messages for a conversation
 */

const PAGE_SIZE = 30

/**
 * POST /api/conversations
 * Body: { participantId: "user-cuid" }
 * 
 * Creates a 1-1 conversation between the current user and another user.
 * 
 * Key logic: Before creating, we check if a conversation already exists
 * between these two users. If it does, we return that instead of creating
 * a duplicate. This is similar to how PulseChat handles it.
 * 
 * The ConversationsOnUsers table is a "join table" that links Users to Conversations.
 * A conversation has many users, a user has many conversations.
 */
const create = async (req, res) => {
  try {
    const { participantId } = req.body
    const currentUserId = req.user.id

    if (!participantId) {
      return res.status(400).json({
        status: 400,
        message: 'participantId is required'
      })
    }

    // Don't allow creating a conversation with yourself
    if (participantId === currentUserId) {
      return res.status(400).json({
        status: 400,
        message: 'Cannot create a conversation with yourself'
      })
    }

    // Check if the target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: participantId }
    })

    if (!targetUser) {
      return res.status(404).json({
        status: 404,
        message: 'User not found'
      })
    }

    // --- Friends-only: you can only start a 1-1 chat with a friend ---
    if (!(await areFriends(currentUserId, participantId))) {
      return res.status(403).json({
        status: 403,
        message: 'You can only start a chat with someone on your friends list. Send them a friend request first.'
      })
    }
    // --- Check for existing 1-1 conversation ---
    // We look for a conversation where:
    // 1. It's NOT a group (isGroup = false)
    // 2. Both users are participants
    // This prevents duplicate conversations between the same pair
    const existingConversation = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        AND: [
          { users: { some: { userId: currentUserId } } },
          { users: { some: { userId: participantId } } }
        ]
      },
      include: {
        users: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                username: true,
                email: true,
                avatarUrl: true,
                color: true
              }
            }
          }
        }
      }
    })

    if (existingConversation) {
      return res.status(200).json({
        status: 200,
        message: 'Conversation already exists',
        conversation: existingConversation
      })
    }

    // --- Create new conversation ---
    // We create the conversation AND its users in a single query
    // Prisma's nested create handles this atomically
    const newConversation = await prisma.conversation.create({
      data: {
        isGroup: false,
        users: {
          create: [
            { userId: currentUserId },
            { userId: participantId }
          ]
        }
      },
      include: {
        users: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true
              }
            }
          }
        }
      }
    })

    return res.status(201).json({
      status: 201,
      message: 'Conversation created',
      conversation: newConversation
    })
  } catch (error) {
    console.error('Create conversation error:', error)
    return res.status(500).json({
      status: 500,
      message: 'Internal server error'
    })
  }
}

/**
 * GET /api/conversations
 * 
 * Returns all conversations the current user is a participant in.
 * Each conversation includes:
 * - The other users (with their user info)
 * - The most recent message (for the sidebar preview)
 * 
 * Sorted by lastMessageAt (latest message first).
 */
const getConversations = async (req, res) => {
  try {
    const currentUserId = req.user.id

    const conversations = await prisma.conversation.findMany({
      where: {
        users: {
          some: { userId: currentUserId }
        }
      },
      include: {
        users: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true
              }
            }
          }
        },
        // Include only the latest message for sidebar preview
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          include: {
            createdBy: {
              select: {
                id: true,
                name: true
              }
            },
            seenBy: {
              select: {
                id: true
              }
            }
          }
        },
        _count: {
          select: {
            messages: {
              where: {
                userId: { not: currentUserId },
                seenBy: { none: { id: currentUserId } }
              }
            }
          }
        }
      },
      orderBy: {
        lastMessageAt: 'desc'
      }
    })

    return res.status(200).json({
      status: 200,
      conversations
    })
  } catch (error) {
    console.error('getConversations error:', error)
    return res.status(500).json({
      status: 500,
      message: 'Internal server error'
    })
  }
}

/**
 * GET /api/conversations/:id/messages?cursor=<messageId>
 * 
 * Returns paginated messages for a conversation.
 * 
 * Pagination: Uses cursor-based pagination (not offset-based).
 * - First request: no cursor → returns the latest PAGE_SIZE messages
 * - Subsequent requests: cursor = ID of the oldest message you have
 *   → returns the next PAGE_SIZE messages BEFORE that one
 * 
 * Why cursor-based? If new messages arrive while you're scrolling up,
 * offset-based pagination would shift and you'd see duplicates/gaps.
 * Cursor-based is immune to this because it anchors to a specific message.
 */
const getMessages = async (req, res) => {
  try {
    const { id } = req.params
    const { cursor } = req.query
    const currentUserId = req.user.id

    // Verify the user is a participant in this conversation
    // Using the composite key (userId + conversationId) on ConversationsOnUsers
    const participant = await prisma.conversationsOnUsers.findUnique({
      where: {
        userId_conversationId: {
          userId: currentUserId,
          conversationId: id
        }
      }
    })

    if (!participant) {
      return res.status(403).json({
        status: 403,
        message: 'You are not a participant in this conversation'
      })
    }

    // Build the query
    const queryOptions = {
      where: { 
        conversationId: id,
        // Filter out messages this user has "deleted for me"
        NOT: {
          deletedBy: { some: { id: currentUserId } }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true
          }
        },
        seenBy: {
          select: {
            id: true
          }
        }
      }
    }

    // If cursor is provided, skip that message and get older ones
    if (cursor) {
      queryOptions.cursor = { id: cursor }
      queryOptions.skip = 1 // Skip the cursor message itself
    }

    const messages = await prisma.message.findMany(queryOptions)

    // Reverse so messages are in chronological order (oldest first)
    messages.reverse()

    return res.status(200).json({
      status: 200,
      messages,
      // If we got fewer than PAGE_SIZE, there are no more older messages
      hasMore: messages.length === PAGE_SIZE
    })
  } catch (error) {
    console.error('getMessages error:', error)
    return res.status(500).json({
      status: 500,
      message: 'Internal server error'
    })
  }
}

/**
 * DELETE /api/conversations/:id
 * 
 * Deletes an entire conversation and all its messages.
 */
const deleteConversation = async (req, res) => {
  try {
    const { id } = req.params
    const currentUserId = req.user.id

    // Verify the user is a participant
    const participant = await prisma.conversationsOnUsers.findUnique({
      where: {
        userId_conversationId: {
          userId: currentUserId,
          conversationId: id
        }
      }
    })

    if (!participant) {
      return res.status(403).json({
        status: 403,
        message: 'You are not a participant in this conversation'
      })
    }

    // Get all message IDs (and Cloudinary refs) in this conversation
    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      select: { id: true, public_id: true }
    })

    // Remove any uploaded images from Cloudinary so we don't orphan files.
    // Runs in parallel; each delete is a no-op if there's no public_id.
    const imagePublicIds = messages.map(m => m.public_id).filter(Boolean)
    if (imagePublicIds.length > 0) {
      await Promise.all(imagePublicIds.map(pid => deleteImage(pid)))
    }

    // Clear implicit many-to-many relations (seenBy, deletedBy) for each message
    if (messages.length > 0) {
      await Promise.all(
        messages.map(msg =>
          prisma.message.update({
            where: { id: msg.id },
            data: {
              seenBy: { set: [] },
              deletedBy: { set: [] }
            }
          })
        )
      )
    }

    // Delete join table entries, messages, then conversation
    await prisma.conversationsOnUsers.deleteMany({
      where: { conversationId: id }
    })
    
    await prisma.message.deleteMany({
      where: { conversationId: id }
    })

    await prisma.conversation.delete({
      where: { id }
    })

    return res.status(200).json({
      status: 200,
      message: 'Conversation deleted successfully'
    })
  } catch (error) {
    console.error('deleteConversation error:', error)
    return res.status(500).json({
      status: 500,
      message: 'Internal server error'
    })
  }
}

export { create, getConversations, getMessages, deleteConversation }

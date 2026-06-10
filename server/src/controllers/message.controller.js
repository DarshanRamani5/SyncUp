import prisma from '../lib/prisma.js'
import { uploadImage as uploadToCloudinary, isCloudinaryConfigured } from '../config/cloudinary.js'

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
    const { conversationId, body, image, public_id } = req.body
    const userId = req.user.id

    // A message must have at least text or an image (image-only is allowed)
    if (!conversationId || (!body && !image)) {
      return res.status(400).json({
        status: 400,
        message: 'conversationId and a body or image are required'
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
          body: body || null,
          image: image || null,
          public_id: public_id || null,
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

/**
 * POST /api/messages/upload
 * Multipart body: { image: <file> }  (field name "image", handled by multer)
 *
 * Uploads an image to Cloudinary and returns its URL + public_id.
 * The client then sends a normal message carrying these via Socket.IO,
 * so real-time delivery is unchanged — this endpoint only handles the file.
 *
 * Validation (10 MB cap + allowed types) is enforced by the multer middleware
 * on the route; by the time we get here, req.file is already known-good.
 */
const uploadMessageImage = async (req, res) => {
  try {
    if (!isCloudinaryConfigured()) {
      return res.status(503).json({
        status: 503,
        message: 'Image uploads are not available — Cloudinary is not configured'
      })
    }

    if (!req.file) {
      return res.status(400).json({
        status: 400,
        message: 'No image file provided'
      })
    }

    // Stream the in-memory buffer up to Cloudinary
    const { url, public_id } = await uploadToCloudinary(req.file.buffer)

    return res.status(201).json({
      status: 201,
      url,
      public_id
    })
  } catch (error) {
    console.error('uploadMessageImage error:', error)
    return res.status(500).json({
      status: 500,
      message: 'Failed to upload image'
    })
  }
}

export { sendMessage, uploadMessageImage }

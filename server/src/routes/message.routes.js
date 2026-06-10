import { Router } from 'express'
import { sendMessage, uploadMessageImage } from '../controllers/message.controller.js'
import authMiddleware from '../middlewares/auth.middleware.js'
import uploadSingleImage from '../middlewares/upload.middleware.js'

/**
 * Message Routes
 * 
 * POST /api/messages        — Send a message via REST (alternative to Socket.IO)
 * POST /api/messages/upload — Upload an image, returns { url, public_id }
 * 
 * In the final app, real-time messages go through Socket.IO.
 * This REST endpoint is a fallback for when Socket.IO isn't available
 * and is useful during development/testing.
 * 
 * The /upload endpoint is REST-only by design: file uploads are slow,
 * multipart HTTP requests that don't belong on the WebSocket. The client
 * uploads the image here first, then sends the message (carrying the
 * returned url + public_id) through the normal Socket.IO path.
 */
const router = Router()

router.post('/', authMiddleware, sendMessage)
router.post('/upload', authMiddleware, uploadSingleImage, uploadMessageImage)

export default router

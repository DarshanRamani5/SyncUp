import { Router } from 'express'
import { sendMessage } from '../controllers/message.controller.js'
import authMiddleware from '../middlewares/auth.middleware.js'

/**
 * Message Routes
 * 
 * POST /api/messages — Send a message via REST (alternative to Socket.IO)
 * 
 * In the final app, real-time messages go through Socket.IO.
 * This REST endpoint is a fallback for when Socket.IO isn't available
 * and is useful during development/testing.
 */
const router = Router()

router.post('/', authMiddleware, sendMessage)

export default router

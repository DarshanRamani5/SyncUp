import { Router } from 'express'
import { create, getConversations, getMessages, deleteConversation } from '../controllers/conversation.controller.js'
import authMiddleware from '../middlewares/auth.middleware.js'

/**
 * Conversation Routes
 * 
 * All protected — must be logged in.
 * 
 * POST   /api/conversations              — Create/find a 1-1 conversation
 * GET    /api/conversations              — List current user's conversations
 * GET    /api/conversations/:id/messages — Get messages for a conversation
 * DELETE /api/conversations/:id          — Delete a conversation and all its messages
 */
const router = Router()

router.post('/', authMiddleware, create)
router.get('/', authMiddleware, getConversations)
router.get('/:id/messages', authMiddleware, getMessages)
router.delete('/:id', authMiddleware, deleteConversation)

export default router

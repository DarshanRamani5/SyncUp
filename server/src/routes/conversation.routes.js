import { Router } from 'express'
import { create, getConversations, getMessages, deleteConversation } from '../controllers/conversation.controller.js'
import { createGroup, updateGroup, addMembers, removeMember, leaveGroup } from '../controllers/group.controller.js'
import authMiddleware from '../middlewares/auth.middleware.js'

/**
 * Conversation Routes — all protected
 *
 * 1-1:
 * POST   /api/conversations                       — Create/find a 1-1 conversation (friends only)
 * GET    /api/conversations                       — List my conversations
 * GET    /api/conversations/:id/messages          — Messages (paginated)
 * DELETE /api/conversations/:id                   — Delete conversation + messages
 *
 * Groups (NEW):
 * POST   /api/conversations/group                 — Create a group from friends
 * PUT    /api/conversations/:id/group             — Rename group (admin)
 * POST   /api/conversations/:id/members           — Add members (admin)
 * DELETE /api/conversations/:id/members/:userId   — Remove a member (admin)
 * POST   /api/conversations/:id/leave             — Leave group
 *
 * NOTE: the literal "/group" route is registered before any "/:id" routes.
 */
const router = Router()

router.post('/group', authMiddleware, createGroup)

router.post('/', authMiddleware, create)
router.get('/', authMiddleware, getConversations)
router.get('/:id/messages', authMiddleware, getMessages)
router.put('/:id/group', authMiddleware, updateGroup)
router.post('/:id/members', authMiddleware, addMembers)
router.delete('/:id/members/:userId', authMiddleware, removeMember)
router.post('/:id/leave', authMiddleware, leaveGroup)
router.delete('/:id', authMiddleware, deleteConversation)

export default router
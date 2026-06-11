import { Router } from 'express'
import {
  sendRequest,
  getRequests,
  respondToRequest,
  cancelRequest,
  getFriends,
  unfriend
} from '../controllers/friend.controller.js'
import authMiddleware from '../middlewares/auth.middleware.js'

/**
 * Friend Routes — all protected
 *
 * GET    /api/friends                — My friends list
 * GET    /api/friends/requests       — My pending requests (incoming + outgoing)
 * POST   /api/friends/requests       — Send a friend request { receiverId }
 * PUT    /api/friends/requests/:id   — Accept/decline { action }
 * DELETE /api/friends/requests/:id   — Cancel a request I sent
 * DELETE /api/friends/:friendId      — Unfriend
 *
 * ORDER MATTERS: the /requests routes must come BEFORE /:friendId,
 * otherwise "requests" would be treated as a friendId.
 */
const router = Router()

router.get('/requests', authMiddleware, getRequests)
router.post('/requests', authMiddleware, sendRequest)
router.put('/requests/:id', authMiddleware, respondToRequest)
router.delete('/requests/:id', authMiddleware, cancelRequest)

router.get('/', authMiddleware, getFriends)
router.delete('/:friendId', authMiddleware, unfriend)

export default router
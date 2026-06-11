import { Router } from 'express'
import { getAllUsers, getUserById, searchUsers } from '../controllers/user.controller.js'
import authMiddleware from '../middlewares/auth.middleware.js'

/**
 * User Routes
 *
 * All user routes are protected — you must be logged in.
 *
 * GET /api/users          — List all users (except current)
 * GET /api/users/search   — NEW: search users by @username (?q=harsh)
 * GET /api/users/:id      — Get a specific user's profile
 *
 * ORDER MATTERS: /search MUST be registered BEFORE /:id, otherwise
 * Express would treat "search" as a user id and hit the wrong handler.
 */
const router = Router()

router.get('/', authMiddleware, getAllUsers)
router.get('/search', authMiddleware, searchUsers)
router.get('/:id', authMiddleware, getUserById)

export default router
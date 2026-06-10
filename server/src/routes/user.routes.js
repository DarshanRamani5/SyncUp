import { Router } from 'express'
import { getAllUsers, getUserById } from '../controllers/user.controller.js'
import authMiddleware from '../middlewares/auth.middleware.js'

/**
 * User Routes
 * 
 * All user routes are protected — you must be logged in to see other users.
 * 
 * GET /api/users      — List all users (except current)
 * GET /api/users/:id  — Get a specific user's profile
 */
const router = Router()

router.get('/', authMiddleware, getAllUsers)
router.get('/:id', authMiddleware, getUserById)

export default router

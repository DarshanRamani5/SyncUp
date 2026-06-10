import { Router } from 'express'
import { register, login, me } from '../controllers/auth.controller.js'
import authMiddleware from '../middlewares/auth.middleware.js'

/**
 * Auth Routes
 * 
 * POST /api/auth/register  — Create new account (public)
 * POST /api/auth/login     — Login with credentials (public)
 * GET  /api/auth/me        — Get current user from token (protected)
 */
const router = Router()

// Public routes — no auth needed
router.post('/register', register)
router.post('/login', login)

// Protected route — requires valid JWT
router.get('/me', authMiddleware, me)

export default router

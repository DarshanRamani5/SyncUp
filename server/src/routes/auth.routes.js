import { Router } from 'express'
import {
  register,
  login,
  me,
  verifyEmail,
  resendOtp,
  forgotPassword,
  verifyResetOtp,
  resetPassword
} from '../controllers/auth.controller.js'
import authMiddleware from '../middlewares/auth.middleware.js'

/**
 * Auth Routes
 *
 * POST /api/auth/register          — Create new account, send OTP (public)
 * POST /api/auth/verify-email      — Verify email OTP, get JWT (public)
 * POST /api/auth/resend-otp        — Resend OTP email (public)
 * POST /api/auth/login             — Login with credentials (public)
 * POST /api/auth/forgot-password   — Request password reset OTP (public)
 * POST /api/auth/verify-reset-otp  — Verify reset OTP, get reset token (public)
 * POST /api/auth/reset-password    — Set new password with reset token (public)
 * GET  /api/auth/me                — Get current user from token (protected)
 */
const router = Router()

// Public routes — no auth needed
router.post('/register', register)
router.post('/verify-email', verifyEmail)
router.post('/resend-otp', resendOtp)
router.post('/login', login)
router.post('/forgot-password', forgotPassword)
router.post('/verify-reset-otp', verifyResetOtp)
router.post('/reset-password', resetPassword)

// Protected route — requires valid JWT
router.get('/me', authMiddleware, me)

export default router

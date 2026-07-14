import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import prisma from '../lib/prisma.js'
import { sendOtpEmail } from '../config/email.js'
import {
  validateName,
  validateUsername,
  validateEmail,
  validatePassword
} from '../utils/validation.js'

/**
 * Auth Controller
 *
 * Handles user authentication:
 * - register:          Create user (unverified) + send OTP email
 * - verifyEmail:       Verify OTP → mark emailVerified → return JWT
 * - resendOtp:         Resend a new OTP email
 * - login:             Verify credentials, return JWT (warn if unverified)
 * - me:                Return current user from JWT (session check)
 * - forgotPassword:    Send password-reset OTP
 * - verifyResetOtp:    Verify reset OTP → return short-lived reset token
 * - resetPassword:     Use reset token + new password to update
 */

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Normalize whatever the user typed into a canonical username:
 * "@Harsh_Dev " → "harsh_dev"
 */
const normalizeUsername = (raw) => {
  if (!raw || typeof raw !== 'string') return ''
  return raw.trim().replace(/^@+/, '').toLowerCase()
}

/**
 * Generate a cryptographically random 6-digit OTP.
 * Uses crypto.randomInt for uniform distribution (no modulo bias).
 */
const generateOtp = () => {
  return crypto.randomInt(100000, 999999).toString()
}

/**
 * Create or replace an OTP token in the database.
 * The OTP is bcrypt-hashed so even if the DB is compromised, codes are safe.
 */
const createOtpToken = async (email, type) => {
  const otp = generateOtp()
  const salt = await bcrypt.genSalt(10)
  const hashedOtp = await bcrypt.hash(otp, salt)

  // Upsert: one active token per (email, type)
  await prisma.verificationToken.upsert({
    where: {
      identifier_type: { identifier: email, type }
    },
    update: {
      otp: hashedOtp,
      expires: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      attempts: 0,
      createdAt: new Date()
    },
    create: {
      identifier: email,
      type,
      otp: hashedOtp,
      expires: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0
    }
  })

  return otp // Return plain OTP to send via email
}

/**
 * Sign a standard login JWT.
 */
const signToken = (user) => {
  const payload = {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email
  }
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' })
}

/**
 * Standard user response shape (never leak passwordHash).
 */
const userResponse = (user) => ({
  id: user.id,
  name: user.name,
  username: user.username,
  email: user.email,
  avatarUrl: user.avatarUrl,
  emailVerified: user.emailVerified,
  createdAt: user.createdAt
})

// ─── Controllers ───────────────────────────────────────────────

/**
 * POST /api/auth/register
 *
 * 1. Validate all inputs (name, username, email, password)
 * 2. Check uniqueness (email + username)
 * 3. Hash password, create user (emailVerified: false)
 * 4. Generate OTP, send verification email
 * 5. Return { message, email } — NO JWT yet
 */
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body
    const username = normalizeUsername(req.body.username)

    // --- Validate all fields ---
    const nameCheck = validateName(name)
    if (!nameCheck.valid) {
      return res.status(400).json({ status: 400, message: nameCheck.message })
    }

    const usernameCheck = validateUsername(username)
    if (!usernameCheck.valid) {
      return res.status(400).json({ status: 400, message: usernameCheck.message })
    }

    const emailCheck = validateEmail(email)
    if (!emailCheck.valid) {
      return res.status(400).json({ status: 400, message: emailCheck.message })
    }

    const passwordCheck = validatePassword(password)
    if (!passwordCheck.valid) {
      return res.status(400).json({ status: 400, message: passwordCheck.message })
    }

    // --- Check if email OR username is already taken ---
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }]
      },
      select: { email: true, username: true, emailVerified: true }
    })

    if (existingUser) {
      // If the same email exists but is NOT verified, allow re-registration
      // by updating the existing user's details and re-sending OTP
      if (existingUser.email === email && !existingUser.emailVerified) {
        const salt = await bcrypt.genSalt(10)
        const passwordHash = await bcrypt.hash(password, salt)

        await prisma.user.update({
          where: { email },
          data: { name: name.trim(), username, passwordHash }
        })

        const otp = await createOtpToken(email, 'email_verification')
        await sendOtpEmail(email, otp, 'email_verification')

        return res.status(200).json({
          status: 200,
          message: 'Verification code sent to your email',
          email
        })
      }

      // Otherwise, it's a genuine conflict
      const clash =
        existingUser.email === email
          ? 'An account with this email already exists'
          : `The username @${username} is already taken`
      return res.status(409).json({ status: 409, message: clash })
    }

    // --- Hash password ---
    const salt = await bcrypt.genSalt(10)
    const passwordHash = await bcrypt.hash(password, salt)

    // --- Create user (unverified) ---
    await prisma.user.create({
      data: {
        name: name.trim(),
        username,
        email,
        passwordHash,
        emailVerified: false
      }
    })

    // --- Generate OTP & send email ---
    const otp = await createOtpToken(email, 'email_verification')
    await sendOtpEmail(email, otp, 'email_verification')

    return res.status(201).json({
      status: 201,
      message: 'Verification code sent to your email',
      email
    })
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({
        status: 409,
        message: 'Email or username is already taken'
      })
    }
    console.error('Register error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

/**
 * POST /api/auth/verify-email
 *
 * Accepts { email, otp }. Verifies the OTP, marks emailVerified,
 * deletes the token, and returns JWT + user.
 */
const verifyEmail = async (req, res) => {
  try {
    const { email, otp } = req.body

    if (!email || !otp) {
      return res.status(400).json({
        status: 400,
        message: 'Email and verification code are required'
      })
    }

    // Find the token
    const token = await prisma.verificationToken.findUnique({
      where: {
        identifier_type: { identifier: email, type: 'email_verification' }
      }
    })

    if (!token) {
      return res.status(400).json({
        status: 400,
        message: 'No verification code found. Please request a new one.'
      })
    }

    // Check expiry
    if (new Date() > token.expires) {
      await prisma.verificationToken.delete({
        where: { identifier_type: { identifier: email, type: 'email_verification' } }
      })
      return res.status(400).json({
        status: 400,
        message: 'Verification code has expired. Please request a new one.'
      })
    }

    // Check attempts (max 5)
    if (token.attempts >= 5) {
      await prisma.verificationToken.delete({
        where: { identifier_type: { identifier: email, type: 'email_verification' } }
      })
      return res.status(429).json({
        status: 429,
        message: 'Too many failed attempts. Please request a new code.'
      })
    }

    // Verify OTP
    const isValid = await bcrypt.compare(otp, token.otp)

    if (!isValid) {
      // Increment attempts
      await prisma.verificationToken.update({
        where: { identifier_type: { identifier: email, type: 'email_verification' } },
        data: { attempts: { increment: 1 } }
      })
      const remaining = 4 - token.attempts
      return res.status(400).json({
        status: 400,
        message: `Invalid verification code. ${remaining > 0 ? `${remaining} attempts remaining.` : 'Please request a new code.'}`
      })
    }

    // ✅ OTP is valid — mark user as verified
    const user = await prisma.user.update({
      where: { email },
      data: { emailVerified: true }
    })

    // Delete the used token
    await prisma.verificationToken.delete({
      where: { identifier_type: { identifier: email, type: 'email_verification' } }
    })

    // Sign JWT and return
    const jwtToken = signToken(user)

    return res.status(200).json({
      status: 200,
      message: 'Email verified successfully',
      user: userResponse(user),
      token: `Bearer ${jwtToken}`
    })
  } catch (error) {
    console.error('Verify email error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

/**
 * POST /api/auth/resend-otp
 *
 * Accepts { email, type }. Generates a new OTP and sends it.
 * type: "email_verification" | "password_reset"
 */
const resendOtp = async (req, res) => {
  try {
    const { email, type } = req.body

    if (!email || !type) {
      return res.status(400).json({
        status: 400,
        message: 'Email and type are required'
      })
    }

    if (!['email_verification', 'password_reset'].includes(type)) {
      return res.status(400).json({
        status: 400,
        message: 'Invalid OTP type'
      })
    }

    // For email verification, check user exists
    if (type === 'email_verification') {
      const user = await prisma.user.findUnique({ where: { email } })
      if (!user) {
        // Don't reveal whether email exists
        return res.status(200).json({
          status: 200,
          message: 'If an account exists, a new code has been sent.'
        })
      }
      if (user.emailVerified) {
        return res.status(400).json({
          status: 400,
          message: 'Email is already verified'
        })
      }
    }

    const otp = await createOtpToken(email, type)
    await sendOtpEmail(email, otp, type)

    return res.status(200).json({
      status: 200,
      message: 'A new verification code has been sent to your email'
    })
  } catch (error) {
    console.error('Resend OTP error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

/**
 * POST /api/auth/login
 *
 * Accepts EITHER an email or a username in the "email" field.
 * If the user's email is unverified, still allow login but include
 * emailVerified: false in the response so the frontend can show a banner.
 */
const login = async (req, res) => {
  try {
    const { email: identifier, password } = req.body

    if (!identifier || !password) {
      return res.status(400).json({
        status: 400,
        message: 'Email/username and password are required'
      })
    }

    // --- Find user by email OR username ---
    const looksLikeEmail = identifier.includes('@') && identifier.includes('.')
    const user = looksLikeEmail
      ? await prisma.user.findUnique({ where: { email: identifier } })
      : await prisma.user.findUnique({
          where: { username: normalizeUsername(identifier) }
        })

    if (!user) {
      return res.status(401).json({
        status: 401,
        message: 'Invalid credentials'
      })
    }

    // --- Verify password ---
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash)

    if (!isPasswordValid) {
      return res.status(401).json({
        status: 401,
        message: 'Invalid credentials'
      })
    }

    // --- Generate JWT ---
    const token = signToken(user)

    return res.status(200).json({
      status: 200,
      message: 'Logged in successfully',
      user: userResponse(user),
      token: `Bearer ${token}`
    })
  } catch (error) {
    console.error('Login error:', error)
    return res.status(500).json({
      status: 500,
      message: 'Internal server error'
    })
  }
}

/**
 * GET /api/auth/me
 *
 * Protected route — requires auth middleware to run first.
 */
const me = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        avatarUrl: true,
        emailVerified: true,
        createdAt: true
      }
    })

    if (!user) {
      return res.status(404).json({
        status: 404,
        message: 'User not found'
      })
    }

    return res.status(200).json({
      status: 200,
      user
    })
  } catch (error) {
    console.error('Me error:', error)
    return res.status(500).json({
      status: 500,
      message: 'Internal server error'
    })
  }
}

/**
 * POST /api/auth/forgot-password
 *
 * Accepts { email }. Generates a password-reset OTP and sends it.
 * Always returns success to avoid revealing whether the email exists.
 */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body

    if (!email) {
      return res.status(400).json({
        status: 400,
        message: 'Email is required'
      })
    }

    const user = await prisma.user.findUnique({ where: { email } })

    if (user) {
      const otp = await createOtpToken(email, 'password_reset')
      await sendOtpEmail(email, otp, 'password_reset')
    }

    // Always return success (don't reveal if email exists)
    return res.status(200).json({
      status: 200,
      message: 'If an account with that email exists, a reset code has been sent.'
    })
  } catch (error) {
    console.error('Forgot password error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

/**
 * POST /api/auth/verify-reset-otp
 *
 * Accepts { email, otp }. Verifies the password-reset OTP and returns
 * a short-lived resetToken (JWT, 10 min) that authorizes the password change.
 */
const verifyResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body

    if (!email || !otp) {
      return res.status(400).json({
        status: 400,
        message: 'Email and reset code are required'
      })
    }

    // Find the token
    const token = await prisma.verificationToken.findUnique({
      where: {
        identifier_type: { identifier: email, type: 'password_reset' }
      }
    })

    if (!token) {
      return res.status(400).json({
        status: 400,
        message: 'No reset code found. Please request a new one.'
      })
    }

    // Check expiry
    if (new Date() > token.expires) {
      await prisma.verificationToken.delete({
        where: { identifier_type: { identifier: email, type: 'password_reset' } }
      })
      return res.status(400).json({
        status: 400,
        message: 'Reset code has expired. Please request a new one.'
      })
    }

    // Check attempts (max 5)
    if (token.attempts >= 5) {
      await prisma.verificationToken.delete({
        where: { identifier_type: { identifier: email, type: 'password_reset' } }
      })
      return res.status(429).json({
        status: 429,
        message: 'Too many failed attempts. Please request a new code.'
      })
    }

    // Verify OTP
    const isValid = await bcrypt.compare(otp, token.otp)

    if (!isValid) {
      await prisma.verificationToken.update({
        where: { identifier_type: { identifier: email, type: 'password_reset' } },
        data: { attempts: { increment: 1 } }
      })
      const remaining = 4 - token.attempts
      return res.status(400).json({
        status: 400,
        message: `Invalid reset code. ${remaining > 0 ? `${remaining} attempts remaining.` : 'Please request a new code.'}`
      })
    }

    // ✅ OTP valid — delete the token and issue a short-lived reset JWT
    await prisma.verificationToken.delete({
      where: { identifier_type: { identifier: email, type: 'password_reset' } }
    })

    const resetToken = jwt.sign(
      { email, purpose: 'password_reset' },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    )

    return res.status(200).json({
      status: 200,
      message: 'Code verified. You can now set a new password.',
      resetToken
    })
  } catch (error) {
    console.error('Verify reset OTP error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

/**
 * POST /api/auth/reset-password
 *
 * Accepts { resetToken, newPassword }. Validates the reset JWT,
 * validates the new password, hashes + updates user's passwordHash.
 */
const resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body

    if (!resetToken || !newPassword) {
      return res.status(400).json({
        status: 400,
        message: 'Reset token and new password are required'
      })
    }

    // Validate new password
    const passwordCheck = validatePassword(newPassword)
    if (!passwordCheck.valid) {
      return res.status(400).json({ status: 400, message: passwordCheck.message })
    }

    // Verify the reset token
    let decoded
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET)
    } catch {
      return res.status(400).json({
        status: 400,
        message: 'Reset link has expired or is invalid. Please request a new one.'
      })
    }

    if (decoded.purpose !== 'password_reset' || !decoded.email) {
      return res.status(400).json({
        status: 400,
        message: 'Invalid reset token'
      })
    }

    // Find user
    const user = await prisma.user.findUnique({ where: { email: decoded.email } })

    if (!user) {
      return res.status(404).json({
        status: 404,
        message: 'User not found'
      })
    }

    // Hash and update password
    const salt = await bcrypt.genSalt(10)
    const passwordHash = await bcrypt.hash(newPassword, salt)

    await prisma.user.update({
      where: { email: decoded.email },
      data: { passwordHash }
    })

    return res.status(200).json({
      status: 200,
      message: 'Password reset successfully. You can now log in with your new password.'
    })
  } catch (error) {
    console.error('Reset password error:', error)
    return res.status(500).json({ status: 500, message: 'Internal server error' })
  }
}

export {
  register,
  login,
  me,
  verifyEmail,
  resendOtp,
  forgotPassword,
  verifyResetOtp,
  resetPassword
}
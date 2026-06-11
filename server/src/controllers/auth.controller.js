import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'

/**
 * Auth Controller
 *
 * Handles user authentication:
 * - register: Create new user with hashed password + unique username, return JWT
 * - login: Verify credentials (email OR username), return JWT
 * - me: Return current user from JWT (session check)
 */

/**
 * Username rules (Discord/Telegram style):
 * - 3 to 20 characters
 * - lowercase letters, numbers, underscores only
 * - stored lowercase, leading "@" stripped if the user types one
 */
const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/

/**
 * Normalize whatever the user typed into a canonical username:
 * "@Harsh_Dev " → "harsh_dev"
 */
const normalizeUsername = (raw) => {
  if (!raw || typeof raw !== 'string') return ''
  return raw.trim().replace(/^@+/, '').toLowerCase()
}

/**
 * POST /api/auth/register
 *
 * Flow:
 * 1. Validate input (name, username, email, password)
 * 2. Validate username format + check uniqueness
 * 3. Check if email already exists
 * 4. Hash the password with bcrypt
 * 5. Create user in database
 * 6. Sign a JWT, return token + user data
 */
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body
    const username = normalizeUsername(req.body.username)

    // --- Validation ---
    if (!name || !username || !email || !password) {
      return res.status(400).json({
        status: 400,
        message: 'Name, username, email, and password are required'
      })
    }

    if (!USERNAME_REGEX.test(username)) {
      return res.status(400).json({
        status: 400,
        message:
          'Username must be 3-20 characters and contain only lowercase letters, numbers, and underscores'
      })
    }

    if (password.length < 6) {
      return res.status(400).json({
        status: 400,
        message: 'Password must be at least 6 characters'
      })
    }

    // --- Check if email OR username is already taken ---
    // One query instead of two: find any user matching either field.
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email }, { username }]
      },
      select: { email: true, username: true }
    })

    if (existingUser) {
      // Tell the user WHICH field clashed so they can fix the right one
      const clash =
        existingUser.email === email
          ? 'An account with this email already exists'
          : `The username @${username} is already taken`
      return res.status(409).json({
        status: 409,
        message: clash
      })
    }

    // --- Hash password ---
    const salt = await bcrypt.genSalt(10)
    const passwordHash = await bcrypt.hash(password, salt)

    // --- Create user ---
    const user = await prisma.user.create({
      data: {
        name,
        username,
        email,
        passwordHash
      }
    })

    // --- Generate JWT ---
    const tokenPayload = {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email
    }

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: '7d'
    })

    return res.status(201).json({
      status: 201,
      message: 'User registered successfully',
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt
      },
      token: `Bearer ${token}`
    })
  } catch (error) {
    // Safety net: if two requests race past the findFirst check, the DB's
    // unique constraint throws P2002 — translate it to a friendly 409.
    if (error.code === 'P2002') {
      return res.status(409).json({
        status: 409,
        message: 'Email or username is already taken'
      })
    }
    console.error('Register error:', error)
    return res.status(500).json({
      status: 500,
      message: 'Internal server error'
    })
  }
}

/**
 * POST /api/auth/login
 *
 * Accepts EITHER an email or a username in the "email" field
 * (kept the same field name so the existing client keeps working).
 * If the value contains "@" + "." it's treated as an email,
 * otherwise we try it as a username.
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
    const tokenPayload = {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email
    }

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: '7d'
    })

    return res.status(200).json({
      status: 200,
      message: 'Logged in successfully',
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt
      },
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

export { register, login, me }
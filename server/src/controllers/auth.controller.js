import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'

/**
 * Auth Controller
 * 
 * Handles user authentication:
 * - register: Create new user with hashed password, return JWT
 * - login: Verify credentials, return JWT
 * - me: Return current user from JWT (session check)
 */

/**
 * POST /api/auth/register
 * 
 * Flow:
 * 1. Validate input (name, email, password)
 * 2. Check if email already exists
 * 3. Hash the password with bcrypt (never store plain text!)
 * 4. Create user in database
 * 5. Sign a JWT with user info
 * 6. Return the token + user data
 */
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body

    // --- Validation ---
    if (!name || !email || !password) {
      return res.status(400).json({
        status: 400,
        message: 'Name, email, and password are required'
      })
    }

    if (password.length < 6) {
      return res.status(400).json({
        status: 400,
        message: 'Password must be at least 6 characters'
      })
    }

    // --- Check if user already exists ---
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      return res.status(409).json({
        status: 409,
        message: 'An account with this email already exists'
      })
    }

    // --- Hash password ---
    // Salt rounds = 10: good balance of security vs speed
    // bcrypt adds a random "salt" so even identical passwords produce different hashes
    const salt = await bcrypt.genSalt(10)
    const passwordHash = await bcrypt.hash(password, salt)

    // --- Create user ---
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash
      }
    })

    // --- Generate JWT ---
    // The payload is what gets encoded into the token
    // Anyone can decode a JWT to READ this data, but can't MODIFY it without the secret
    const tokenPayload = {
      id: user.id,
      name: user.name,
      email: user.email
    }

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, {
      expiresIn: '7d' // Token valid for 7 days
    })

    // --- Return response ---
    // We never return the passwordHash to the client!
    return res.status(201).json({
      status: 201,
      message: 'User registered successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt
      },
      token: `Bearer ${token}`
    })
  } catch (error) {
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
 * Flow:
 * 1. Find user by email
 * 2. Compare provided password with stored hash using bcrypt
 * 3. If match, sign and return JWT
 * 4. If no match, return 401
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({
        status: 400,
        message: 'Email and password are required'
      })
    }

    // --- Find user ---
    const user = await prisma.user.findUnique({
      where: { email }
    })

    if (!user) {
      return res.status(401).json({
        status: 401,
        message: 'Invalid email or password'
      })
    }

    // --- Verify password ---
    // bcrypt.compare hashes the provided password with the same salt
    // and checks if the result matches the stored hash
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash)

    if (!isPasswordValid) {
      return res.status(401).json({
        status: 401,
        message: 'Invalid email or password'
      })
    }

    // --- Generate JWT ---
    const tokenPayload = {
      id: user.id,
      name: user.name,
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
 * The middleware already verified the JWT and attached user to req.user.
 * We just need to fetch the fresh user data from the database.
 * 
 * The frontend calls this on app load to check if the stored token is still valid.
 */
const me = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
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

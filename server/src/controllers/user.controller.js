import prisma from '../lib/prisma.js'

/**
 * User Controller
 *
 * Handles user-related operations:
 * - getAllUsers:    Returns all users EXCEPT the current user
 * - getUserById:    Returns a single user's profile
 * - searchUsers:    NEW — search users by @username (powers "Add Friend")
 */

/**
 * GET /api/users
 *
 * Returns all registered users except the currently logged-in user.
 * NOTE: After Task 3 (friends-only chat), the "New Chat" modal will stop
 * using this; it stays for admin/debug purposes.
 */
const getAllUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        id: { not: req.user.id }
      },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        avatarUrl: true,
        createdAt: true
      },
      orderBy: {
        name: 'asc'
      }
    })

    return res.status(200).json({
      status: 200,
      users
    })
  } catch (error) {
    console.error('getAllUsers error:', error)
    return res.status(500).json({
      status: 500,
      message: 'Internal server error'
    })
  }
}

/**
 * GET /api/users/search?q=harsh
 *
 * NEW — Username search (Discord/Telegram style).
 *
 * - Strips a leading "@" if the user typed one ("@harsh_dev" works)
 * - Case-insensitive "starts with" match on username
 * - Excludes the current user
 * - Excludes users who haven't set a username yet (old accounts)
 * - Capped at 10 results so one keystroke can't pull the whole user table
 *
 * IMPORTANT (privacy): unlike getAllUsers, this endpoint does NOT return
 * email addresses. The whole point of usernames is that strangers never
 * see your email.
 */
const searchUsers = async (req, res) => {
  try {
    const raw = (req.query.q || '').trim().replace(/^@+/, '').toLowerCase()

    // Require at least 2 characters — avoids returning half the user base
    // for a single-letter query.
    if (raw.length < 2) {
      return res.status(200).json({
        status: 200,
        users: []
      })
    }

    const users = await prisma.user.findMany({
      where: {
        id: { not: req.user.id },
        username: {
          not: null,
          startsWith: raw
        }
      },
      select: {
        id: true,
        name: true,
        username: true,
        avatarUrl: true,
        color: true
        // deliberately NO email here
      },
      orderBy: { username: 'asc' },
      take: 10
    })

    return res.status(200).json({
      status: 200,
      users
    })
  } catch (error) {
    console.error('searchUsers error:', error)
    return res.status(500).json({
      status: 500,
      message: 'Internal server error'
    })
  }
}

/**
 * GET /api/users/:id
 *
 * Returns a single user's profile by their ID.
 */
const getUserById = async (req, res) => {
  try {
    const { id } = req.params

    const user = await prisma.user.findUnique({
      where: { id },
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
    console.error('getUserById error:', error)
    return res.status(500).json({
      status: 500,
      message: 'Internal server error'
    })
  }
}

export { getAllUsers, getUserById, searchUsers }
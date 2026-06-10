import prisma from '../lib/prisma.js'

/**
 * User Controller
 * 
 * Handles user-related operations:
 * - getAllUsers: Returns all users EXCEPT the current user (for user list)
 * - getUserById: Returns a single user's profile
 */

/**
 * GET /api/users
 * 
 * Returns all registered users except the currently logged-in user.
 * This powers the sidebar user list where you pick someone to chat with.
 * 
 * We exclude the current user because you don't need to see yourself in the list.
 * We never return passwordHash — only safe fields via `select`.
 */
const getAllUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        // Exclude the current user from the list
        id: { not: req.user.id }
      },
      select: {
        id: true,
        name: true,
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
 * GET /api/users/:id
 * 
 * Returns a single user's profile by their ID.
 * Useful when you click on a user to see their full profile.
 */
const getUserById = async (req, res) => {
  try {
    const { id } = req.params

    const user = await prisma.user.findUnique({
      where: { id },
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
    console.error('getUserById error:', error)
    return res.status(500).json({
      status: 500,
      message: 'Internal server error'
    })
  }
}

export { getAllUsers, getUserById }

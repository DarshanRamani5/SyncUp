import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../lib/api.js'
import { connectSocket, disconnectSocket } from '../lib/socket.js'

/**
 * Auth Context
 * 
 * Manages the entire authentication state for the app:
 * - user: the current logged-in user object (or null)
 * - token: the JWT token string (or null)
 * - loading: true while we're checking if the token is valid on mount
 * 
 * On app load (mount), we check localStorage for a saved token.
 * If found, we call GET /api/auth/me to verify it's still valid.
 * If valid → user is logged in. If not → clear the stale token.
 * 
 * This pattern means refreshing the page keeps you logged in
 * as long as your JWT hasn't expired (7 days).
 */

const AuthContext = createContext(null)

/**
 * Custom hook to access auth context.
 * Usage: const { user, login, logout } = useAuth()
 */
export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(localStorage.getItem('syncup_token'))
  const [loading, setLoading] = useState(true)

  /**
   * On mount: verify the stored token by calling /auth/me
   * This runs once when the app first loads.
   */
  useEffect(() => {
    const verifyToken = async () => {
      const storedToken = localStorage.getItem('syncup_token')
      
      if (!storedToken) {
        setLoading(false)
        return
      }

      try {
        const res = await api.get('/auth/me')
        setUser(res.data.user)
        setToken(storedToken)
        
        // Connect socket once auth is verified
        connectSocket(storedToken)
      } catch (error) {
        // Token is invalid or expired — clean up
        console.error('Token verification failed:', error)
        localStorage.removeItem('syncup_token')
        setToken(null)
        setUser(null)
      } finally {
        setLoading(false)
      }
    }

    verifyToken()
  }, [])

  /**
   * Register a new user
   * POST /api/auth/register with { name, email, password }
   */
  const register = useCallback(async (name, email, password) => {
    const res = await api.post('/auth/register', { name, email, password })
    const { user: userData, token: newToken } = res.data

    // Save token and update state
    localStorage.setItem('syncup_token', newToken)
    setToken(newToken)
    setUser(userData)

    // Connect socket with the new token
    connectSocket(newToken)

    return res.data
  }, [])

  /**
   * Login an existing user
   * POST /api/auth/login with { email, password }
   */
  const login = useCallback(async (email, password) => {
    const res = await api.post('/auth/login', { email, password })
    const { user: userData, token: newToken } = res.data

    localStorage.setItem('syncup_token', newToken)
    setToken(newToken)
    setUser(userData)

    connectSocket(newToken)

    return res.data
  }, [])

  /**
   * Logout — clear everything
   */
  const logout = useCallback(() => {
    localStorage.removeItem('syncup_token')
    setToken(null)
    setUser(null)
    disconnectSocket()
  }, [])

  const value = {
    user,
    token,
    loading,
    isAuthenticated: !!user,
    register,
    login,
    logout
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export default AuthContext

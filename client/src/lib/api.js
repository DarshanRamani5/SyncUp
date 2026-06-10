import axios from 'axios'

/**
 * Axios Instance
 * 
 * Pre-configured axios instance for all API calls.
 * - baseURL points to our Express server
 * - Request interceptor automatically attaches JWT token from localStorage
 * - No need to manually add Authorization header on every request
 * 
 * Usage:
 *   import api from '../lib/api'
 *   const res = await api.get('/auth/me')
 *   const res = await api.post('/auth/login', { email, password })
 */

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  headers: {
    'Content-Type': 'application/json'
  }
})

/**
 * Request Interceptor
 * 
 * Runs before EVERY request. Checks localStorage for a token
 * and adds it to the Authorization header.
 * 
 * The token is stored as "Bearer <jwt>" by our auth flow.
 */
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('syncup_token')
    if (token) {
      config.headers.Authorization = token
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

/**
 * Response Interceptor
 * 
 * Runs after EVERY response. If we get a 401 (unauthorized),
 * the token is expired or invalid — clear it and redirect to login.
 */
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('syncup_token')
      // Only redirect if we're not already on the login/register page
      if (!window.location.pathname.includes('/login') && 
          !window.location.pathname.includes('/register')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default api

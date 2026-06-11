import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

/**
 * RegisterPage
 *
 * Premium dark-themed registration form with glassmorphism effects.
 * - Name, USERNAME (new), email, password fields
 * - Client-side validation (username format checked live)
 * - Loading state on submit
 * - Redirects to /chat on successful registration
 */

// Same rules as the server: 3-20 chars, lowercase letters/numbers/underscore
const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/

const RegisterPage = () => {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const { register } = useAuth()
  const navigate = useNavigate()

  /**
   * Sanitize as the user types:
   * lowercase, strip leading @, drop anything invalid.
   * This makes it impossible to even TYPE an invalid username.
   */
  const handleUsernameChange = (e) => {
    const cleaned = e.target.value
      .toLowerCase()
      .replace(/^@+/, '')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 20)
    setUsername(cleaned)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    // Client-side validation
    if (!name || !username || !email || !password) {
      setError('Please fill in all fields')
      return
    }

    if (!USERNAME_REGEX.test(username)) {
      setError('Username must be 3-20 characters (lowercase letters, numbers, underscores)')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setLoading(true)
    try {
      await register(name, username, email, password)
      navigate('/chat', { replace: true })
    } catch (err) {
      const message = err.response?.data?.message || 'Registration failed. Please try again.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Logo */}
        <div className="auth-logo">
          <div className="auth-logo-icon">S</div>
          <span className="auth-logo-text">SyncUp</span>
        </div>

        <h1 className="auth-title">Create your account</h1>
        <p className="auth-subtitle">Join SyncUp and start chatting in real-time</p>

        {/* Error Banner */}
        {error && (
          <div className="auth-error-banner" id="register-error">
            {error}
          </div>
        )}

        {/* Form */}
        <form className="auth-form" onSubmit={handleSubmit} id="register-form">
          {/* Full Name + Username side by side to keep the card compact */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="register-name">Full Name</label>
              <input
                className="form-input"
                id="register-name"
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="register-username">Username</label>
              <div className="username-input-wrapper">
                <span className="username-at">@</span>
                <input
                  className="form-input username-input"
                  id="register-username"
                  type="text"
                  placeholder="john_doe"
                  value={username}
                  onChange={handleUsernameChange}
                  autoComplete="off"
                />
              </div>
            </div>
          </div>
          <span className="form-hint form-hint-row">
            Friends find you by your @username — lowercase letters, numbers, underscores.
          </span>

          <div className="form-group">
            <label className="form-label" htmlFor="register-email">Email</label>
            <input
              className="form-input"
              id="register-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="register-password">Password</label>
            <input
              className="form-input"
              id="register-password"
              type="password"
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <button
            className="auth-btn"
            type="submit"
            disabled={loading}
            id="register-submit-btn"
          >
            {loading ? <span className="spinner"></span> : 'Create Account'}
          </button>
        </form>

        {/* Footer */}
        <div className="auth-footer">
          Already have an account?{' '}
          <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  )
}

export default RegisterPage
import { useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import OtpInput from '../components/OtpInput.jsx'
import PasswordStrength from '../components/PasswordStrength.jsx'
import {
  validateName,
  validateUsername,
  validateEmail,
  validatePassword
} from '../lib/validation.js'

/**
 * RegisterPage
 *
 * Premium dark-themed registration with 2-step flow:
 * Step 1: Form with live validation (name, username, email, password)
 * Step 2: OTP verification (6-digit code sent to email)
 */

const RegisterPage = () => {
  // Form state
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Validation state (shown after blur / interaction)
  const [touched, setTouched] = useState({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Step state
  const [step, setStep] = useState(1) // 1 = form, 2 = OTP
  const [otpError, setOtpError] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  const { register, verifyEmail, resendOtp } = useAuth()
  const navigate = useNavigate()

  // --- Validation results (computed on each render, very cheap) ---
  const nameResult = validateName(name)
  const usernameResult = validateUsername(username)
  const emailResult = validateEmail(email)
  const passwordResult = validatePassword(password)

  const handleBlur = (field) => {
    setTouched((prev) => ({ ...prev, [field]: true }))
  }

  /**
   * Sanitize username as the user types:
   * lowercase, strip leading @, drop invalid chars.
   */
  const handleUsernameChange = (e) => {
    const cleaned = e.target.value
      .toLowerCase()
      .replace(/^@+/, '')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 20)
    setUsername(cleaned)
  }

  // --- Step 1: Submit form ---
  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    // Mark all fields as touched
    setTouched({ name: true, username: true, email: true, password: true })

    // Validate all fields
    if (!nameResult.valid) { setError(nameResult.message); return }
    if (!usernameResult.valid) { setError(usernameResult.message); return }
    if (!emailResult.valid) { setError(emailResult.message); return }
    if (!passwordResult.valid) { setError(passwordResult.message); return }

    setLoading(true)
    try {
      await register(name.trim(), username, email, password)
      setStep(2)
    } catch (err) {
      const message = err.response?.data?.message || 'Registration failed. Please try again.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  // --- Step 2: Verify OTP ---
  const handleOtpComplete = useCallback(async (otp) => {
    setOtpError('')
    setOtpLoading(true)
    try {
      await verifyEmail(email, otp)
      navigate('/chat', { replace: true })
    } catch (err) {
      const message = err.response?.data?.message || 'Verification failed. Please try again.'
      setOtpError(message)
    } finally {
      setOtpLoading(false)
    }
  }, [email, verifyEmail, navigate])

  // --- Resend OTP ---
  const handleResendOtp = async () => {
    if (resendCooldown > 0) return
    try {
      await resendOtp(email, 'email_verification')
      // Start 60s cooldown
      setResendCooldown(60)
      const interval = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(interval)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } catch (err) {
      setOtpError(err.response?.data?.message || 'Failed to resend code.')
    }
  }

  /**
   * Render validation indicator for a field.
   * Shows ✓ or error message after the field has been touched.
   */
  const renderFieldStatus = (field, result) => {
    if (!touched[field]) return null
    const value = { name, username, email, password }[field]
    if (!value) return null

    return (
      <span className={`field-status ${result.valid ? 'valid' : 'invalid'}`}>
        {result.valid ? '✓' : result.message}
      </span>
    )
  }

  // ─── Step 2: OTP Verification ─────────────────────────────

  if (step === 2) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          {/* Logo */}
          <div className="auth-logo">
            <div className="auth-logo-icon">S</div>
            <span className="auth-logo-text">SyncUp</span>
          </div>

          <h1 className="auth-title">Verify your email</h1>
          <p className="auth-subtitle">
            We sent a 6-digit code to <strong>{email}</strong>
          </p>

          {otpError && (
            <div className="auth-error-banner" id="otp-error">
              {otpError}
            </div>
          )}

          <div className="otp-section">
            <OtpInput
              onComplete={handleOtpComplete}
              disabled={otpLoading}
              error=""
            />

            {otpLoading && (
              <div className="otp-loading">
                <span className="spinner"></span>
                <span>Verifying...</span>
              </div>
            )}

            <div className="otp-resend">
              {resendCooldown > 0 ? (
                <span className="otp-resend-timer">
                  Resend code in {resendCooldown}s
                </span>
              ) : (
                <button
                  type="button"
                  className="otp-resend-btn"
                  onClick={handleResendOtp}
                  id="resend-otp-btn"
                >
                  Didn't receive the code? Resend
                </button>
              )}
            </div>
          </div>

          {/* Back link */}
          <div className="auth-footer">
            <button
              type="button"
              className="auth-link-btn"
              onClick={() => setStep(1)}
            >
              ← Back to registration
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Step 1: Registration Form ────────────────────────────

  return (
    <div className="auth-page">
      <div className="auth-card auth-card-wide">
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
          {/* Full Name + Username side by side */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label" htmlFor="register-name">Full Name</label>
              <input
                className={`form-input ${touched.name ? (nameResult.valid ? 'input-valid' : name ? 'input-invalid' : '') : ''}`}
                id="register-name"
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => handleBlur('name')}
                autoComplete="name"
                autoFocus
                maxLength={50}
              />
              {renderFieldStatus('name', nameResult)}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="register-username">Username</label>
              <div className="username-input-wrapper">
                <span className="username-at">@</span>
                <input
                  className={`form-input username-input ${touched.username ? (usernameResult.valid ? 'input-valid' : username ? 'input-invalid' : '') : ''}`}
                  id="register-username"
                  type="text"
                  placeholder="john_doe"
                  value={username}
                  onChange={handleUsernameChange}
                  onBlur={() => handleBlur('username')}
                  autoComplete="off"
                />
              </div>
              {renderFieldStatus('username', usernameResult)}
            </div>
          </div>
          <span className="form-hint form-hint-row">
            3–20 chars · starts with a letter · lowercase, numbers, underscores
          </span>

          <div className="form-group">
            <label className="form-label" htmlFor="register-email">Email</label>
            <input
              className={`form-input ${touched.email ? (emailResult.valid ? 'input-valid' : email ? 'input-invalid' : '') : ''}`}
              id="register-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => handleBlur('email')}
              autoComplete="email"
            />
            {renderFieldStatus('email', emailResult)}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="register-password">Password</label>
            <div className="password-input-wrapper">
              <input
                className={`form-input ${touched.password ? (passwordResult.valid ? 'input-valid' : password ? 'input-invalid' : '') : ''}`}
                id="register-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Create a strong password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => handleBlur('password')}
                autoComplete="new-password"
                maxLength={64}
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
            <PasswordStrength password={password} />
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
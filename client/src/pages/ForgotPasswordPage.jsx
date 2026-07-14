import { useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import OtpInput from '../components/OtpInput.jsx'
import PasswordStrength from '../components/PasswordStrength.jsx'
import { validatePassword } from '../lib/validation.js'

/**
 * ForgotPasswordPage
 *
 * 3-step password reset flow:
 * Step 1: Enter email → sends reset OTP
 * Step 2: Enter 6-digit OTP → verifies and returns resetToken
 * Step 3: Enter new password + confirm → resets password
 */
const ForgotPasswordPage = () => {
  const [step, setStep] = useState(1)

  // Step 1
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)

  // Step 2
  const [otpError, setOtpError] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)
  const [resetToken, setResetToken] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)

  // Step 3
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [resetError, setResetError] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [resetSuccess, setResetSuccess] = useState(false)

  const { forgotPassword, verifyResetOtp, resetPassword, resendOtp } = useAuth()
  const navigate = useNavigate()

  // ─── Step 1: Send reset email ──────────────────────

  const handleSendEmail = async (e) => {
    e.preventDefault()
    setEmailError('')

    if (!email) {
      setEmailError('Please enter your email address')
      return
    }

    setEmailLoading(true)
    try {
      await forgotPassword(email)
      setStep(2)
      // Start cooldown
      setResendCooldown(60)
      const interval = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) { clearInterval(interval); return 0 }
          return prev - 1
        })
      }, 1000)
    } catch (err) {
      setEmailError(err.response?.data?.message || 'Something went wrong. Please try again.')
    } finally {
      setEmailLoading(false)
    }
  }

  // ─── Step 2: Verify OTP ───────────────────────────

  const handleOtpComplete = useCallback(async (otp) => {
    setOtpError('')
    setOtpLoading(true)
    try {
      const result = await verifyResetOtp(email, otp)
      setResetToken(result.resetToken)
      setStep(3)
    } catch (err) {
      setOtpError(err.response?.data?.message || 'Invalid code. Please try again.')
    } finally {
      setOtpLoading(false)
    }
  }, [email, verifyResetOtp])

  const handleResendOtp = async () => {
    if (resendCooldown > 0) return
    try {
      await resendOtp(email, 'password_reset')
      setResendCooldown(60)
      const interval = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) { clearInterval(interval); return 0 }
          return prev - 1
        })
      }, 1000)
    } catch (err) {
      setOtpError(err.response?.data?.message || 'Failed to resend code.')
    }
  }

  // ─── Step 3: Reset password ───────────────────────

  const handleResetPassword = async (e) => {
    e.preventDefault()
    setResetError('')

    // Validate password
    const passwordCheck = validatePassword(newPassword)
    if (!passwordCheck.valid) {
      setResetError(passwordCheck.message)
      return
    }

    if (newPassword !== confirmPassword) {
      setResetError('Passwords do not match')
      return
    }

    setResetLoading(true)
    try {
      await resetPassword(resetToken, newPassword)
      setResetSuccess(true)
    } catch (err) {
      setResetError(err.response?.data?.message || 'Failed to reset password. Please try again.')
    } finally {
      setResetLoading(false)
    }
  }

  // ─── Success screen ───────────────────────────────

  if (resetSuccess) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-logo">
            <div className="auth-logo-icon">S</div>
            <span className="auth-logo-text">SyncUp</span>
          </div>

          <div className="auth-success-section">
            <div className="auth-success-icon">✓</div>
            <h1 className="auth-title">Password Reset!</h1>
            <p className="auth-subtitle">
              Your password has been reset successfully. You can now log in with your new password.
            </p>
            <button
              className="auth-btn"
              onClick={() => navigate('/login', { replace: true })}
              id="go-to-login-btn"
            >
              Go to Login
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Step indicators ──────────────────────────────

  const stepLabels = ['Email', 'Verify', 'New Password']

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Logo */}
        <div className="auth-logo">
          <div className="auth-logo-icon">S</div>
          <span className="auth-logo-text">SyncUp</span>
        </div>

        {/* Step indicator */}
        <div className="auth-steps">
          {stepLabels.map((label, i) => (
            <div
              key={label}
              className={`auth-step ${i + 1 === step ? 'active' : ''} ${i + 1 < step ? 'completed' : ''}`}
            >
              <div className="auth-step-dot">
                {i + 1 < step ? '✓' : i + 1}
              </div>
              <span className="auth-step-label">{label}</span>
            </div>
          ))}
        </div>

        {/* Step 1: Enter email */}
        {step === 1 && (
          <>
            <h1 className="auth-title">Forgot password?</h1>
            <p className="auth-subtitle">
              Enter your email and we'll send you a code to reset your password.
            </p>

            {emailError && (
              <div className="auth-error-banner" id="forgot-email-error">
                {emailError}
              </div>
            )}

            <form className="auth-form" onSubmit={handleSendEmail} id="forgot-email-form">
              <div className="form-group">
                <label className="form-label" htmlFor="forgot-email">Email</label>
                <input
                  className="form-input"
                  id="forgot-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                />
              </div>

              <button
                className="auth-btn"
                type="submit"
                disabled={emailLoading}
                id="send-reset-btn"
              >
                {emailLoading ? <span className="spinner"></span> : 'Send Reset Code'}
              </button>
            </form>
          </>
        )}

        {/* Step 2: Enter OTP */}
        {step === 2 && (
          <>
            <h1 className="auth-title">Check your email</h1>
            <p className="auth-subtitle">
              We sent a 6-digit code to <strong>{email}</strong>
            </p>

            {otpError && (
              <div className="auth-error-banner" id="forgot-otp-error">
                {otpError}
              </div>
            )}

            <div className="otp-section">
              <OtpInput
                onComplete={handleOtpComplete}
                disabled={otpLoading}
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
                    id="forgot-resend-btn"
                  >
                    Didn't receive the code? Resend
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {/* Step 3: New password */}
        {step === 3 && (
          <>
            <h1 className="auth-title">Set new password</h1>
            <p className="auth-subtitle">
              Create a strong password for your account.
            </p>

            {resetError && (
              <div className="auth-error-banner" id="reset-password-error">
                {resetError}
              </div>
            )}

            <form className="auth-form" onSubmit={handleResetPassword} id="reset-password-form">
              <div className="form-group">
                <label className="form-label" htmlFor="new-password">New Password</label>
                <div className="password-input-wrapper">
                  <input
                    className="form-input"
                    id="new-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Create a strong password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    autoFocus
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
                <PasswordStrength password={newPassword} />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="confirm-password">Confirm Password</label>
                <input
                  className={`form-input ${confirmPassword && confirmPassword !== newPassword ? 'input-invalid' : ''} ${confirmPassword && confirmPassword === newPassword ? 'input-valid' : ''}`}
                  id="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
                {confirmPassword && confirmPassword !== newPassword && (
                  <span className="field-status invalid">Passwords do not match</span>
                )}
                {confirmPassword && confirmPassword === newPassword && (
                  <span className="field-status valid">✓ Passwords match</span>
                )}
              </div>

              <button
                className="auth-btn"
                type="submit"
                disabled={resetLoading}
                id="reset-submit-btn"
              >
                {resetLoading ? <span className="spinner"></span> : 'Reset Password'}
              </button>
            </form>
          </>
        )}

        {/* Footer */}
        <div className="auth-footer">
          <Link to="/login">← Back to login</Link>
        </div>
      </div>
    </div>
  )
}

export default ForgotPasswordPage

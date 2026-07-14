/**
 * Validation Utility (Client-side)
 *
 * Mirrors the server-side validation rules EXACTLY.
 * Used by auth forms for live inline validation.
 */

// --- Name ---
export const NAME_MIN = 2
export const NAME_MAX = 50
const NAME_REGEX = /^[a-zA-ZÀ-ÖÙ-öù-ÿ\s'\-]+$/

export const validateName = (name) => {
  if (!name || typeof name !== 'string') {
    return { valid: false, message: 'Name is required' }
  }
  const trimmed = name.trim()
  if (trimmed.length < NAME_MIN) {
    return { valid: false, message: `Name must be at least ${NAME_MIN} characters` }
  }
  if (trimmed.length > NAME_MAX) {
    return { valid: false, message: `Name must be at most ${NAME_MAX} characters` }
  }
  if (!NAME_REGEX.test(trimmed)) {
    return { valid: false, message: 'Name can only contain letters, spaces, hyphens, and apostrophes' }
  }
  return { valid: true, message: '' }
}

// --- Username ---
export const USERNAME_MIN = 3
export const USERNAME_MAX = 20
const USERNAME_REGEX = /^[a-z][a-z0-9_]{2,19}$/

export const validateUsername = (username) => {
  if (!username || typeof username !== 'string') {
    return { valid: false, message: 'Username is required' }
  }
  if (username.length < USERNAME_MIN) {
    return { valid: false, message: `Username must be at least ${USERNAME_MIN} characters` }
  }
  if (username.length > USERNAME_MAX) {
    return { valid: false, message: `Username must be at most ${USERNAME_MAX} characters` }
  }
  if (!USERNAME_REGEX.test(username)) {
    if (!/^[a-z]/.test(username)) {
      return { valid: false, message: 'Username must start with a letter' }
    }
    return { valid: false, message: 'Only lowercase letters, numbers, and underscores allowed' }
  }
  return { valid: true, message: '' }
}

// --- Email ---
export const EMAIL_MAX = 254
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const validateEmail = (email) => {
  if (!email || typeof email !== 'string') {
    return { valid: false, message: 'Email is required' }
  }
  if (email.length > EMAIL_MAX) {
    return { valid: false, message: `Email must be at most ${EMAIL_MAX} characters` }
  }
  if (!EMAIL_REGEX.test(email)) {
    return { valid: false, message: 'Please enter a valid email address' }
  }
  return { valid: true, message: '' }
}

// --- Password ---
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 64

export const getPasswordChecks = (password) => {
  if (!password || typeof password !== 'string') {
    return {
      length: false,
      uppercase: false,
      lowercase: false,
      digit: false,
      special: false
    }
  }
  return {
    length: password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    digit: /[0-9]/.test(password),
    special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)
  }
}

export const validatePassword = (password) => {
  const checks = getPasswordChecks(password)
  const allPassed = Object.values(checks).every(Boolean)

  if (allPassed) {
    return { valid: true, message: '', checks }
  }

  if (!checks.length) {
    return { valid: false, message: `Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters`, checks }
  }
  if (!checks.uppercase) {
    return { valid: false, message: 'Must contain at least one uppercase letter', checks }
  }
  if (!checks.lowercase) {
    return { valid: false, message: 'Must contain at least one lowercase letter', checks }
  }
  if (!checks.digit) {
    return { valid: false, message: 'Must contain at least one number', checks }
  }
  if (!checks.special) {
    return { valid: false, message: 'Must contain at least one special character', checks }
  }

  return { valid: false, message: 'Password does not meet requirements', checks }
}

/**
 * Get password strength level (0-4) from checks.
 */
export const getPasswordStrength = (password) => {
  const checks = getPasswordChecks(password)
  const passed = Object.values(checks).filter(Boolean).length
  return passed // 0-5
}

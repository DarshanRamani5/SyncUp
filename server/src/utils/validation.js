/**
 * Validation Utility
 *
 * Shared validation rules for auth inputs.
 * These MUST match the client-side validators exactly.
 */

// --- Name ---
// 2–50 chars, letters (including accented), spaces, hyphens, apostrophes
const NAME_MIN = 2
const NAME_MAX = 50
const NAME_REGEX = /^[a-zA-ZÀ-ÖÙ-öù-ÿ\s'\-]+$/

const validateName = (name) => {
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
// 3–20 chars, lowercase letters, numbers, underscores. Must start with a letter.
const USERNAME_MIN = 3
const USERNAME_MAX = 20
const USERNAME_REGEX = /^[a-z][a-z0-9_]{2,19}$/

const validateUsername = (username) => {
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
    return { valid: false, message: 'Username can only contain lowercase letters, numbers, and underscores' }
  }
  return { valid: true, message: '' }
}

// --- Email ---
const EMAIL_MAX = 254
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const validateEmail = (email) => {
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
// 8–64 chars, must contain: 1 uppercase, 1 lowercase, 1 digit, 1 special char
const PASSWORD_MIN = 8
const PASSWORD_MAX = 64

const getPasswordChecks = (password) => {
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

const validatePassword = (password) => {
  const checks = getPasswordChecks(password)
  const allPassed = Object.values(checks).every(Boolean)

  if (allPassed) {
    return { valid: true, message: '', checks }
  }

  // Return the first failing check as the message
  if (!checks.length) {
    return { valid: false, message: `Password must be ${PASSWORD_MIN}–${PASSWORD_MAX} characters`, checks }
  }
  if (!checks.uppercase) {
    return { valid: false, message: 'Password must contain at least one uppercase letter', checks }
  }
  if (!checks.lowercase) {
    return { valid: false, message: 'Password must contain at least one lowercase letter', checks }
  }
  if (!checks.digit) {
    return { valid: false, message: 'Password must contain at least one number', checks }
  }
  if (!checks.special) {
    return { valid: false, message: 'Password must contain at least one special character', checks }
  }

  return { valid: false, message: 'Password does not meet requirements', checks }
}

export {
  validateName,
  validateUsername,
  validateEmail,
  validatePassword,
  getPasswordChecks,
  NAME_MIN,
  NAME_MAX,
  USERNAME_MIN,
  USERNAME_MAX,
  PASSWORD_MIN,
  PASSWORD_MAX
}

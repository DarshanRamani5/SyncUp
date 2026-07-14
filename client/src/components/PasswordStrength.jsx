import { getPasswordChecks } from '../lib/validation.js'

/**
 * PasswordStrength
 *
 * Visual password strength indicator:
 * - Animated gradient bar (red → orange → yellow → green)
 * - Checklist with ✓/✗ for each requirement
 *
 * @param {Object} props
 * @param {string} props.password — the current password value
 */
const PasswordStrength = ({ password }) => {
  const checks = getPasswordChecks(password)
  const passed = Object.values(checks).filter(Boolean).length

  // Don't show anything if password is empty
  if (!password) return null

  const strengthLabels = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong']
  const strengthColors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981']
  const strengthPercent = (passed / 5) * 100

  const label = strengthLabels[Math.max(0, passed - 1)] || 'Very weak'
  const color = strengthColors[Math.max(0, passed - 1)] || '#ef4444'

  const checkItems = [
    { key: 'length', label: '8–64 characters', pass: checks.length },
    { key: 'uppercase', label: 'Uppercase letter (A-Z)', pass: checks.uppercase },
    { key: 'lowercase', label: 'Lowercase letter (a-z)', pass: checks.lowercase },
    { key: 'digit', label: 'Number (0-9)', pass: checks.digit },
    { key: 'special', label: 'Special character (!@#$...)', pass: checks.special }
  ]

  return (
    <div className="password-strength">
      {/* Strength bar */}
      <div className="strength-bar-container">
        <div
          className="strength-bar-fill"
          style={{
            width: `${strengthPercent}%`,
            background: color
          }}
        />
      </div>
      <div className="strength-label" style={{ color }}>
        {label}
      </div>

      {/* Checklist */}
      <div className="strength-checks">
        {checkItems.map((item) => (
          <div
            key={item.key}
            className={`strength-check ${item.pass ? 'pass' : 'fail'}`}
          >
            <span className="strength-check-icon">
              {item.pass ? '✓' : '✗'}
            </span>
            <span className="strength-check-label">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default PasswordStrength

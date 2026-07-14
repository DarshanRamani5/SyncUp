import { useState, useRef, useEffect } from 'react'

/**
 * OtpInput
 *
 * 6 individual digit input boxes for OTP entry.
 * Features:
 * - Auto-focus next input on type
 * - Auto-focus previous on backspace
 * - Paste support (paste 6 digits at once)
 * - Auto-submit when all 6 digits entered
 * - Styled to match the dark glassmorphism theme
 *
 * @param {Object} props
 * @param {(otp: string) => void} props.onComplete — called when all 6 digits entered
 * @param {boolean} props.disabled — disable all inputs
 * @param {string} props.error — error message to display
 */
const OtpInput = ({ onComplete, disabled = false, error = '' }) => {
  const [digits, setDigits] = useState(['', '', '', '', '', ''])
  const inputRefs = useRef([])

  // Focus first input on mount
  useEffect(() => {
    if (inputRefs.current[0]) {
      inputRefs.current[0].focus()
    }
  }, [])

  const handleChange = (index, value) => {
    // Only allow single digits
    const digit = value.replace(/\D/g, '').slice(-1)

    const newDigits = [...digits]
    newDigits[index] = digit
    setDigits(newDigits)

    // Auto-focus next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }

    // Auto-submit when all filled
    if (digit && index === 5) {
      const otp = newDigits.join('')
      if (otp.length === 6) {
        onComplete?.(otp)
      }
    }

    // Also check if all filled (in case user fills a middle one last)
    const allFilled = newDigits.every((d) => d !== '')
    if (allFilled) {
      onComplete?.(newDigits.join(''))
    }
  }

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        // Move to previous input and clear it
        const newDigits = [...digits]
        newDigits[index - 1] = ''
        setDigits(newDigits)
        inputRefs.current[index - 1]?.focus()
        e.preventDefault()
      }
    }

    if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus()
      e.preventDefault()
    }

    if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus()
      e.preventDefault()
    }
  }

  const handlePaste = (e) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)

    if (pasted.length === 0) return

    const newDigits = [...digits]
    for (let i = 0; i < 6; i++) {
      newDigits[i] = pasted[i] || ''
    }
    setDigits(newDigits)

    // Focus the next empty input, or the last one
    const nextEmpty = newDigits.findIndex((d) => d === '')
    const focusIndex = nextEmpty === -1 ? 5 : nextEmpty
    inputRefs.current[focusIndex]?.focus()

    // Auto-submit if all filled
    if (pasted.length === 6) {
      onComplete?.(pasted)
    }
  }

  /** Reset all digits (called externally via parent when needed) */
  const reset = () => {
    setDigits(['', '', '', '', '', ''])
    inputRefs.current[0]?.focus()
  }

  return (
    <div className="otp-container">
      <div className="otp-input-group">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(el) => (inputRefs.current[index] = el)}
            className={`otp-digit ${digit ? 'filled' : ''} ${error ? 'otp-error' : ''}`}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={index === 0 ? handlePaste : undefined}
            disabled={disabled}
            autoComplete="one-time-code"
            id={`otp-digit-${index}`}
          />
        ))}
      </div>
      {error && <p className="otp-error-text">{error}</p>}
    </div>
  )
}

export default OtpInput

/**
 * Brevo Email Service
 *
 * Sends transactional emails (OTP codes) via the Brevo REST API.
 * Uses plain fetch — no SDK dependency needed.
 *
 * Environment variables required:
 *   BREVO_API_KEY          — from Brevo Dashboard → SMTP & API → API Keys
 *   BREVO_SENDER_EMAIL     — verified sender email in Brevo
 *   BREVO_SENDER_NAME      — display name for the sender
 */

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

const sendEmail = async ({ to, toName, subject, html }) => {
  const apiKey = process.env.BREVO_API_KEY

  if (!apiKey) {
    console.warn('⚠️  BREVO_API_KEY not set — skipping email send')
    return null
  }

  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'noreply@syncup.app'
  const senderName = process.env.BREVO_SENDER_NAME || 'SyncUp'

  // 🛠️ Using plain text content to avoid Gmail's strict HTML spam bots
  const textContent = html.replace(/<[^>]*>?/gm, '').trim()

  const body = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: to, name: toName || to }],
    subject,
    textContent
  }

  const response = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    console.error('❌ Brevo email send failed:', response.status, errorData)
    throw new Error(`Failed to send email: ${response.status}`)
  }

  const result = await response.json()
  console.log(`📧 Email sent to ${to} — messageId: ${result.messageId}`)
  return result
}

/**
 * Generate the HTML for an OTP verification email.
 * Beautiful, dark-themed, responsive email template.
 */
const buildOtpEmailHtml = (otp, type) => {
  const isVerification = type === 'email_verification'
  const title = isVerification ? 'Verify Your Email' : 'Reset Your Password'
  const heading = isVerification
    ? 'Welcome to SyncUp! 🎉'
    : 'Password Reset Request 🔑'
  const description = isVerification
    ? 'Thanks for signing up! Enter this code to verify your email address and start chatting.'
    : 'We received a request to reset your password. Enter this code to set a new password.'
  const footer = isVerification
    ? 'If you didn\'t create a SyncUp account, you can safely ignore this email.'
    : 'If you didn\'t request a password reset, you can safely ignore this email. Your password will remain unchanged.'

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0f;font-family:'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0f;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:linear-gradient(145deg,#1a1a28,#12121a);border:1px solid rgba(255,255,255,0.08);border-radius:20px;overflow:hidden;">
          <!-- Logo Header -->
          <tr>
            <td style="padding:40px 40px 24px;text-align:center;">
              <div style="display:inline-block;width:48px;height:48px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:12px;line-height:48px;font-size:22px;font-weight:800;color:white;text-align:center;">S</div>
              <p style="margin:12px 0 0;font-size:22px;font-weight:700;color:#f1f1f7;">SyncUp</p>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:0 40px;">
              <h1 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#f1f1f7;text-align:center;">${heading}</h1>
              <p style="margin:0 0 32px;font-size:14px;color:#a1a1b5;text-align:center;line-height:1.6;">${description}</p>
            </td>
          </tr>
          <!-- OTP Code -->
          <tr>
            <td style="padding:0 40px;text-align:center;">
              <div style="display:inline-block;padding:16px 40px;background:rgba(99,102,241,0.12);border:1px solid rgba(99,102,241,0.25);border-radius:12px;">
                <span style="font-size:36px;font-weight:700;letter-spacing:12px;color:#a5b4fc;font-family:'Courier New',monospace;">${otp}</span>
              </div>
              <p style="margin:16px 0 0;font-size:12px;color:#6b6b80;">This code expires in 10 minutes</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:32px 40px 40px;">
              <hr style="border:none;border-top:1px solid rgba(255,255,255,0.06);margin:0 0 20px;">
              <p style="margin:0;font-size:12px;color:#6b6b80;text-align:center;line-height:1.5;">${footer}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Send an OTP email for verification or password reset.
 * @param {string} to    — recipient email
 * @param {string} otp   — the plain-text 6-digit OTP
 * @param {string} type  — "email_verification" | "password_reset"
 */
const sendOtpEmail = async (to, otp, type) => {
  const isVerification = type === 'email_verification'
  const subject = isVerification
    ? `${otp} is your SyncUp verification code`
    : `${otp} is your SyncUp password reset code`

  const html = buildOtpEmailHtml(otp, type)

  return sendEmail({ to, subject, html })
}

export { sendEmail, sendOtpEmail }

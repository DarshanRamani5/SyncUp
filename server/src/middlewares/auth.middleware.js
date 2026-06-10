import jwt from 'jsonwebtoken'

/**
 * JWT Authentication Middleware
 * 
 * How it works:
 * 1. Client sends request with header: Authorization: Bearer <token>
 * 2. We extract the token from the header
 * 3. We verify it using the same JWT_SECRET used to sign it
 * 4. If valid, we attach the decoded user data to req.user
 * 5. If invalid/missing, we return 401 Unauthorized
 * 
 * Every protected route uses this middleware before the controller runs.
 */
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization

  // Check if Authorization header exists
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 401,
      message: 'Unauthorized — no token provided'
    })
  }

  // Extract the token (remove "Bearer " prefix)
  const token = authHeader.split(' ')[1]

  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET is not defined in environment variables')
  }

  // Verify the token
  jwt.verify(token, secret, (err, decoded) => {
    if (err) {
      return res.status(401).json({
        status: 401,
        message: 'Unauthorized — invalid or expired token'
      })
    }

    // Attach the decoded user payload to the request object
    // This will contain: { id, name, email, iat, exp }
    req.user = decoded
    next()
  })
}

export default authMiddleware

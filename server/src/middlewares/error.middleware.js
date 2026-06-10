/**
 * Global Error Handler Middleware
 * 
 * This MUST be the LAST middleware added to Express (after all routes).
 * Express recognizes error handlers by their 4 parameters: (err, req, res, next).
 * 
 * If any controller does: next(error), or throws an unhandled error,
 * Express skips all normal middleware and jumps straight here.
 */

// eslint-disable-next-line no-unused-vars
const errorMiddleware = (err, req, res, next) => {
  console.error('🔥 Unhandled Error:', err.message)
  console.error(err.stack)

  const statusCode = err.statusCode || 500
  const message = err.message || 'Internal Server Error'

  res.status(statusCode).json({
    status: statusCode,
    message,
    // Only show stack trace in development
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  })
}

export default errorMiddleware

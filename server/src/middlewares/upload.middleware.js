import multer from 'multer'

/**
 * Upload Middleware (multer)
 *
 * Handles multipart/form-data file uploads for chat images.
 *
 * Why memory storage?
 *   We don't want temp files cluttering the disk. multer keeps the file as a
 *   Buffer in req.file.buffer, which we stream straight to Cloudinary.
 *
 * Limits enforced here (server-authoritative — the client also pre-checks,
 * but that can be bypassed, so this is the real gate):
 *   - Max size: 10 MB
 *   - Allowed types: JPEG, PNG, GIF, WebP
 *
 * Usage on a route:
 *   router.post('/upload', authMiddleware, uploadImage, controller)
 *   where uploadImage = upload.single('image')
 */

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

// Image MIME types we accept
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
]

/**
 * Reject anything that isn't an allowed image type.
 * Passing an Error to the callback makes multer fail the request.
 */
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed'), false)
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter
})

/**
 * Middleware for a single image field named "image".
 * Wrapped so we can translate multer's errors into our standard
 * { status, message } JSON shape instead of letting them hit the
 * global error handler as a generic 500.
 */
export const uploadSingleImage = (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      // File too large → multer sets this specific code
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          status: 413,
          message: 'Image is too large — the maximum size is 10 MB'
        })
      }
      // Wrong file type (from our fileFilter) or any other upload error
      return res.status(400).json({
        status: 400,
        message: err.message || 'Image upload failed'
      })
    }
    next()
  })
}

export default uploadSingleImage

import { v2 as cloudinary } from 'cloudinary'

/**
 * Cloudinary Configuration
 *
 * Handles image uploads for chat messages (file sharing).
 *
 * Flow:
 *   Client → POST /api/messages/upload (multipart) → multer (memory) →
 *   uploadImage() → Cloudinary → { url, public_id } → sent with the message
 *
 * Auth: cloud name + API key + API secret (server-side only — the secret
 * must never reach the client, which is why uploads go through Express).
 *
 * Env vars required:
 *   CLOUDINARY_CLOUD_NAME — your Cloudinary cloud name
 *   CLOUDINARY_API_KEY    — your Cloudinary API key
 *   CLOUDINARY_API_SECRET — your Cloudinary API secret
 *
 * If any are missing, uploads are disabled (no-op) and the upload endpoint
 * returns a clear error — the rest of the app keeps working text-only.
 */

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
const API_KEY = process.env.CLOUDINARY_API_KEY
const API_SECRET = process.env.CLOUDINARY_API_SECRET

// Folder inside Cloudinary where chat images are stored (keeps the media library tidy)
const UPLOAD_FOLDER = 'syncup/messages'

/**
 * Check if Cloudinary is configured (all three credentials present)
 */
export const isCloudinaryConfigured = () => {
  return !!(CLOUD_NAME && API_KEY && API_SECRET)
}

// Configure the SDK once at module load (no-op if creds are missing)
if (isCloudinaryConfigured()) {
  cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: API_KEY,
    api_secret: API_SECRET
  })
  console.log('🖼️  Cloudinary configured')
} else {
  console.warn('⚠️  Cloudinary not configured — image uploads disabled')
}

/**
 * Upload an image buffer to Cloudinary.
 *
 * We use upload_stream (not a file path) because multer keeps the file in
 * memory as a Buffer — there's no temp file on disk to point at.
 *
 * @param {Buffer} buffer - The raw image bytes from multer
 * @returns {Promise<{ url: string, public_id: string }>} Cloudinary result
 */
export const uploadImage = (buffer) => {
  return new Promise((resolve, reject) => {
    if (!isCloudinaryConfigured()) {
      return reject(new Error('Cloudinary is not configured'))
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: UPLOAD_FOLDER,
        resource_type: 'image'
      },
      (error, result) => {
        if (error) return reject(error)
        // secure_url → https URL the client can render in an <img> tag
        resolve({ url: result.secure_url, public_id: result.public_id })
      }
    )

    // Push the buffer into the stream to kick off the upload
    uploadStream.end(buffer)
  })
}

/**
 * Delete an image from Cloudinary by its public_id.
 *
 * Used when a message with an image is deleted, so we don't leave orphaned
 * assets in the Cloudinary media library. No-op if not configured.
 *
 * @param {string} publicId - The Cloudinary public_id stored on the message
 */
export const deleteImage = async (publicId) => {
  if (!isCloudinaryConfigured() || !publicId) return

  try {
    await cloudinary.uploader.destroy(publicId)
  } catch (error) {
    console.error('🖼️  Cloudinary delete error:', error.message)
  }
}

export default { isCloudinaryConfigured, uploadImage, deleteImage }

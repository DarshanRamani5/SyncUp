import { useState, useRef, useEffect, useCallback } from 'react'

/**
 * MessageInput
 * 
 * Text input area for composing and sending messages.
 * - Enter to send (Shift+Enter for new line)
 * - Send button with arrow icon
 * - Auto-resizing textarea
 * - Attach button for sending an image (with optional text caption)
 * - Disabled state when no conversation is active
 * 
 * Image flow:
 *   pick file → client-side validate (type + 10 MB) → show preview →
 *   on send: onUploadImage(file) → { image, public_id } → onSend(text, attachment)
 * 
 * Props:
 * - onSend: (messageText, attachment?) => void — called when user sends
 * - onTyping: (isTyping) => void — typing indicator
 * - onUploadImage: (file) => Promise<{ image, public_id }> — uploads to server
 * - disabled: boolean — disable input when no conversation selected
 */

// Must match the server-side limits (upload.middleware.js)
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

const MessageInput = ({ onSend, onTyping, onUploadImage, disabled = false }) => {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [imageFile, setImageFile] = useState(null)     // the File the user picked
  const [imagePreview, setImagePreview] = useState(null) // object URL for preview
  const [error, setError] = useState('')
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const typingTimeoutRef = useRef(null)

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
    }
  }, [text])

  // Revoke the preview object URL when it changes/unmounts to avoid memory leaks
  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview)
    }
  }, [imagePreview])

  /**
   * Validate and stage a picked file for sending.
   */
  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    // Reset the input so picking the same file again still fires onChange
    e.target.value = ''
    if (!file) return

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Only JPEG, PNG, GIF, or WebP images are allowed')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('Image is too large — the maximum size is 10 MB')
      return
    }

    setError('')
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  /**
   * Clear the staged image (the little x on the preview).
   */
  const clearImage = () => {
    setImageFile(null)
    setImagePreview(null)
    setError('')
  }

  const handleSend = async () => {
    const trimmed = text.trim()
    // Nothing to send if there's neither text nor an image
    if ((!trimmed && !imageFile) || sending || disabled) return

    setSending(true)
    setError('')
    try {
      let attachment = null

      // Upload the image first (if any), then send the message with its URL
      if (imageFile && onUploadImage) {
        attachment = await onUploadImage(imageFile)
      }

      await onSend(trimmed, attachment)

      // Reset everything on success
      setText('')
      clearImage()
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    } catch (err) {
      console.error('Failed to send:', err)
      // Prefer the socket error text (e.g. the rate-limit "wait Ns" message),
      // then an axios/HTTP server message, then a generic fallback.
      setError(
        err.message ||
        err.response?.data?.message ||
        'Failed to send. Please try again.'
      )
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e) => {
    // Enter sends, Shift+Enter adds new line
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Send button is active if there's text or a staged image
  const canSend = (text.trim() || imageFile) && !sending && !disabled

  return (
    <div className="chat-input-area">
      {/* Error message (validation or upload failure) */}
      {error && <div className="chat-input-error">{error}</div>}

      {/* Image preview strip — shows the staged image before sending */}
      {imagePreview && (
        <div className="image-preview">
          <img src={imagePreview} alt="Selected" className="image-preview-thumb" />
          <button
            className="image-preview-remove"
            onClick={clearImage}
            title="Remove image"
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      )}

      <div className="chat-input-wrapper">
        {/* Hidden file input, triggered by the attach button */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_TYPES.join(',')}
          onChange={handleFileChange}
          style={{ display: 'none' }}
          id="image-file-input"
        />

        {/* Attach (paperclip) button */}
        <button
          className="chat-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || sending}
          title="Attach image"
          type="button"
          id="attach-image-btn"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
          </svg>
        </button>

        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder={disabled ? 'Select a conversation...' : 'Type a message...'}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            // Emit typing indicator
            if (onTyping && e.target.value.trim()) {
              onTyping(true)
              // Clear previous timeout and set a new one
              clearTimeout(typingTimeoutRef.current)
              typingTimeoutRef.current = setTimeout(() => onTyping(false), 2000)
            }
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled || sending}
          rows={1}
          id="message-input"
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!canSend}
          title="Send message"
          id="send-message-btn"
        >
          {sending ? (
            <span className="loading-spinner" style={{ width: 16, height: 16, borderWidth: 2 }}></span>
          ) : (
            /* Arrow-up send icon (SVG) */
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}

export default MessageInput

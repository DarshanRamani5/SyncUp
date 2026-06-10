import { useState, useRef, useEffect, useCallback } from 'react'

/**
 * MessageInput
 * 
 * Text input area for composing and sending messages.
 * - Enter to send (Shift+Enter for new line)
 * - Send button with arrow icon
 * - Auto-resizing textarea
 * - Disabled state when no conversation is active
 * 
 * Props:
 * - onSend: (messageText) => void — called when user sends a message
 * - disabled: boolean — disable input when no conversation selected
 */
const MessageInput = ({ onSend, onTyping, disabled = false }) => {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const textareaRef = useRef(null)
  const typingTimeoutRef = useRef(null)

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
    }
  }, [text])

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending || disabled) return

    setSending(true)
    try {
      await onSend(trimmed)
      setText('')
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    } catch (error) {
      console.error('Failed to send:', error)
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

  return (
    <div className="chat-input-area">
      <div className="chat-input-wrapper">
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
          disabled={!text.trim() || sending || disabled}
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

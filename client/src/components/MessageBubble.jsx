import { useState, useRef, useEffect } from 'react'
import { useChat } from '../context/ChatContext.jsx'

/**
 * Format a timestamp for display
 * Shows time like "2:30 PM"
 */
const formatTime = (dateString) => {
  const date = new Date(dateString)
  return date.toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: true 
  })
}

const MessageBubble = ({ message, isSent, isLastMessage }) => {
  const { editMessage, deleteMessage, deleteForMe } = useChat()
  const [isEditing, setIsEditing] = useState(false)
  const [editBody, setEditBody] = useState(message.body || '')
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef(null)

  // Message is read if seenBy includes someone other than the sender
  const isRead = message.seenBy?.some(u => u.id !== message.userId)
  
  // Message is delivered to server if it has a real DB UUID (not a temp optimistic ID)
  const isDelivered = message.id && !message.id.startsWith('temp-')

  let tickStr = '✓'
  if (isRead || isDelivered) tickStr = '✓✓'

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleEditSubmit = (e) => {
    e.preventDefault()
    if (editBody.trim() && editBody.trim() !== message.body) {
      editMessage(message.id, editBody)
    }
    setIsEditing(false)
    setShowMenu(false)
  }

  const handleDeleteForEveryone = () => {
    if (window.confirm("Delete this message for everyone?")) {
      deleteMessage(message.id)
    }
    setShowMenu(false)
  }

  const handleDeleteForMe = () => {
    deleteForMe([message.id])
    setShowMenu(false)
  }

  // Deleted message placeholder
  if (message.isDeleted) {
    return (
      <div className={`message-row ${isSent ? 'sent' : 'received'}`}>
        <div className="message-bubble deleted">
          <div className="message-deleted-content">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
            </svg>
            <span>This message was deleted</span>
          </div>
          <div className="message-time">
            {formatTime(message.createdAt)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`message-row ${isSent ? 'sent' : 'received'}`}>
      <div className="message-bubble" onMouseLeave={() => setShowMenu(false)}>
        {/* Show sender name for received messages */}
        {!isSent && message.createdBy && (
          <div className="message-sender">{message.createdBy.name}</div>
        )}
        
        {isEditing ? (
          <form onSubmit={handleEditSubmit} className="message-edit-form">
            <input 
              type="text" 
              value={editBody} 
              onChange={(e) => setEditBody(e.target.value)} 
              autoFocus 
              className="message-edit-input"
            />
            <div className="message-edit-actions">
              <button type="submit" className="save-btn">Save</button>
              <button type="button" onClick={() => { setIsEditing(false); setEditBody(message.body || '') }} className="cancel-btn">Cancel</button>
            </div>
          </form>
        ) : (
          <div className="message-content-wrapper">
            <div className="message-body">{message.body}</div>
            
            {/* Context Menu — available on ALL messages */}
            {isDelivered && (
              <div className="message-menu-container" ref={menuRef}>
                <button className="message-menu-btn" onClick={() => setShowMenu(!showMenu)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                {showMenu && (
                  <div className={`message-dropdown ${isLastMessage ? 'dropdown-up' : ''}`}>
                    {/* Edit — only for sent messages */}
                    {isSent && (
                      <button onClick={() => { setIsEditing(true); setShowMenu(false) }}>
                        ✏️ Edit
                      </button>
                    )}
                    {/* Delete for everyone — only for sent messages */}
                    {isSent && (
                      <button onClick={handleDeleteForEveryone} className="delete">
                        🗑️ Delete for everyone
                      </button>
                    )}
                    {/* Delete for me — available on ALL messages */}
                    <button onClick={handleDeleteForMe} className="delete">
                      ❌ Delete for me
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        
        {!isEditing && (
          <div className="message-time">
            {message.isEdited && <span className="edited-tag">Edited</span>}
            {formatTime(message.createdAt)}
            {isSent && (
              <span className={`delivery-tick ${isRead ? 'read' : ''}`}>
                {tickStr}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default MessageBubble

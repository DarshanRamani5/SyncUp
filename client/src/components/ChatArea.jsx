import { useEffect, useRef, useState, useLayoutEffect } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useChat } from '../context/ChatContext.jsx'
import MessageBubble from './MessageBubble.jsx'
import MessageInput from './MessageInput.jsx'

/**
 * ChatArea
 * 
 * The main chat panel — right side of the layout.
 * Displays either:
 * - Empty state (no conversation selected)
 * - Chat header + message list + input (conversation active)
 * 
 * Features:
 * - Auto-scrolls to bottom on new messages
 * - Shows loading state while fetching messages
 * - Date separators between messages from different days
 * - Renders MessageBubble for each message (sent vs received)
 */
const ChatArea = () => {
  const { user } = useAuth()
  const { 
    activeConversation, 
    setActiveConversation,
    messages, 
    loadingMessages, 
    sendMessage, 
    uploadImage,
    hasMoreMessages, 
    loadMoreMessages,
    typingUsers,
    sendTyping,
    onlineUsers,
    isConnected,
    markMessagesRead,
    clearChatHistory,
    deleteForMe
  } = useChat()
  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const unreadSeparatorRef = useRef(null)
  const initialScrollRef = useRef(false)
  const isPaginatingRef = useRef(false)
  const previousScrollHeightRef = useRef(0)
  const [showScrollFab, setShowScrollFab] = useState(false)
  const [unreadSeparatorId, setUnreadSeparatorId] = useState(null)
  const [selectedMessages, setSelectedMessages] = useState(new Set())
  const [isSelectMode, setIsSelectMode] = useState(false)

  // Toggle selection for a message
  const toggleMessageSelection = (messageId) => {
    setSelectedMessages(prev => {
      const next = new Set(prev)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  // Delete all selected messages (for me only)
  const handleDeleteSelected = () => {
    if (window.confirm(`Delete ${selectedMessages.size} selected message(s) for you?`)) {
      deleteForMe([...selectedMessages])
      setSelectedMessages(new Set())
      setIsSelectMode(false)
    }
  }

  // Reset FAB and unread separator when switching conversations
  useEffect(() => {
    setShowScrollFab(false)
    setUnreadSeparatorId(null)
    setSelectedMessages(new Set())
    setIsSelectMode(false)
    initialScrollRef.current = false
    isPaginatingRef.current = false
  }, [activeConversation])

  // Restore scroll position after pagination (loading older messages)
  useLayoutEffect(() => {
    const container = messagesContainerRef.current
    if (isPaginatingRef.current && container) {
      // The new scroll height minus the old scroll height is the exact height of the newly added messages
      const heightDifference = container.scrollHeight - previousScrollHeightRef.current
      container.scrollTop += heightDifference
      isPaginatingRef.current = false
    }
  }, [messages])

  // Single source of truth for whether the "Scroll to latest" FAB should show:
  // true only when the user is meaningfully scrolled up from the bottom.
  // Used by both the scroll handler and the post-render sync effect below.
  const isScrolledUpFromBottom = () => {
    const container = messagesContainerRef.current
    if (!container) return false
    return container.scrollHeight - container.scrollTop - container.clientHeight > 100
  }

  // Keep the FAB in sync after layout-changing renders (new message, an image
  // finishing load, etc.). Without this the flag only updates on manual scroll,
  // so a layout shift could leave it stuck visible at the wrong time.
  // We don't override the intentional "unread separator" case, which sets the
  // FAB on purpose during the initial jump to the first unread message.
  useEffect(() => {
    if (messages.length === 0) {
      setShowScrollFab(false)
      return
    }
    setShowScrollFab(isScrolledUpFromBottom())
  }, [messages])

  // Handle scrolling and marking messages as read when messages change
  useEffect(() => {
    if (!activeConversation || !user || messages.length === 0) return
    if (isPaginatingRef.current) return // Don't auto-scroll to bottom during pagination

    const unreadMsgs = messages.filter(
      m => m.userId !== user.id && (!m.seenBy || !m.seenBy.some(u => u.id === user.id))
    )

    // If there are unread messages and we haven't set a separator yet (initial load)
    if (unreadMsgs.length > 0 && !unreadSeparatorId) {
      const firstUnreadId = unreadMsgs[0].id
      setUnreadSeparatorId(firstUnreadId)
      
      // Scroll to the unread separator instead of bottom
      setTimeout(() => {
        if (unreadSeparatorRef.current) {
          unreadSeparatorRef.current.scrollIntoView({ behavior: 'auto', block: 'center' })
          setShowScrollFab(true) 
          initialScrollRef.current = true
        }
      }, 100)
    } 
    // Otherwise, if we are at the bottom (showScrollFab is false) and there's no initial unread jump happening
    else if (!showScrollFab && messagesEndRef.current) {
      // Only scroll to bottom if we are not just initializing an unread jump
      if (unreadMsgs.length === 0 || unreadSeparatorId) {
        const behavior = initialScrollRef.current ? 'smooth' : 'auto'
        messagesEndRef.current.scrollIntoView({ behavior })
        initialScrollRef.current = true
      }
    }

    // Mark unread messages as read
    const unreadIds = unreadMsgs.map(m => m.id)
    if (unreadIds.length > 0) {
      markMessagesRead(activeConversation.id, unreadIds)
    }
  }, [messages, activeConversation, user, markMessagesRead, unreadSeparatorId, showScrollFab])

  /**
   * Get the "other" user in a 1-1 conversation.
   * Filters out the current user from the participants list.
   */
  const getOtherUser = (conversation) => {
    if (!conversation?.users) return null
    const otherParticipant = conversation.users.find(
      p => p.user.id !== user?.id
    )
    return otherParticipant?.user || null
  }

  /**
   * Get initials from a name for the avatar
   * "Alice Johnson" → "AJ", "Bob" → "B"
   */
  const getInitials = (name) => {
    if (!name) return '?'
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  /**
   * Check if two dates are on different days
   * Used to insert date separators between messages
   */
  const isDifferentDay = (date1, date2) => {
    const d1 = new Date(date1)
    const d2 = new Date(date2)
    return d1.toDateString() !== d2.toDateString()
  }

  /**
   * Format a date for the date separator
   * Today → "Today", Yesterday → "Yesterday", else → "Jan 15, 2025"
   */
  const formatDateSeparator = (dateString) => {
    const date = new Date(dateString)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === today.toDateString()) return 'Today'
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    })
  }

  // Handle scroll to top for loading more messages and FAB visibility
  const handleScroll = () => {
    const container = messagesContainerRef.current
    if (!container) return

    if (messages.length === 0) {
      setShowScrollFab(false)
      return
    }

    setShowScrollFab(isScrolledUpFromBottom())

    // Trigger pagination when scrolled to the very top
    if (container.scrollTop < 10 && hasMoreMessages && !loadingMessages && !isPaginatingRef.current) {
      isPaginatingRef.current = true
      previousScrollHeightRef.current = container.scrollHeight
      loadMoreMessages()
    }
  }

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
    setShowScrollFab(false)
  }

  // --- Empty State ---
  if (!activeConversation) {
    return (
      <div className="chat-area">
        {!isConnected && <div className="connection-banner">Disconnected. Trying to reconnect...</div>}
        <div className="chat-empty">
          <div className="chat-empty-icon animate-pulse-glow">💬</div>
          <h2>Welcome to SyncUp</h2>
          <p>Select a conversation from the sidebar or start a new chat to begin messaging.</p>
          <div style={{ marginTop: '24px', textAlign: 'left', background: 'var(--color-bg-secondary)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
            <h3 style={{ fontSize: '14px', marginBottom: '8px', color: 'var(--color-text-primary)' }}>✨ Features</h3>
            <ul style={{ fontSize: '13px', color: 'var(--color-text-secondary)', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <li>Real-time messaging with typing indicators</li>
              <li>Delivery status and read receipts</li>
              <li>End-to-end Kafka integration</li>
            </ul>
          </div>
        </div>
      </div>
    )
  }

  const otherUser = getOtherUser(activeConversation)

  // Whether the other participant is currently online. Used as a proxy for
  // "delivered" on the sender's ticks: if they're online, an unread message of
  // ours is assumed to have reached their device (grey ✓✓) rather than just sent (✓).
  const recipientOnline = otherUser ? onlineUsers.has(otherUser.id) : false

  return (
    <div className="chat-area">
      {!isConnected && <div className="connection-banner">Disconnected. Trying to reconnect...</div>}
      
      {/* Chat Header */}
      <div className="chat-header">
        <div className="chat-header-left">
          <button className="mobile-back-btn" onClick={() => setActiveConversation(null)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          </button>
          <div className="avatar">
            {getInitials(otherUser?.name)}
            <span className={`avatar-status ${otherUser && onlineUsers.has(otherUser.id) ? 'online' : ''}`}></span>
          </div>
        </div>
        <div className="chat-header-info" style={{ flex: 1 }}>
          <h2>{otherUser?.name || 'Unknown User'}</h2>
          <p>{otherUser && onlineUsers.has(otherUser.id) ? 'Online' : 'Offline'}</p>
        </div>
        
        {/* Selection / Delete Actions */}
        <div className="chat-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {selectedMessages.size > 0 && (
            <>
              <span style={{ fontSize: '14px', color: 'var(--color-text-secondary)', marginRight: '8px' }}>
                {selectedMessages.size} selected
              </span>
              <button 
                className="icon-btn" 
                title="Delete Selected Messages"
                style={{ 
                  background: 'rgba(239, 68, 68, 0.1)', 
                  border: 'none', 
                  color: '#ef4444', 
                  cursor: 'pointer',
                  padding: '6px 12px',
                  borderRadius: '4px',
                  fontSize: '13px',
                  fontWeight: '500',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                onClick={handleDeleteSelected}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                Delete Selected
              </button>
              <button 
                onClick={() => {
                  setSelectedMessages(new Set())
                  setIsSelectMode(false)
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-tertiary)',
                  cursor: 'pointer',
                  fontSize: '13px'
                }}
              >
                Cancel
              </button>
              <div style={{ width: '1px', height: '24px', background: 'var(--color-border)', margin: '0 8px' }}></div>
            </>
          )}

          <button 
            className="icon-btn" 
            title={isSelectMode ? "Select Mode Active" : "Select Messages"}
            style={{ 
              background: isSelectMode ? 'rgba(255,255,255,0.1)' : 'transparent', 
              border: 'none', 
              color: isSelectMode ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)', 
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '50%'
            }}
            onClick={() => {
              if (isSelectMode) {
                setIsSelectMode(false);
                setSelectedMessages(new Set());
              } else {
                setIsSelectMode(true);
              }
            }}
          >
            {/* Using a check-square icon for selecting */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
          </button>

          <button 
            className="icon-btn" 
            title="Delete Chat History"
            style={{ 
              background: 'transparent', 
              border: 'none', 
              color: 'var(--color-text-tertiary)', 
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '50%'
            }}
            onClick={() => {
              if (window.confirm("Delete the ENTIRE conversation history? This cannot be undone.")) {
                clearChatHistory(activeConversation.id)
              }
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.color = '#ef4444'
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.color = 'var(--color-text-tertiary)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div 
        className="chat-messages" 
        ref={messagesContainerRef}
        onScroll={handleScroll}
      >
        {/* Load more indicator */}
        {loadingMessages && messages.length > 0 && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div className="loading-spinner"></div>
          </div>
        )}

        {/* Loading state for initial fetch */}
        {loadingMessages && messages.length === 0 && (
          <div style={{ 
            flex: 1, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center' 
          }}>
            <div className="loading-spinner lg"></div>
          </div>
        )}

        {/* No messages yet */}
        {!loadingMessages && messages.length === 0 && (
          <div style={{ 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column',
            alignItems: 'center', 
            justifyContent: 'center',
            gap: '8px',
            color: 'var(--color-text-tertiary)'
          }}>
            <p style={{ fontSize: '14px' }}>No messages yet</p>
            <p style={{ fontSize: '12px' }}>Send the first message to start the conversation!</p>
          </div>
        )}

        {/* Message list with date separators and unread separator */}
        {messages.map((msg, index) => {
          const showDateSeparator = index === 0 || 
            isDifferentDay(messages[index - 1].createdAt, msg.createdAt)
          const showUnreadSeparator = msg.id === unreadSeparatorId
          const isMsgSelected = selectedMessages.has(msg.id)

          return (
            <div key={msg.id}>
              {showDateSeparator && (
                <div className="date-separator">
                  <span>{formatDateSeparator(msg.createdAt)}</span>
                </div>
              )}
              {showUnreadSeparator && (
                <div className="unread-separator" ref={unreadSeparatorRef}>
                  <span>Unread messages</span>
                </div>
              )}
              <div 
                className={`message-select-row ${isSelectMode ? 'selecting' : ''} ${isMsgSelected ? 'selected' : ''}`}
                onClick={() => isSelectMode && !msg.isDeleted && toggleMessageSelection(msg.id)}
              >
                {isSelectMode && !msg.isDeleted && (
                  <div className="message-checkbox">
                    <input type="checkbox" checked={isMsgSelected} readOnly />
                  </div>
                )}
                <MessageBubble
                  message={msg}
                  isSent={msg.userId === user?.id}
                  isLastMessage={index === messages.length - 1}
                  recipientOnline={recipientOnline}
                />
              </div>
            </div>
          )
        })}

        {/* Typing Indicator */}
        {typingUsers[activeConversation.id] && (
          <div className="typing-indicator-wrapper">
            <span>{typingUsers[activeConversation.id].userName} is typing</span>
            <div className="typing-dots">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>

      {showScrollFab && messages.length > 0 && (
        <button className="scroll-fab animate-scale-in" onClick={scrollToBottom}>
          ↓ Scroll to latest
        </button>
      )}

      {/* Message Input */}
      <MessageInput onSend={sendMessage} onTyping={sendTyping} onUploadImage={uploadImage} />
    </div>
  )
}

export default ChatArea

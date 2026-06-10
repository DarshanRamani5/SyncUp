import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useChat } from '../context/ChatContext.jsx'
import api from '../lib/api.js'

/**
 * Sidebar
 * 
 * Left panel of the chat layout. Shows:
 * - App logo + logout button
 * - Search bar to filter conversations
 * - List of conversations with last message preview
 * - "New Chat" button that opens a user list modal
 * 
 * Features:
 * - Filter conversations by participant name
 * - Active conversation highlighting
 * - User list modal to start new conversations
 * - Time formatting (just now, 5m, 2h, Jan 15)
 */
const Sidebar = () => {
  const { user, logout } = useAuth()
  const { 
    conversations, 
    activeConversation, 
    fetchConversations, 
    selectConversation,
    createConversation,
    onlineUsers,
    loadingConversations,
    unreadCounts
  } = useChat()

  const [searchQuery, setSearchQuery] = useState('')
  const [showUserList, setShowUserList] = useState(false)
  const [allUsers, setAllUsers] = useState([])
  const [loadingUsers, setLoadingUsers] = useState(false)

  // Fetch conversations on mount
  useEffect(() => {
    fetchConversations()
  }, [fetchConversations])

  /**
   * Get the "other" user in a 1-1 conversation
   */
  const getOtherUser = (conversation) => {
    if (!conversation?.users) return null
    const otherParticipant = conversation.users.find(
      p => p.user.id !== user?.id
    )
    return otherParticipant?.user || null
  }

  /**
   * Get initials from a name
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
   * Format relative time for conversation preview
   * - Under 1 min: "Just now"
   * - Under 1 hour: "5m"
   * - Under 24 hours: "2h"
   * - Under 7 days: "3d"
   * - Else: "Jan 15"
   */
  const formatRelativeTime = (dateString) => {
    if (!dateString) return ''
    const now = new Date()
    const date = new Date(dateString)
    const diffMs = now - date
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)

    if (diffMin < 1) return 'Just now'
    if (diffMin < 60) return `${diffMin}m`
    if (diffHour < 24) return `${diffHour}h`
    if (diffDay < 7) return `${diffDay}d`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  /**
   * Filter conversations by search query
   * Matches against the other participant's name
   */
  const filteredConversations = conversations.filter(conv => {
    if (!searchQuery.trim()) return true
    const otherUser = getOtherUser(conv)
    return otherUser?.name?.toLowerCase().includes(searchQuery.toLowerCase())
  })

  /**
   * Open the user list modal and fetch all users
   */
  const handleNewChat = async () => {
    setShowUserList(true)
    setLoadingUsers(true)
    try {
      const res = await api.get('/users')
      setAllUsers(res.data.users)
    } catch (error) {
      console.error('Failed to fetch users:', error)
    } finally {
      setLoadingUsers(false)
    }
  }

  /**
   * Start a conversation with a selected user
   */
  const handleSelectUser = async (targetUser) => {
    setShowUserList(false)
    try {
      await createConversation(targetUser.id)
    } catch (error) {
      console.error('Failed to create conversation:', error)
    }
  }

  return (
    <>
      <div className="sidebar" id="sidebar">
        {/* Header */}
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">S</div>
            <span className="sidebar-logo-text">SyncUp</span>
          </div>
          <button 
            className="sidebar-logout-btn" 
            onClick={logout}
            id="logout-btn"
            title="Logout"
          >
            Logout
          </button>
        </div>

        {/* Search */}
        <div className="sidebar-search">
          <div className="search-input-wrapper">
            <span className="search-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </span>
            <input
              className="search-input"
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              id="search-conversations"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="conversation-list" id="conversation-list">
          {loadingConversations ? (
            <div style={{ 
              textAlign: 'center', 
              padding: '40px 20px',
              color: 'var(--color-text-tertiary)',
              fontSize: '13px'
            }}>
              Loading conversations...
            </div>
          ) : filteredConversations.length === 0 ? (
            <div style={{ 
              textAlign: 'center', 
              padding: '40px 20px',
              color: 'var(--color-text-tertiary)',
              fontSize: '13px'
            }}>
              {searchQuery ? 'No conversations found' : 'No conversations yet. Start a new chat!'}
            </div>
          ) : (
            filteredConversations.map((conv, idx) => {
            const otherUser = getOtherUser(conv)
            const lastMessage = conv.messages?.[0]
            const isActive = activeConversation?.id === conv.id
            const unreadCount = unreadCounts[conv.id] || 0

            return (
              <div
                key={conv.id}
                className={`conversation-item animate-slide-up ${isActive ? 'active' : ''}`}
                style={{ animationDelay: `${idx * 0.05}s` }}
                onClick={() => selectConversation(conv)}
                id={`conversation-${conv.id}`}
              >
                <div className="avatar">
                  {getInitials(otherUser?.name)}
                  <span className={`avatar-status ${otherUser && onlineUsers.has(otherUser.id) ? 'online' : ''}`}></span>
                </div>
                <div className="conversation-info">
                  <div className="conversation-name">
                    {otherUser?.name || 'Unknown'}
                  </div>
                  <div className={`conversation-preview ${unreadCount > 0 ? 'unread' : ''}`}>
                    {lastMessage 
                      ? `${lastMessage.createdBy?.id === user?.id ? 'You: ' : ''}${
                          lastMessage.isDeleted
                            ? 'This message was deleted'
                            : lastMessage.body || (lastMessage.image ? '📷 Photo' : '')
                        }`
                      : 'No messages yet'
                    }
                  </div>
                </div>
                <div className="conversation-meta">
                  <div className={`conversation-time ${unreadCount > 0 ? 'unread' : ''}`}>
                    {lastMessage 
                      ? formatRelativeTime(lastMessage.createdAt)
                      : formatRelativeTime(conv.createdAt)
                    }
                  </div>
                  {unreadCount > 0 && (
                    <div className="unread-badge animate-scale-in">
                      {unreadCount}
                    </div>
                  )}
                </div>
              </div>
            )
          }))}
        </div>

        {/* New Chat Button */}
        <div className="new-chat-section">
          <button 
            className="new-chat-btn" 
            onClick={handleNewChat}
            id="new-chat-btn"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            New Chat
          </button>
        </div>
      </div>

      {/* User List Modal */}
      {showUserList && (
        <div 
          className="user-list-overlay" 
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowUserList(false)
          }}
        >
          <div className="user-list-modal" id="user-list-modal">
            <div className="user-list-modal-header">
              <h3>Start a new chat</h3>
              <button 
                className="user-list-modal-close"
                onClick={() => setShowUserList(false)}
              >
                ✕
              </button>
            </div>
            <div className="user-list-items">
              {loadingUsers && (
                <div style={{ textAlign: 'center', padding: '24px' }}>
                  <div className="loading-spinner"></div>
                </div>
              )}
              {!loadingUsers && allUsers.length === 0 && (
                <div style={{ 
                  textAlign: 'center', 
                  padding: '24px',
                  color: 'var(--color-text-tertiary)',
                  fontSize: '13px'
                }}>
                  No users found
                </div>
              )}
              {!loadingUsers && allUsers.map(u => (
                <div
                  key={u.id}
                  className="user-list-item"
                  onClick={() => handleSelectUser(u)}
                  id={`user-${u.id}`}
                >
                  <div className="avatar sm">
                    {getInitials(u.name)}
                  </div>
                  <div>
                    <div className="user-list-item-name">{u.name}</div>
                    <div className="user-list-item-email">{u.email}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default Sidebar

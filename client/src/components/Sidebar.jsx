import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useChat } from '../context/ChatContext.jsx'
import NewGroupModal from './NewGroupModal.jsx'
import api from '../lib/api.js'

/**
 * Sidebar
 *
 * Left panel of the chat layout. Shows:
 * - App logo + Friends / Logout buttons
 * - Search bar to filter conversations (matches names AND group names)
 * - Conversation list — 1-1 chats and GROUPS
 * - "New Chat" (friends only) and "New Group" buttons
 *
 * Group-aware display:
 * - Group rows show the group name and a 👥-style initials avatar
 * - Group previews are prefixed with the sender's name ("Alice: hi all")
 * - Online dot only shown for 1-1 chats (presence is per-user)
 */
const Sidebar = () => {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
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
  const [showNewGroup, setShowNewGroup] = useState(false)
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
   * Display name for any conversation: group name, or the other user's name
   */
  const getConversationName = (conversation) => {
    if (conversation.isGroup) return conversation.name || 'Group'
    return getOtherUser(conversation)?.name || 'Unknown'
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
   * Filter conversations by search query — matches the other participant's
   * name for 1-1 chats and the group name for groups.
   */
  const filteredConversations = conversations.filter(conv => {
    if (!searchQuery.trim()) return true
    return getConversationName(conv).toLowerCase().includes(searchQuery.toLowerCase())
  })

  /**
   * Open the new chat modal — FRIENDS ONLY (WhatsApp style)
   */
  const handleNewChat = async () => {
    setShowUserList(true)
    setLoadingUsers(true)
    try {
      const res = await api.get('/friends')
      setAllUsers(res.data.friends)
    } catch (error) {
      console.error('Failed to fetch friends:', error)
    } finally {
      setLoadingUsers(false)
    }
  }

  /**
   * Start a conversation with a selected friend
   */
  const handleSelectUser = async (targetUser) => {
    setShowUserList(false)
    try {
      await createConversation(targetUser.id)
    } catch (error) {
      console.error('Failed to create conversation:', error)
    }
  }

  /**
   * Build the last-message preview line.
   * Groups prefix the sender's first name; your own messages show "You:".
   */
  const getPreview = (conv) => {
    const lastMessage = conv.messages?.[0]
    if (!lastMessage) return 'No messages yet'

    const content = lastMessage.isDeleted
      ? 'This message was deleted'
      : lastMessage.body || (lastMessage.image ? '📷 Photo' : '')

    if (lastMessage.createdBy?.id === user?.id) return `You: ${content}`
    if (conv.isGroup) {
      const firstName = (lastMessage.createdBy?.name || '').split(' ')[0]
      return firstName ? `${firstName}: ${content}` : content
    }
    return content
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
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="sidebar-logout-btn"
              onClick={() => navigate('/friends')}
              id="friends-btn"
              title="Friends"
            >
              Friends
            </button>
            <button
              className="sidebar-logout-btn"
              onClick={logout}
              id="logout-btn"
              title="Logout"
            >
              Logout
            </button>
          </div>
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
              const isGroup = !!conv.isGroup
              const otherUser = isGroup ? null : getOtherUser(conv)
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
                  <div className={`avatar ${isGroup ? 'group-avatar' : ''}`}>
                    {getInitials(getConversationName(conv))}
                    {/* Online dot only makes sense for 1-1 chats */}
                    {!isGroup && (
                      <span className={`avatar-status ${otherUser && onlineUsers.has(otherUser.id) ? 'online' : ''}`}></span>
                    )}
                  </div>
                  <div className="conversation-info">
                    <div className="conversation-name">
                      {getConversationName(conv)}
                      {isGroup && (
                        <span className="group-tag">Group</span>
                      )}
                    </div>
                    <div className={`conversation-preview ${unreadCount > 0 ? 'unread' : ''}`}>
                      {getPreview(conv)}
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
            })
          )}
        </div>

        {/* New Chat / New Group Buttons */}
        <div className="new-chat-section">
          <div style={{ display: 'flex', gap: '8px' }}>
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
            <button
              className="new-chat-btn group"
              onClick={() => setShowNewGroup(true)}
              id="new-group-btn"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              New Group
            </button>
          </div>
        </div>
      </div>

      {/* New Chat Modal — shows ONLY the user's friends */}
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
                <div className="new-chat-empty">
                  <p>You can only chat with people on your friends list.</p>
                  <p>Find people by their @username and send them a friend request.</p>
                  <button
                    className="friends-btn primary"
                    onClick={() => {
                      setShowUserList(false)
                      navigate('/friends')
                    }}
                    id="go-add-friend-btn"
                  >
                    Add a Friend
                  </button>
                </div>
              )}

              {!loadingUsers && allUsers.map(u => (
                <div
                  key={u.id}
                  className="user-list-item"
                  onClick={() => handleSelectUser(u)}
                  id={`user-${u.id}`}
                >
                  <div
                    className="avatar sm"
                    style={u.color ? { background: u.color } : undefined}
                  >
                    {getInitials(u.name)}
                  </div>
                  <div>
                    <div className="user-list-item-name">{u.name}</div>
                    <div className="user-list-item-email">@{u.username}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* New Group Modal */}
      {showNewGroup && (
        <NewGroupModal onClose={() => setShowNewGroup(false)} />
      )}
    </>
  )
}

export default Sidebar
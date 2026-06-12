import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChat } from '../context/ChatContext.jsx'
import api from '../lib/api.js'
import { getSocket } from '../lib/socket.js'

/**
 * FriendsPage
 *
 * The social hub of the app, with three tabs:
 * - Add Friend:  search users by @username, send requests
 * - Requests:    incoming (accept/decline) + outgoing (cancel)
 * - My Friends:  list, message a friend, or unfriend
 *
 * This page is the ONLY place strangers can find each other (by username).
 * The "Start a new chat" modal (Task 3) only shows people from this list.
 */
const FriendsPage = () => {
  const navigate = useNavigate()
  const { createConversation } = useChat()

  const [activeTab, setActiveTab] = useState('add')

  // Data
  const [friends, setFriends] = useState([])
  const [incoming, setIncoming] = useState([])
  const [outgoing, setOutgoing] = useState([])

  // Add Friend tab
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)

  // Feedback banner: { type: 'success' | 'error', text }
  const [feedback, setFeedback] = useState(null)

  const showFeedback = (type, text) => {
    setFeedback({ type, text })
    setTimeout(() => setFeedback(null), 4000)
  }

  /**
   * Load friends + requests (called on mount and after every action,
   * so button states like "Requested" / "Friends" stay accurate)
   */
  const loadData = useCallback(async () => {
    try {
      const [friendsRes, requestsRes] = await Promise.all([
        api.get('/friends'),
        api.get('/friends/requests')
      ])
      setFriends(friendsRes.data.friends)
      setIncoming(requestsRes.data.incoming)
      setOutgoing(requestsRes.data.outgoing)
    } catch (error) {
      console.error('Failed to load friends data:', error)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Live refresh: when a request arrives / is handled elsewhere,
  // reload tabs so Requests and Friends stay current without refreshing.
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    socket.on('friend-request-received', loadData)
    socket.on('friend-requests-updated', loadData)
    return () => {
      socket.off('friend-request-received', loadData)
      socket.off('friend-requests-updated', loadData)
    }
  }, [loadData])

  /**
   * Debounced username search — waits 300ms after the last keystroke
   * so we don't hit the API on every single character.
   */
  useEffect(() => {
    const q = query.trim().replace(/^@+/, '')
    if (q.length < 2) {
      setResults([])
      return
    }

    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await api.get('/users/search', { params: { q } })
        setResults(res.data.users)
      } catch (error) {
        console.error('Search failed:', error)
      } finally {
        setSearching(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query])

  /**
   * Work out the relationship between me and a search result,
   * so the button can say the right thing.
   */
  const getRelationship = (userId) => {
    if (friends.some(f => f.id === userId)) return 'friend'
    if (outgoing.some(r => r.receiverId === userId)) return 'requested'
    if (incoming.some(r => r.senderId === userId)) return 'incoming'
    return 'none'
  }

  // --- Actions ---

  const handleSendRequest = async (user) => {
    try {
      const res = await api.post('/friends/requests', { receiverId: user.id })
      showFeedback('success', res.data.message)
      loadData()
    } catch (error) {
      showFeedback('error', error.response?.data?.message || 'Failed to send request')
    }
  }

  const handleRespond = async (requestId, action) => {
    try {
      const res = await api.put(`/friends/requests/${requestId}`, { action })
      showFeedback('success', res.data.message)
      loadData()
    } catch (error) {
      showFeedback('error', error.response?.data?.message || 'Action failed')
    }
  }

  const handleCancel = async (requestId) => {
    try {
      await api.delete(`/friends/requests/${requestId}`)
      showFeedback('success', 'Request cancelled')
      loadData()
    } catch (error) {
      showFeedback('error', error.response?.data?.message || 'Failed to cancel')
    }
  }

  const handleUnfriend = async (friend) => {
    if (!window.confirm(`Remove @${friend.username} from your friends?`)) return
    try {
      await api.delete(`/friends/${friend.id}`)
      showFeedback('success', `Removed @${friend.username}`)
      loadData()
    } catch (error) {
      showFeedback('error', error.response?.data?.message || 'Failed to remove friend')
    }
  }

  const handleMessage = async (friend) => {
    try {
      await createConversation(friend.id)
      navigate('/chat')
    } catch (error) {
      showFeedback('error', 'Failed to open conversation')
    }
  }

  const getInitials = (name) => {
    if (!name) return '?'
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  }

  const Avatar = ({ user }) => (
    <div className="avatar sm" style={user.color ? { background: user.color } : undefined}>
      {getInitials(user.name)}
    </div>
  )

  return (
    <div className="friends-page" id="friends-page">
      <div className="friends-card">
        {/* Header */}
        <div className="friends-header">
          <button className="friends-back-btn" onClick={() => navigate('/chat')} id="friends-back-btn">
            ← Back to chats
          </button>
          <h1>Friends</h1>
        </div>

        {/* Feedback banner */}
        {feedback && (
          <div className={`friends-feedback ${feedback.type}`} id="friends-feedback">
            {feedback.text}
          </div>
        )}

        {/* Tabs */}
        <div className="friends-tabs">
          <button
            className={`friends-tab ${activeTab === 'add' ? 'active' : ''}`}
            onClick={() => setActiveTab('add')}
            id="tab-add-friend"
          >
            Add Friend
          </button>
          <button
            className={`friends-tab ${activeTab === 'requests' ? 'active' : ''}`}
            onClick={() => setActiveTab('requests')}
            id="tab-requests"
          >
            Requests
            {incoming.length > 0 && <span className="friends-tab-badge">{incoming.length}</span>}
          </button>
          <button
            className={`friends-tab ${activeTab === 'friends' ? 'active' : ''}`}
            onClick={() => setActiveTab('friends')}
            id="tab-my-friends"
          >
            My Friends{friends.length > 0 ? ` (${friends.length})` : ''}
          </button>
        </div>

        {/* ---- TAB: Add Friend ---- */}
        {activeTab === 'add' && (
          <div className="friends-tab-content">
            <div className="friends-search-wrapper">
              <span className="username-at">@</span>
              <input
                className="form-input username-input"
                type="text"
                placeholder="Search by username, e.g. harsh_dev"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                id="friend-search-input"
              />
            </div>

            <div className="friends-list">
              {searching && <div className="friends-empty">Searching…</div>}

              {!searching && query.trim().length >= 2 && results.length === 0 && (
                <div className="friends-empty">No users found for "@{query.trim().replace(/^@+/, '')}"</div>
              )}

              {!searching && query.trim().length < 2 && (
                <div className="friends-empty">
                  Type at least 2 characters to search for people by their @username.
                </div>
              )}

              {!searching && results.map(u => {
                const rel = getRelationship(u.id)
                return (
                  <div className="friends-list-item" key={u.id}>
                    <Avatar user={u} />
                    <div className="friends-list-info">
                      <div className="friends-list-name">{u.name}</div>
                      <div className="friends-list-username">@{u.username}</div>
                    </div>
                    {rel === 'none' && (
                      <button className="friends-btn primary" onClick={() => handleSendRequest(u)}>
                        Add Friend
                      </button>
                    )}
                    {rel === 'requested' && (
                      <button className="friends-btn" disabled>Requested</button>
                    )}
                    {rel === 'friend' && (
                      <button className="friends-btn" disabled>Friends ✓</button>
                    )}
                    {rel === 'incoming' && (
                      <button
                        className="friends-btn primary"
                        onClick={() => {
                          const reqItem = incoming.find(r => r.senderId === u.id)
                          if (reqItem) handleRespond(reqItem.id, 'accept')
                        }}
                      >
                        Accept Request
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ---- TAB: Requests ---- */}
        {activeTab === 'requests' && (
          <div className="friends-tab-content">
            <h3 className="friends-section-title">Incoming</h3>
            <div className="friends-list">
              {incoming.length === 0 && (
                <div className="friends-empty">No incoming requests right now.</div>
              )}
              {incoming.map(r => (
                <div className="friends-list-item" key={r.id}>
                  <Avatar user={r.sender} />
                  <div className="friends-list-info">
                    <div className="friends-list-name">{r.sender.name}</div>
                    <div className="friends-list-username">@{r.sender.username}</div>
                  </div>
                  <button className="friends-btn primary" onClick={() => handleRespond(r.id, 'accept')}>
                    Accept
                  </button>
                  <button className="friends-btn danger" onClick={() => handleRespond(r.id, 'decline')}>
                    Decline
                  </button>
                </div>
              ))}
            </div>

            <h3 className="friends-section-title">Sent by you</h3>
            <div className="friends-list">
              {outgoing.length === 0 && (
                <div className="friends-empty">You haven't sent any pending requests.</div>
              )}
              {outgoing.map(r => (
                <div className="friends-list-item" key={r.id}>
                  <Avatar user={r.receiver} />
                  <div className="friends-list-info">
                    <div className="friends-list-name">{r.receiver.name}</div>
                    <div className="friends-list-username">@{r.receiver.username}</div>
                  </div>
                  <button className="friends-btn" onClick={() => handleCancel(r.id)}>
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---- TAB: My Friends ---- */}
        {activeTab === 'friends' && (
          <div className="friends-tab-content">
            <div className="friends-list">
              {friends.length === 0 && (
                <div className="friends-empty">
                  No friends yet — use the Add Friend tab to find people by @username.
                </div>
              )}
              {friends.map(f => (
                <div className="friends-list-item" key={f.id}>
                  <Avatar user={f} />
                  <div className="friends-list-info">
                    <div className="friends-list-name">{f.name}</div>
                    <div className="friends-list-username">@{f.username}</div>
                  </div>
                  <button className="friends-btn primary" onClick={() => handleMessage(f)}>
                    Message
                  </button>
                  <button className="friends-btn danger" onClick={() => handleUnfriend(f)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default FriendsPage
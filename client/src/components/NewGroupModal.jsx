import { useState, useEffect } from 'react'
import { useChat } from '../context/ChatContext.jsx'
import api from '../lib/api.js'

/**
 * NewGroupModal
 *
 * Create a group chat: pick a name + select 2 or more friends.
 * Only friends can be added (server enforces this too).
 *
 * Props:
 * - onClose: () => void
 */
const NewGroupModal = ({ onClose }) => {
  const { fetchConversations, selectConversation } = useChat()

  const [name, setName] = useState('')
  const [friends, setFriends] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const loadFriends = async () => {
      try {
        const res = await api.get('/friends')
        setFriends(res.data.friends)
      } catch (err) {
        console.error('Failed to load friends:', err)
      } finally {
        setLoading(false)
      }
    }
    loadFriends()
  }, [])

  const toggleFriend = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const getInitials = (n) => {
    if (!n) return '?'
    return n.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  }

  const handleCreate = async () => {
    setError('')
    if (!name.trim()) {
      setError('Give your group a name')
      return
    }
    if (selected.size < 2) {
      setError('Select at least 2 friends — a group needs 3+ people')
      return
    }

    setCreating(true)
    try {
      const res = await api.post('/conversations/group', {
        name: name.trim(),
        memberIds: [...selected]
      })
      await fetchConversations()
      await selectConversation(res.data.conversation)
      onClose()
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create group')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="user-list-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="user-list-modal" id="new-group-modal">
        <div className="user-list-modal-header">
          <h3>Create a group</h3>
          <button className="user-list-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="group-modal-body">
          {error && <div className="friends-feedback error">{error}</div>}

          <input
            className="form-input"
            type="text"
            placeholder="Group name, e.g. Weekend Trip"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            autoFocus
            id="group-name-input"
          />

          <div className="group-modal-label">
            Select friends ({selected.size} selected)
          </div>

          <div className="user-list-items group-friend-list">
            {loading && (
              <div style={{ textAlign: 'center', padding: '24px' }}>
                <div className="loading-spinner"></div>
              </div>
            )}
            {!loading && friends.length < 2 && (
              <div className="friends-empty">
                You need at least 2 friends to create a group.
              </div>
            )}
            {!loading && friends.map(f => (
              <div
                key={f.id}
                className={`user-list-item ${selected.has(f.id) ? 'selected' : ''}`}
                onClick={() => toggleFriend(f.id)}
              >
                <input
                  type="checkbox"
                  checked={selected.has(f.id)}
                  readOnly
                  className="group-member-checkbox"
                />
                <div className="avatar sm" style={f.color ? { background: f.color } : undefined}>
                  {getInitials(f.name)}
                </div>
                <div>
                  <div className="user-list-item-name">{f.name}</div>
                  <div className="user-list-item-email">@{f.username}</div>
                </div>
              </div>
            ))}
          </div>

          <button
            className="new-chat-btn"
            onClick={handleCreate}
            disabled={creating}
            id="create-group-btn"
          >
            {creating ? 'Creating…' : 'Create Group'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default NewGroupModal
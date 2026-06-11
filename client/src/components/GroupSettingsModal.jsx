import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useChat } from '../context/ChatContext.jsx'
import api from '../lib/api.js'

/**
 * GroupSettingsModal
 *
 * Group info panel:
 * - Member list with admin badges
 * - Admin: rename group, add members (from friends), remove members
 * - Anyone: leave group
 *
 * Props:
 * - conversation: the active group conversation object
 * - onClose: () => void
 */
const GroupSettingsModal = ({ conversation, onClose }) => {
  const { user } = useAuth()
  const { fetchConversations, setActiveConversation, selectConversation } = useChat()

  // Local copy — updated from API responses so the panel stays fresh
  const [conv, setConv] = useState(conversation)
  const [name, setName] = useState(conversation.name || '')
  const [friends, setFriends] = useState([])
  const [showAddSection, setShowAddSection] = useState(false)
  const [selectedToAdd, setSelectedToAdd] = useState(new Set())
  const [feedback, setFeedback] = useState(null)
  const [busy, setBusy] = useState(false)

  const myMembership = conv.users?.find(u => u.userId === user?.id || u.user?.id === user?.id)
  const isAdmin = !!myMembership?.isAdmin

  const showMsg = (type, text) => {
    setFeedback({ type, text })
    setTimeout(() => setFeedback(null), 3500)
  }

  // Load friends (for the add-members section)
  useEffect(() => {
    api.get('/friends')
      .then(res => setFriends(res.data.friends))
      .catch(err => console.error('Failed to load friends:', err))
  }, [])

  const getInitials = (n) => {
    if (!n) return '?'
    return n.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  }

  /** Apply an updated conversation from an API response everywhere */
  const applyUpdated = async (updatedConversation) => {
    setConv(updatedConversation)
    await fetchConversations()
    await selectConversation(updatedConversation)
  }

  // --- Actions ---

  const handleRename = async () => {
    if (!name.trim() || name.trim() === conv.name) return
    setBusy(true)
    try {
      const res = await api.put(`/conversations/${conv.id}/group`, { name: name.trim() })
      await applyUpdated(res.data.conversation)
      showMsg('success', 'Group renamed')
    } catch (err) {
      showMsg('error', err.response?.data?.message || 'Rename failed')
    } finally {
      setBusy(false)
    }
  }

  const handleAddMembers = async () => {
    if (selectedToAdd.size === 0) return
    setBusy(true)
    try {
      const res = await api.post(`/conversations/${conv.id}/members`, {
        memberIds: [...selectedToAdd]
      })
      await applyUpdated(res.data.conversation)
      setSelectedToAdd(new Set())
      setShowAddSection(false)
      showMsg('success', res.data.message)
    } catch (err) {
      showMsg('error', err.response?.data?.message || 'Failed to add members')
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (member) => {
    if (!window.confirm(`Remove ${member.user.name} from the group?`)) return
    setBusy(true)
    try {
      const res = await api.delete(`/conversations/${conv.id}/members/${member.userId}`)
      await applyUpdated(res.data.conversation)
      showMsg('success', 'Member removed')
    } catch (err) {
      showMsg('error', err.response?.data?.message || 'Failed to remove member')
    } finally {
      setBusy(false)
    }
  }

  const handleLeave = async () => {
    if (!window.confirm('Leave this group?')) return
    setBusy(true)
    try {
      await api.post(`/conversations/${conv.id}/leave`)
      setActiveConversation(null)
      await fetchConversations()
      onClose()
    } catch (err) {
      showMsg('error', err.response?.data?.message || 'Failed to leave group')
      setBusy(false)
    }
  }

  // Friends who are NOT already in the group
  const memberIds = new Set(conv.users?.map(u => u.userId || u.user?.id))
  const addableFriends = friends.filter(f => !memberIds.has(f.id))

  return (
    <div
      className="user-list-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="user-list-modal" id="group-settings-modal">
        <div className="user-list-modal-header">
          <h3>Group settings</h3>
          <button className="user-list-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="group-modal-body">
          {feedback && (
            <div className={`friends-feedback ${feedback.type}`}>{feedback.text}</div>
          )}

          {/* Group name (editable only for admins) */}
          <div className="group-modal-label">Group name</div>
          {isAdmin ? (
            <div className="group-rename-row">
              <input
                className="form-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                id="group-rename-input"
              />
              <button
                className="friends-btn primary"
                onClick={handleRename}
                disabled={busy || !name.trim() || name.trim() === conv.name}
              >
                Save
              </button>
            </div>
          ) : (
            <div className="group-name-readonly">{conv.name}</div>
          )}

          {/* Members */}
          <div className="group-modal-label">
            Members ({conv.users?.length || 0})
          </div>
          <div className="user-list-items group-friend-list">
            {conv.users?.map(member => {
              const isSelf = member.userId === user?.id || member.user?.id === user?.id
              return (
                <div key={member.userId || member.user?.id} className="user-list-item group-member-row">
                  <div
                    className="avatar sm"
                    style={member.user?.color ? { background: member.user.color } : undefined}
                  >
                    {getInitials(member.user?.name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="user-list-item-name">
                      {member.user?.name}{isSelf ? ' (you)' : ''}
                      {member.isAdmin && <span className="admin-badge">Admin</span>}
                    </div>
                    <div className="user-list-item-email">@{member.user?.username}</div>
                  </div>
                  {isAdmin && !isSelf && (
                    <button
                      className="friends-btn danger"
                      onClick={() => handleRemove(member)}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Add members (admin only) */}
          {isAdmin && (
            <>
              {!showAddSection ? (
                <button
                  className="friends-btn"
                  style={{ width: '100%' }}
                  onClick={() => setShowAddSection(true)}
                  disabled={addableFriends.length === 0}
                  id="show-add-members-btn"
                >
                  {addableFriends.length === 0
                    ? 'All your friends are already in this group'
                    : '+ Add members'}
                </button>
              ) : (
                <>
                  <div className="group-modal-label">
                    Add from friends ({selectedToAdd.size} selected)
                  </div>
                  <div className="user-list-items group-friend-list">
                    {addableFriends.map(f => (
                      <div
                        key={f.id}
                        className="user-list-item"
                        onClick={() => {
                          setSelectedToAdd(prev => {
                            const next = new Set(prev)
                            if (next.has(f.id)) next.delete(f.id)
                            else next.add(f.id)
                            return next
                          })
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedToAdd.has(f.id)}
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
                    className="friends-btn primary"
                    style={{ width: '100%' }}
                    onClick={handleAddMembers}
                    disabled={busy || selectedToAdd.size === 0}
                    id="confirm-add-members-btn"
                  >
                    Add selected
                  </button>
                </>
              )}
            </>
          )}

          {/* Leave */}
          <button
            className="friends-btn danger"
            style={{ width: '100%', marginTop: '8px' }}
            onClick={handleLeave}
            disabled={busy}
            id="leave-group-btn"
          >
            Leave group
          </button>
        </div>
      </div>
    </div>
  )
}

export default GroupSettingsModal
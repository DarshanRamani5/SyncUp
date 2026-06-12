import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import api from '../lib/api.js'
import { getSocket } from '../lib/socket.js'
import { useAuth } from './AuthContext.jsx'

/**
 * Chat Context
 * 
 * Manages the chat state for the entire app:
 * - conversations: array of all conversations for the current user
 * - activeConversation: the currently selected conversation object
 * - messages: array of messages for the active conversation
 * - onlineUsers: set of user IDs currently online
 * - loading states for conversations and messages
 * 
 * REAL-TIME FLOW (Socket.IO):
 * 
 * Sending:
 *   User types message → sendMessage() → socket.emit('send-message') 
 *   → server persists + broadcasts → we receive via 'receive-message'
 * 
 * Receiving:
 *   Socket listens for 'receive-message' → addMessage to state
 *   Socket listens for 'conversation-updated' → update sidebar preview
 *   Socket listens for 'user-online' / 'user-offline' → update presence
 *   Socket listens for 'user-typing' → show typing indicator
 */

const ChatContext = createContext(null)

/**
 * Custom hook to access chat context.
 * Usage: const { conversations, activeConversation, sendMessage } = useChat()
 */
export const useChat = () => {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider')
  }
  return context
}

export const ChatProvider = ({ children }) => {
  const { user } = useAuth()
  const [conversations, setConversations] = useState([])
  const [activeConversation, setActiveConversation] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [onlineUsers, setOnlineUsers] = useState(new Set())
  const [typingUsers, setTypingUsers] = useState({}) // { conversationId: { userId, userName } }
  const [isConnected, setIsConnected] = useState(true)
  const [unreadCounts, setUnreadCounts] = useState({}) // { conversationId: count }
  const [firstUnreadIds, setFirstUnreadIds] = useState({}) // { conversationId: messageId }

  // Play notification sound
  const playNotificationSound = useCallback(() => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      const oscillator = audioCtx.createOscillator()
      const gainNode = audioCtx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime) // D5
      oscillator.frequency.exponentialRampToValueAtTime(880.00, audioCtx.currentTime + 0.1) // A5
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime)
      gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05)
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5)
      oscillator.connect(gainNode)
      gainNode.connect(audioCtx.destination)
      oscillator.start(audioCtx.currentTime)
      oscillator.stop(audioCtx.currentTime + 0.5)
    } catch (e) {
      console.error('Audio play failed', e)
    }
  }, [])

  // Ref to track the active conversation ID for socket event handlers
  // (closures in event handlers would capture stale state otherwise)
  const activeConversationRef = useRef(null)
  const messagesRef = useRef([])
  const loadingRef = useRef(false)

  // Keep the refs in sync with state
  useEffect(() => {
    activeConversationRef.current = activeConversation
  }, [activeConversation])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    loadingRef.current = loadingMessages
  }, [loadingMessages])

  /**
   * Set up Socket.IO event listeners for real-time updates.
   * Called once when the component mounts (if socket is connected).
   * Re-called when socket reconnects.
   */
  useEffect(() => {
    if (!user) return // Wait until user is authenticated
    const socket = getSocket()
    if (!socket) return

    const handleConnect = () => setIsConnected(true)
    const handleDisconnect = () => setIsConnected(false)

    // --- Receive a new message in real-time ---
    const handleReceiveMessage = (message) => {
      const currentConv = activeConversationRef.current

      // If this message belongs to the active conversation, add it to the message list
      if (currentConv && message.conversationId === currentConv.id) {
        setMessages(prev => {
          // Avoid duplicates (in case we get both socket + REST response)
          if (prev.some(m => m.id === message.id)) return prev
          return [...prev, message]
        })

        // Play sound if not from us
        if (message.userId !== user?.id) {
          playNotificationSound()
        }
      } else {
        // Not in this conversation's room — we won't get this event.
        // Unread counting happens in handleConversationUpdated instead
        // (which broadcasts to ALL connected clients via io.emit)
        if (message.userId !== user?.id) {
          playNotificationSound()
        }
      }

      // Update the conversation sidebar preview regardless
      setConversations(prev =>
        prev.map(conv => {
          if (conv.id === message.conversationId) {
            return {
              ...conv,
              messages: [message],
              lastMessageAt: new Date().toISOString()
            }
          }
          return conv
        }).sort((a, b) => new Date(b.lastMessageAt || b.createdAt) - new Date(a.lastMessageAt || a.createdAt))
      )
    }

    // --- Messages Read ---
    const handleMessagesRead = ({ messageIds, userId: readerId }) => {
      setMessages(prev => prev.map(m => {
        if (messageIds.includes(m.id)) {
          if (m.seenBy?.some(u => u.id === readerId)) return m
          return { ...m, seenBy: [...(m.seenBy || []), { id: readerId }] }
        }
        return m
      }))
    }

    // --- Message Edited ---
    const handleMessageEdited = ({ messageId, conversationId, body, updatedAt }) => {
      setMessages(prev => prev.map(m => {
        if (m.id === messageId) {
          return { ...m, body, isEdited: true, updatedAt }
        }
        return m
      }))

      // Update sidebar preview if it's the last message
      setConversations(prev => prev.map(conv => {
        if (conv.id === conversationId && conv.messages?.[0]?.id === messageId) {
          return {
            ...conv,
            messages: [{ ...conv.messages[0], body, isEdited: true }]
          }
        }
        return conv
      }))
    }

    // --- Message Deleted (delete for everyone) ---
    const handleMessageDeleted = ({ messageId, conversationId }) => {
      // Mark as deleted instead of removing — show "This message was deleted"
      setMessages(prev => prev.map(m => {
        if (m.id === messageId) {
          return { ...m, isDeleted: true, body: null }
        }
        return m
      }))

      // Update sidebar preview if it's the last message
      setConversations(prev => prev.map(conv => {
        if (conv.id === conversationId && conv.messages?.[0]?.id === messageId) {
          return {
            ...conv,
            messages: [{ ...conv.messages[0], body: 'This message was deleted', isDeleted: true }]
          }
        }
        return conv
      }))
    }

    // --- Conversation updated (from another user) ---
    // This event is broadcast to ALL connected clients via io.emit(),
    // so it works even when the user has left the conversation room.
    const handleConversationUpdated = ({ conversationId, lastMessage }) => {
      const currentConv = activeConversationRef.current
      const isActiveConv = currentConv && currentConv.id === conversationId

      // Increment unread count if:
      // 1. The message is from someone else (not us)
      // 2. It's NOT the conversation we're currently viewing
      if (lastMessage?.userId !== user?.id && !isActiveConv) {
        setUnreadCounts(prev => ({
          ...prev,
          [conversationId]: (prev[conversationId] || 0) + 1
        }))
        // Track the first unread message ID for the separator
        setFirstUnreadIds(prev => {
          if (!prev[conversationId]) {
            return { ...prev, [conversationId]: lastMessage.id }
          }
          return prev
        })
        playNotificationSound()
      }

      setConversations(prev => {
        const exists = prev.find(c => c.id === conversationId)
        if (!exists) {
          // New conversation we weren't tracking — refetch the list
          fetchConversations()
          return prev
        }
        return prev.map(conv => {
          if (conv.id === conversationId) {
            return {
              ...conv,
              messages: [lastMessage],
              lastMessageAt: new Date().toISOString()
            }
          }
          return conv
        }).sort((a, b) => new Date(b.lastMessageAt || b.createdAt) - new Date(a.lastMessageAt || a.createdAt))
      })
    }

    // --- Presence events ---
    const handleOnlineUsers = (userIds) => {
      setOnlineUsers(new Set(userIds))
    }

    const handleUserOnline = ({ userId }) => {
      setOnlineUsers(prev => new Set([...prev, userId]))
    }

    const handleUserOffline = ({ userId }) => {
      setOnlineUsers(prev => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }

    // --- Typing indicators ---
    const handleUserTyping = ({ userId, userName, conversationId, isTyping }) => {
      if (isTyping) {
        setTypingUsers(prev => ({
          ...prev,
          [conversationId]: { userId, userName }
        }))
        // Auto-clear after 3 seconds (in case stop-typing event is missed)
        setTimeout(() => {
          setTypingUsers(prev => {
            const next = { ...prev }
            if (next[conversationId]?.userId === userId) {
              delete next[conversationId]
            }
            return next
          })
        }, 3000)
      } else {
        setTypingUsers(prev => {
          const next = { ...prev }
          delete next[conversationId]
          return next
        })
      }
    }
    // --- Group real-time updates (rename / add / remove / leave) ---
    const handleGroupUpdated = ({ conversation }) => {
      // Refresh the sidebar list (also adds the group if I was just added)
      fetchConversations()
      // If I have this group open, patch it in place (name, members, admins)
      setActiveConversation(prev =>
        prev && prev.id === conversation.id ? { ...prev, ...conversation } : prev
      )
      // Make sure this socket is in the room so messages arrive live
      socket.emit('join-conversation', conversation.id)
    }

    const handleRemovedFromGroup = ({ conversationId, name }) => {
      socket.emit('leave-conversation', conversationId)
      // If I'm looking at that group right now, close it
      setActiveConversation(prev =>
        prev && prev.id === conversationId ? null : prev
      )
      fetchConversations()
      console.log(`You were removed from ${name}`)
    }

    // Register all listeners
    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('receive-message', handleReceiveMessage)
    socket.on('messages-read', handleMessagesRead)
    socket.on('message-edited', handleMessageEdited)
    socket.on('message-deleted', handleMessageDeleted)
    socket.on('conversation-updated', handleConversationUpdated)
    socket.on('online-users', handleOnlineUsers)
    socket.on('user-online', handleUserOnline)
    socket.on('user-offline', handleUserOffline)
    socket.on('user-typing', handleUserTyping)
    socket.on('group-updated', handleGroupUpdated)
    socket.on('removed-from-group', handleRemovedFromGroup)

    // Set initial connection state
    setIsConnected(socket.connected)

    // Cleanup on unmount
    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('receive-message', handleReceiveMessage)
      socket.off('messages-read', handleMessagesRead)
      socket.off('message-edited', handleMessageEdited)
      socket.off('message-deleted', handleMessageDeleted)
      socket.off('conversation-updated', handleConversationUpdated)
      socket.off('online-users', handleOnlineUsers)
      socket.off('user-online', handleUserOnline)
      socket.off('user-offline', handleUserOffline)
      socket.off('user-typing', handleUserTyping)
      socket.off('group-updated', handleGroupUpdated)
      socket.off('removed-from-group', handleRemovedFromGroup)
    }
  }, [user, playNotificationSound]) // Re-run when user state changes (i.e. login/verify finishes)

  /**
   * Fetch all conversations for the current user
   * GET /api/conversations
   */
  const fetchConversations = useCallback(async () => {
    setLoadingConversations(true)
    try {
      const res = await api.get('/conversations')
      setConversations(res.data.conversations)

      // Initialize unread counts from server
      const counts = {}
      res.data.conversations.forEach(conv => {
        if (conv._count?.messages > 0) {
          counts[conv.id] = conv._count.messages
        }
      })
      setUnreadCounts(counts)
    } catch (error) {
      console.error('Failed to fetch conversations:', error)
    } finally {
      setLoadingConversations(false)
    }
  }, [])

  /**
   * Select a conversation and load its messages.
   * Also joins the Socket.IO room for real-time updates.
   */
  const selectConversation = useCallback(async (conversation) => {
    const socket = getSocket()

    // Leave the previous conversation room
    if (activeConversationRef.current && socket) {
      socket.emit('leave-conversation', activeConversationRef.current.id)
    }

    setActiveConversation(conversation)
    setMessages([])
    setLoadingMessages(true)

    // Clear unread count and first-unread marker for this conversation
    setUnreadCounts(prev => {
      const next = { ...prev }
      delete next[conversation.id]
      return next
    })
    setFirstUnreadIds(prev => {
      const next = { ...prev }
      delete next[conversation.id]
      return next
    })

    // Join the new conversation room for real-time messages
    if (socket) {
      socket.emit('join-conversation', conversation.id)
    }

    try {
      const res = await api.get(`/conversations/${conversation.id}/messages`)
      setMessages(res.data.messages)
      setHasMoreMessages(res.data.hasMore)
    } catch (error) {
      console.error('Failed to fetch messages:', error)
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  /**
   * Load older messages (pagination)
   * Uses cursor-based pagination — sends the oldest message ID
   * Uses refs to avoid stale closure bugs with scroll handlers
   */
  const loadMoreMessages = useCallback(async () => {
    if (!activeConversation || !hasMoreMessages) return
    if (loadingRef.current) return // prevent double-trigger from rapid scroll

    const currentMessages = messagesRef.current
    const oldestMessage = currentMessages[0]
    if (!oldestMessage) return

    loadingRef.current = true
    setLoadingMessages(true)
    try {
      const res = await api.get(
        `/conversations/${activeConversation.id}/messages?cursor=${oldestMessage.id}`
      )
      // Prepend older messages to the beginning
      setMessages(prev => [...res.data.messages, ...prev])
      setHasMoreMessages(res.data.hasMore)
    } catch (error) {
      console.error('Failed to load more messages:', error)
    } finally {
      setLoadingMessages(false)
      loadingRef.current = false
    }
  }, [activeConversation, hasMoreMessages])

  /**
   * Upload an image to the server (Cloudinary), returning { url, public_id }.
   * Used by MessageInput before sending an image message.
   *
   * The 10 MB / type limits are enforced server-side; we also surface any
   * error message so the input can show it to the user.
   */
  const uploadImage = useCallback(async (file) => {
    const formData = new FormData()
    formData.append('image', file)

    // IMPORTANT: do NOT set Content-Type manually for multipart uploads.
    // The browser must set it to "multipart/form-data; boundary=..." itself —
    // the boundary is required for the server (multer) to parse the file.
    // Our axios instance defaults Content-Type to application/json, so we
    // explicitly clear it here for this one request.
    const res = await api.post('/messages/upload', formData, {
      headers: { 'Content-Type': undefined }
    })

    // { url, public_id } from the upload controller
    return { image: res.data.url, public_id: res.data.public_id }
  }, [])

  /**
   * Send a message via Socket.IO (with REST fallback)
   * 
   * Primary: socket.emit('send-message') → server persists + broadcasts
   * Fallback: POST /api/messages (if socket not connected)
   *
   * @param {string} body - Message text (may be empty if there's an image)
   * @param {{ image: string, public_id: string }} [attachment] - Optional image
   */
  const sendMessage = useCallback(async (body, attachment = null) => {
    const text = (body || '').trim()
    // Allow image-only messages: require text OR an attachment
    if (!activeConversation || (!text && !attachment?.image)) return

    const socket = getSocket()

    const payload = {
      conversationId: activeConversation.id,
      body: text || null,
      image: attachment?.image || null,
      public_id: attachment?.public_id || null
    }

    // --- Socket.IO path (preferred) ---
    if (socket?.connected) {
      return new Promise((resolve, reject) => {
        socket.emit(
          'send-message',
          payload,
          // Server acknowledgment callback
          (response) => {
            if (response.error) {
              reject(new Error(response.error))
            } else {
              // Message will arrive via 'receive-message' event
              // No need to manually add it to state
              resolve(response.message)
            }
          }
        )
      })
    }

    // --- REST fallback (if socket is disconnected) ---
    try {
      const res = await api.post('/messages', payload)

      // Manually add since we won't get a socket event
      setMessages(prev => [...prev, res.data.message])

      setConversations(prev =>
        prev.map(conv => {
          if (conv.id === activeConversation.id) {
            return {
              ...conv,
              messages: [res.data.message],
              lastMessageAt: new Date().toISOString()
            }
          }
          return conv
        }).sort((a, b) => new Date(b.lastMessageAt || b.createdAt) - new Date(a.lastMessageAt || a.createdAt))
      )

      return res.data.message
    } catch (error) {
      console.error('Failed to send message:', error)
      throw error
    }
  }, [activeConversation])

  /**
   * Mark messages as read
   */
  const markMessagesRead = useCallback((conversationId, messageIds) => {
    if (!messageIds || messageIds.length === 0) return
    const socket = getSocket()
    if (socket?.connected) {
      socket.emit('mark-messages-read', { conversationId, messageIds })
      // Optimistically update local state
      setMessages(prev => prev.map(m => {
        if (messageIds.includes(m.id)) {
          if (m.seenBy?.some(u => u.id === user?.id)) return m
          return { ...m, seenBy: [...(m.seenBy || []), { id: user?.id }] }
        }
        return m
      }))
    }
  }, [user])

  /**
   * Edit a message
   */
  const editMessage = useCallback(async (messageId, newBody) => {
    if (!activeConversation || !newBody.trim()) return

    const socket = getSocket()
    if (socket?.connected) {
      socket.emit('edit-message', {
        messageId,
        conversationId: activeConversation.id,
        body: newBody.trim()
      })
      
      // Optimistic update
      setMessages(prev => prev.map(m => {
        if (m.id === messageId) {
          return { ...m, body: newBody.trim(), isEdited: true }
        }
        return m
      }))
    }
  }, [activeConversation])

  /**
   * Delete entire conversation history
   */
  const clearChatHistory = useCallback(async (conversationId) => {
    try {
      await api.delete(`/conversations/${conversationId}`)
      
      // Update state
      setConversations(prev => prev.filter(c => c.id !== conversationId))
      if (activeConversation?.id === conversationId) {
        setActiveConversation(null)
        setMessages([])
      }
    } catch (error) {
      console.error('Failed to clear chat history:', error)
    }
  }, [activeConversation])

  /**
   * Delete a message for everyone (sender only)
   */
  const deleteMessage = useCallback(async (messageId) => {
    if (!activeConversation) return

    const socket = getSocket()
    if (socket?.connected) {
      socket.emit('delete-message', {
        messageId,
        conversationId: activeConversation.id
      })
      
      // Optimistic update: mark as deleted, don't remove
      setMessages(prev => prev.map(m => {
        if (m.id === messageId) {
          return { ...m, isDeleted: true, body: null }
        }
        return m
      }))
    }
  }, [activeConversation])

  /**
   * Delete messages for me only (works on any message)
   */
  const deleteForMe = useCallback(async (messageIds) => {
    if (!activeConversation) return

    const socket = getSocket()
    if (socket?.connected) {
      socket.emit('delete-for-me', {
        messageIds,
        conversationId: activeConversation.id
      })
      
      // Optimistic update: remove from local state
      setMessages(prev => prev.filter(m => !messageIds.includes(m.id)))
    }
  }, [activeConversation])

  /**
   * Send typing indicator
   */
  const sendTyping = useCallback((isTyping) => {
    if (!activeConversation) return
    const socket = getSocket()
    if (socket?.connected) {
      socket.emit('typing', {
        conversationId: activeConversation.id,
        isTyping
      })
    }
  }, [activeConversation])

  /**
   * Create a new conversation with a user
   * POST /api/conversations { participantId }
   */
  const createConversation = useCallback(async (participantId) => {
    try {
      const res = await api.post('/conversations', { participantId })
      const conversation = res.data.conversation

      // Add to list if new, or update existing
      setConversations(prev => {
        const exists = prev.find(c => c.id === conversation.id)
        if (exists) return prev
        return [conversation, ...prev]
      })

      // Select the new/existing conversation
      await selectConversation(conversation)

      return conversation
    } catch (error) {
      console.error('Failed to create conversation:', error)
      throw error
    }
  }, [selectConversation])

  /**
   * Add a message to the current conversation (used for real-time updates)
   * Called when we receive a message from Socket.IO
   */
  const addMessage = useCallback((message) => {
    setMessages(prev => {
      if (prev.some(m => m.id === message.id)) return prev
      return [...prev, message]
    })

    // Update the conversation's last message preview
    setConversations(prev =>
      prev.map(conv => {
        if (conv.id === message.conversationId) {
          return {
            ...conv,
            messages: [message],
            lastMessageAt: new Date().toISOString()
          }
        }
        return conv
      }).sort((a, b) => new Date(b.lastMessageAt || b.createdAt) - new Date(a.lastMessageAt || a.createdAt))
    )
  }, [])

  const value = {
    conversations,
    activeConversation,
    messages,
    loadingConversations,
    loadingMessages,
    hasMoreMessages,
    onlineUsers,
    typingUsers,
    isConnected,
    unreadCounts,
    firstUnreadIds,
    fetchConversations,
    selectConversation,
    loadMoreMessages,
    sendMessage,
    uploadImage,
    editMessage,
    deleteMessage,
    deleteForMe,
    clearChatHistory,
    markMessagesRead,
    sendTyping,
    createConversation,
    addMessage,
    setActiveConversation
  }

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  )
}

export default ChatContext

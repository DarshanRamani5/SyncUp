import { io } from 'socket.io-client'

/**
 * Socket.IO Client Manager
 * 
 * Manages the WebSocket connection to the server.
 * - Connects with JWT auth token in the handshake
 * - Provides connect/disconnect/getSocket helpers
 * 
 * This is a "module singleton" — there's only one socket instance.
 * The SocketContext will use this to manage the lifecycle.
 * 
 * Note: Socket.IO won't actually work until the server has Socket.IO
 * set up (Chunk 2). For now, we prepare the client side so the
 * ChatContext can use it once the server is ready.
 */

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000'

let socket = null

/**
 * Connect to the Socket.IO server
 * @param {string} token — JWT token (with "Bearer " prefix)
 * @returns {Socket} — the socket.io client instance
 */
export const connectSocket = (token) => {
  if (socket?.connected) {
    return socket
  }

  socket = io(SOCKET_URL, {
    auth: {
      // Send the raw JWT (without "Bearer " prefix) in the handshake
      token: token?.replace('Bearer ', '')
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
  })

  socket.on('connect', () => {
    console.log('🔌 Socket connected:', socket.id)
  })

  socket.on('disconnect', (reason) => {
    console.log('🔌 Socket disconnected:', reason)
  })

  socket.on('connect_error', (error) => {
    console.error('🔌 Socket connection error:', error.message)
  })

  return socket
}

/**
 * Disconnect the socket
 */
export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}

/**
 * Get the current socket instance (may be null)
 */
export const getSocket = () => socket

import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import dotenv from 'dotenv'
import prisma from './lib/prisma.js'
import { setupSocketServer } from './socket.js'
import { initProducer, startConsumer, shutdownKafka, getProducer } from './config/kafka.js'

// Route imports
import authRoutes from './routes/auth.routes.js'
import userRoutes from './routes/user.routes.js'
import conversationRoutes from './routes/conversation.routes.js'
import messageRoutes from './routes/message.routes.js'

// Middleware imports
import errorMiddleware from './middlewares/error.middleware.js'

dotenv.config()

const app = express()
const port = process.env.PORT || 5000

// --- Create HTTP server ---
// Socket.IO requires an HTTP server instance (can't just use app.listen)
// This wraps the Express app so both REST and WebSocket traffic go through the same port
const server = createServer(app)

// --- Socket.IO Server ---
// Initialize with CORS config matching the Express CORS settings
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true
  },
  // Ping every 25 seconds, timeout after 20 seconds of no response
  pingInterval: 25000,
  pingTimeout: 20000
})

// --- Global Middleware ---
// CORS: Allow requests from the frontend URL only
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}))

// Parse JSON request bodies (e.g., { "email": "...", "password": "..." })
app.use(express.json())


// --- Routes ---
// Each route file is mounted under a prefix
// So auth.routes.js's "/register" becomes "/api/auth/register"
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/conversations', conversationRoutes)
app.use('/api/messages', messageRoutes)

// --- Health Check ---
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ 
      status: 'ok', 
      database: 'connected',
      kafka: getProducer() ? 'connected' : 'not configured',
      sockets: io.engine.clientsCount 
    })
  } catch (error) {
    res.status(500).json({ status: 'error', database: 'disconnected', message: error.message })
  }
})

app.get('/', (req, res) => {
  res.json({ message: 'SyncUp API is running', version: '1.0.0' })
})

// --- Error Handler (MUST be last) ---
app.use(errorMiddleware)

// --- Start Server ---
// Use server.listen (not app.listen) so Socket.IO works on the same port
const startServer = async () => {
  try {
    // Set up Socket.IO with auth + Redis adapter + event handlers
    await setupSocketServer(io)

    // Initialize Kafka producer + consumer (no-op if env vars missing)
    await initProducer()
    await startConsumer()

    server.listen(port, () => {
      console.log(`🚀 Server running on http://localhost:${port}`)
      console.log(`📋 Health check: http://localhost:${port}/health`)
      console.log(`🔌 Socket.IO ready on ws://localhost:${port}`)
    })
  } catch (error) {
    console.error('❌ Failed to start server:', error)
    process.exit(1)
  }
}

startServer()

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...')
  io.close()
  await shutdownKafka()
  await prisma.$disconnect()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  io.close()
  await shutdownKafka()
  await prisma.$disconnect()
  process.exit(0)
})

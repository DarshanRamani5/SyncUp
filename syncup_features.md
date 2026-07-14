# SyncUp — Complete Feature & Architecture Document

> **Purpose**: Give this document to any AI to prepare you for a technical interview about the SyncUp project. It covers every feature, architectural decision, data flow, and design pattern used.

---

## 1. Project Overview

**SyncUp** is a full-stack, real-time chat application (similar to WhatsApp/Discord) built with a modern JavaScript stack. It supports 1-1 and group messaging with features like typing indicators, online presence, read receipts, message editing/deletion, image sharing, friend requests, and rate limiting.

### Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 19 + Vite | SPA with fast HMR |
| **Styling** | TailwindCSS 3 | Utility-first CSS |
| **Routing** | React Router v7 | Client-side navigation |
| **HTTP Client** | Axios | REST API calls with interceptors |
| **Real-time (Client)** | Socket.IO Client | WebSocket communication |
| **Backend** | Node.js + Express | REST API server |
| **Real-time (Server)** | Socket.IO Server | WebSocket event handling |
| **Database** | PostgreSQL (Supabase) | Primary data store |
| **ORM** | Prisma 6 | Type-safe database queries |
| **Message Queue** | Apache Kafka (Aiven Cloud) | Async message persistence |
| **Cache / Pub-Sub** | Redis (Upstash) | Presence tracking, Socket.IO adapter, rate limiting |
| **File Storage** | Cloudinary | Image uploads for chat |
| **Auth** | JWT + bcrypt | Stateless token authentication |

---

## 2. Architecture Overview

```
┌──────────────────────┐         ┌──────────────────────────────────────┐
│    React Client      │◄──WS───►│          Node.js Server              │
│  (Vite + Socket.IO)  │◄─REST──►│      (Express + Socket.IO)           │
└──────────────────────┘         │                                      │
                                 │  ┌──────────┐   ┌─────────────────┐ │
                                 │  │  Kafka    │   │  Redis          │ │
                                 │  │ (Aiven)   │   │ (Upstash)       │ │
                                 │  │           │   │                 │ │
                                 │  │ Producer──┤   │ Presence Store  │ │
                                 │  │ Consumer──┤   │ Socket.IO Pub/  │ │
                                 │  │ (MESSAGES) │   │  Sub Adapter    │ │
                                 │  │           │   │ Rate Limiter    │ │
                                 │  └──────────┘   └─────────────────┘ │
                                 │                                      │
                                 │  ┌───────────────────────────────┐   │
                                 │  │ PostgreSQL (Supabase)         │   │
                                 │  │ via Prisma ORM                │   │
                                 │  │ PgBouncer (port 6543)         │   │
                                 │  │ Direct   (port 5432)          │   │
                                 │  └───────────────────────────────┘   │
                                 │                                      │
                                 │  ┌──────────────┐                    │
                                 │  │ Cloudinary   │ Image CDN          │
                                 │  └──────────────┘                    │
                                 └──────────────────────────────────────┘
```

### Key Architectural Decisions

1. **Optimistic Messaging via Kafka**: Messages are broadcast to clients INSTANTLY via Socket.IO, then asynchronously persisted to PostgreSQL through a Kafka consumer. This gives sub-50ms perceived latency.

2. **Graceful Degradation**: Every external service has a fallback:
   - Kafka down → synchronous DB write
   - Redis down → in-memory presence store + no rate limiting
   - Cloudinary down → text-only chat (image uploads disabled)

3. **Horizontal Scalability**: Socket.IO uses a Redis pub/sub adapter, allowing multiple server instances to broadcast events across processes.

4. **Dual Database URLs (Supabase)**: Uses PgBouncer (port 6543) for pooled queries and a direct connection (port 5432) for Prisma migrations.

---

## 3. Feature Breakdown

### 3.1 Authentication System

| Feature | Details |
|---------|---------|
| **Registration** | Name + unique @username + email + password. Password hashed with bcrypt (salt rounds: 10) |
| **Username System** | Discord/Telegram style: 3-20 chars, lowercase letters/numbers/underscores. Normalized on input (`@Harsh_Dev` → `harsh_dev`) |
| **Login** | Supports both email AND username in the same field. Auto-detects by checking for `@` + `.` |
| **JWT Tokens** | Signed with `JWT_SECRET`, expires in 7 days. Payload: `{ id, name, username, email }` |
| **Session Persistence** | Token stored in `localStorage`. On app mount, `GET /api/auth/me` verifies validity |
| **Auto-logout** | Axios response interceptor catches 401 → clears token → redirects to `/login` |
| **Race Condition Handling** | If two registrations race past the `findFirst` check, Prisma's `P2002` unique constraint error is caught and returns a friendly 409 |

**Auth Flow**:
```
Register/Login → Server returns JWT → Stored in localStorage → 
Axios interceptor attaches to every request → Socket.IO handshake includes token
```

### 3.2 Real-Time Messaging (Socket.IO)

| Feature | Details |
|---------|---------|
| **WebSocket Auth** | Socket.IO middleware verifies JWT before allowing connection. Token sent via `socket.handshake.auth.token` |
| **Room-based Architecture** | Each conversation is a Socket.IO room. Users `join-conversation` when selecting a chat |
| **Personal Rooms** | Every user auto-joins `user:<id>` room for targeted notifications (friend requests, group updates) |
| **Optimistic Delivery** | Message broadcast to room BEFORE persistence. UUID generated server-side via `crypto.randomUUID()` |
| **Dual Persistence Path** | Kafka (async) → fallback to synchronous Prisma `$transaction` |
| **Acknowledgment Callbacks** | Server sends ack back to sender with `{ success, message, timing }` |
| **Performance Timing** | Every message logs `broadcast`, `persist`, and `total` milliseconds |

**Message Data Flow**:
```
Client → socket.emit('send-message') → Server validates (auth, membership, friendship, rate limit)
  → Broadcast to room immediately (optimistic)
  → Publish to Kafka topic "MESSAGES"
  → Kafka Consumer reads → Prisma $transaction (create Message + update Conversation.lastMessageAt)
  → Commit offset (at-least-once delivery)
```

### 3.3 Conversation Management

| Feature | Details |
|---------|---------|
| **1-1 Chats** | Deduplication: checks for existing conversation before creating. Friends-only enforcement |
| **Group Chats** | Named groups with 3+ members. Only friends can be added |
| **Sidebar Preview** | Shows latest message per conversation, sorted by `lastMessageAt` |
| **Cursor-Based Pagination** | Messages loaded in pages of 30. Cursor = oldest message ID. Immune to new-message shifting |
| **Unread Count** | Server-side: `_count.messages` query with `seenBy: { none: { id: currentUserId } }`. Client-side: incremented in real-time via `conversation-updated` event |
| **First Unread Separator** | Tracks the first unread message ID per conversation for UI separator rendering |
| **Delete Conversation** | Removes all messages, cleans up Cloudinary images, clears seenBy/deletedBy relations, deletes join table entries |

### 3.4 Message Features

| Feature | Details |
|---------|---------|
| **Text Messages** | Basic body text |
| **Image Messages** | Image-only or image+text. Uploaded via multer → Cloudinary. Max 10MB. Allowed types: JPEG, PNG, GIF, WebP |
| **Edit Message** | Only the sender can edit. Sets `isEdited = true`. Broadcast via `message-edited` event |
| **Delete for Everyone** | Soft delete: `isDeleted = true`, body/image/public_id cleared. Shows "This message was deleted". Also deletes from Cloudinary |
| **Delete for Me** | Connects user to `deletedBy` relation. Message hidden only for that user. The `getMessages` query filters these out via `NOT: { deletedBy: { some: { id: currentUserId } } }` |
| **Read Receipts** | `mark-messages-read` event → Prisma connects user to `seenBy` relation. Broadcast `messages-read` to room for blue double-tick UI |
| **Kafka Race Handling for Read Receipts** | If a message hasn't been persisted by Kafka yet when `mark-messages-read` fires, it retries up to 2 times with 600ms delays. This prevents phantom unread counts after restarts |
| **Reply Threading** | Database schema supports reply-to via self-referencing `replyToId` on Message model (`onDelete: SetNull`) |
| **Notification Sound** | WebAudio API: programmatic sine wave oscillator (D5→A5 frequency ramp, 500ms duration). No external audio files needed |

### 3.5 Presence System (Online/Offline Tracking)

| Feature | Details |
|---------|---------|
| **Redis-backed** | Uses Redis SETs and HASHes for multi-tab/multi-device awareness |
| **Multi-tab Support** | Each socket ID tracked per user. "Online" = at least 1 socket. "Offline" = 0 sockets |
| **Stale Data Cleanup** | On server startup, clears all `presence:sockets:*`, `presence:online`, and `presence:socket-user` keys |
| **In-Memory Fallback** | JavaScript `Map<userId, Set<socketId>>` when Redis is unavailable |
| **Events** | `user-online` (first socket connects), `user-offline` (last socket disconnects), `online-users` (full list on connect) |

**Redis Keys**:
```
presence:online           → SET of all online userIds
presence:sockets:<userId> → SET of socketIds for that user
presence:socket-user      → HASH mapping socketId → userId
```

### 3.6 Typing Indicators

| Feature | Details |
|---------|---------|
| **Real-time** | `typing` event emitted on input change, broadcast to conversation room |
| **Auto-clear** | Client-side 3-second timeout if stop-typing event is missed |
| **Payload** | `{ userId, userName, conversationId, isTyping }` |

### 3.7 Friend System (WhatsApp/Discord Style)

| Feature | Details |
|---------|---------|
| **Send Request** | By user ID. Validates: not self, not already friends, no reverse pending request |
| **Accept/Decline** | Only the receiver can respond. Accept uses a `$transaction` to: update status + connect both `friendsWith` directions |
| **Cancel Request** | Only the sender can cancel a pending request |
| **Unfriend** | Disconnects both `friendsWith` + `friendOf` directions + deletes the FriendRequest row. All in a `$transaction` |
| **Friends-Only Messaging** | 1-1 chats require friendship. Enforced at 3 levels: conversation creation, REST message send, Socket.IO message send |
| **Unique Constraint** | `@@unique([senderId, receiverId])` prevents duplicate requests |
| **Real-Time Notifications** | `friend-request-received` (receiver badge updates), `friend-requests-updated` (sender/receiver list refresh after accept/decline/cancel/unfriend) |
| **Search by Username** | `GET /api/users/search?q=harsh` — case-insensitive "starts with" match. Min 2 chars. Capped at 10 results. Privacy: no emails returned |

### 3.8 Group Chat System

| Feature | Details |
|---------|---------|
| **Creation** | Name (max 100 chars) + select 2+ friends. Creator becomes admin |
| **Admin Privileges** | Only admins can: rename group, add members, remove members |
| **Add Members** | Admin only. Must be friends of the admin. Prevents duplicate adds |
| **Remove Member** | Admin only. Admin cannot remove themselves (must use "Leave") |
| **Leave Group** | If last admin leaves → longest-standing member auto-promoted. If last member leaves → group + all messages deleted |
| **Real-Time Events** | `group-updated` → all members (sidebar refresh). `removed-from-group` → kicked member (closes chat, drops from sidebar) |

### 3.9 Rate Limiting (Anti-Spam)

| Feature | Details |
|---------|---------|
| **Algorithm** | Sliding Window + Cooldown, implemented via Redis Lua script for atomicity |
| **Window** | 10 seconds, max 20 messages |
| **Cooldown** | 2-minute mute when limit exceeded |
| **Atomic Execution** | Single Lua script runs in Redis: check cooldown → trim old timestamps → count → record or block. Prevents race conditions |
| **Fail Open** | If Redis is down, rate limiting is disabled (never blocks real users on a bug) |
| **User Feedback** | Returns `retryAfter` seconds so the client can show a countdown |

**Redis Keys**:
```
ratelimit:cooldown:<userId> → STRING with TTL (cooldown active)
ratelimit:msgs:<userId>     → SORTED SET (score = timestamp ms)
```

### 3.10 Image Upload Pipeline

```
Client selects file → POST /api/messages/upload (multipart)
  → multer middleware (memory storage, 10MB limit, type validation)
  → Cloudinary upload_stream (buffer → CDN)
  → Returns { url, public_id }
  → Client sends message via Socket.IO with { image: url, public_id }
```

- **Server-authoritative validation**: Size and type limits enforced by multer middleware, not just client-side
- **Cleanup on delete**: When a message with an image is deleted-for-everyone, the Cloudinary asset is destroyed via `public_id`

---

## 4. Database Schema (Prisma)

### Models

| Model | Key Fields | Notes |
|-------|-----------|-------|
| **User** | id (CUID), name, username (unique), email (unique), passwordHash, avatarUrl, color | Self-referencing many-to-many for friends (`friendsWith`/`friendOf`) |
| **FriendRequest** | senderId, receiverId, status (pending/accepted/declined) | `@@unique([senderId, receiverId])` prevents spam |
| **Conversation** | id (UUID), name, isGroup, lastMessageAt | Used for sidebar sorting |
| **ConversationsOnUsers** | userId, conversationId, isAdmin | Explicit join table with composite PK. `isAdmin` for group admin flag |
| **Message** | id (UUID), body, image, public_id, userId, conversationId, isEdited, isDeleted, replyToId | `seenBy` + `deletedBy` = implicit many-to-many with User |
| **VerificationToken** | identifier, token, expires | For future email verification / password reset |

### Relationship Diagram

```
User ──M:N──> User            (Friends: self-referencing via friendsWith/friendOf)
User ──1:N──> FriendRequest   (sent + received)
User ──M:N──> Conversation    (via ConversationsOnUsers join table)
User ──1:N──> Message         (sent_messages)
User ──M:N──> Message         (seen: seenBy relation)
User ──M:N──> Message         (deleted_for_user: deletedBy relation)
Conversation ──1:N──> Message (cascade delete)
Message ──0:1──> Message      (reply threading: replyToId, self-referencing)
```

### Key Indexes
- `Message: @@index([conversationId, createdAt])` — fast paginated queries
- `Conversation: @@index([createdAt])` — sorting

---

## 5. API Endpoints

### Auth (`/api/auth`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/register` | Register with name, username, email, password |
| POST | `/login` | Login with email OR username + password |
| GET | `/me` | Get current user from JWT (session check) |

### Users (`/api/users`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Get all users (admin/debug) |
| GET | `/search?q=` | Search by @username (min 2 chars, max 10 results, no emails) |
| GET | `/:id` | Get user profile by ID |

### Conversations (`/api/conversations`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Create 1-1 conversation (friends only) |
| GET | `/` | List all my conversations with unread counts |
| GET | `/:id/messages?cursor=` | Paginated messages (cursor-based, 30 per page) |
| DELETE | `/:id` | Delete conversation + all messages + Cloudinary assets |
| POST | `/group` | Create group chat (2+ friends required) |
| PUT | `/:id/group` | Rename group (admin only) |
| POST | `/:id/members` | Add members to group (admin only, friends only) |
| DELETE | `/:id/members/:userId` | Remove member from group (admin only) |
| POST | `/:id/leave` | Leave group (auto-promotes admin if needed) |

### Messages (`/api/messages`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Send message (REST fallback) |
| POST | `/upload` | Upload image to Cloudinary (multipart, 10MB max) |

### Friends (`/api/friends`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Get my friends list |
| DELETE | `/:friendId` | Unfriend someone |
| POST | `/requests` | Send friend request |
| GET | `/requests` | Get my incoming + outgoing pending requests |
| PUT | `/requests/:id` | Accept or decline a request |
| DELETE | `/requests/:id` | Cancel a sent request |

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Returns DB status, Kafka status, connected sockets count |

---

## 6. Socket.IO Events

### Client → Server
| Event | Payload | Description |
|-------|---------|-------------|
| `join-conversation` | `conversationId` | Join a conversation room |
| `leave-conversation` | `conversationId` | Leave a conversation room |
| `send-message` | `{ conversationId, body, image, public_id }` | Send a message (with ack callback) |
| `typing` | `{ conversationId, isTyping }` | Typing indicator |
| `mark-messages-read` | `{ conversationId, messageIds }` | Mark messages as read |
| `edit-message` | `{ messageId, conversationId, body }` | Edit own message |
| `delete-message` | `{ messageId, conversationId }` | Delete for everyone (sender only) |
| `delete-for-me` | `{ messageIds, conversationId }` | Delete for self only |

### Server → Client
| Event | Payload | Description |
|-------|---------|-------------|
| `receive-message` | Full message object with `createdBy` | New message in a room |
| `conversation-updated` | `{ conversationId, lastMessage }` | Sidebar update (broadcast to ALL) |
| `conversation-updated-delete` | `{ conversationId, messageId }` | Sidebar update after deletion |
| `messages-read` | `{ conversationId, messageIds, userId }` | Read receipt (blue double-tick) |
| `message-edited` | `{ messageId, conversationId, body, updatedAt }` | Message was edited |
| `message-deleted` | `{ messageId, conversationId }` | Message deleted for everyone |
| `user-online` | `{ userId }` | A user came online |
| `user-offline` | `{ userId }` | A user went offline |
| `online-users` | `[userId, ...]` | Full online user list (on connect) |
| `user-typing` | `{ userId, userName, conversationId, isTyping }` | Typing indicator |
| `group-updated` | `{ conversation }` | Group renamed/member added/member left |
| `removed-from-group` | `{ conversationId, name }` | You were kicked from a group |
| `friend-request-received` | `{ from: { id, name, username } }` | Someone sent you a request |
| `friend-requests-updated` | `{}` | Refresh your request lists (after accept/decline/cancel) |

---

## 7. Client Architecture

### State Management (React Context)

| Context | Responsibilities |
|---------|-----------------|
| **AuthContext** | `user`, `token`, `loading`, `isAuthenticated`, `register()`, `login()`, `logout()` |
| **ChatContext** | `conversations`, `activeConversation`, `messages`, `onlineUsers`, `typingUsers`, `isConnected`, `unreadCounts`, `firstUnreadIds`, and 12+ action functions |

### Key React Patterns Used

1. **Refs to avoid stale closures**: `activeConversationRef`, `messagesRef`, `loadingRef` — socket event handlers would otherwise capture stale state
2. **Optimistic updates**: Edit/delete/mark-read update local state immediately, before server confirmation
3. **Deduplication**: `receive-message` handler checks `prev.some(m => m.id === message.id)` to avoid duplicates
4. **Auto-scroll + infinite scroll**: ChatArea uses scroll position tracking for new messages and `loadMoreMessages()` for pagination

### Client Pages

| Page | Route | Description |
|------|-------|-------------|
| **LoginPage** | `/login` | Email/username + password login |
| **RegisterPage** | `/register` | Name + @username + email + password signup |
| **ChatPage** | `/chat` | Main chat interface (Sidebar + ChatArea) |
| **FriendsPage** | `/friends` | Search users, send/manage friend requests, friends list |

### Client Components

| Component | Description |
|-----------|-------------|
| **Sidebar** | Conversation list with search, last message preview, unread badges, online indicators, new chat/group modals |
| **ChatArea** | Message list, scroll management, unread separator, header with group info |
| **MessageBubble** | Individual message rendering with edit/delete context menus, image display, read receipts, "edited" label, "This message was deleted" |
| **MessageInput** | Text input with typing indicators, image attachment (preview + cancel), send button |
| **NewGroupModal** | Group creation: name input + friend multi-select |
| **GroupSettingsModal** | Group management: rename, view members, add/remove members, leave group |
| **ProtectedRoute** | Route guard: redirects to `/login` if not authenticated, shows spinner while loading |

---

## 8. Security Measures

| Area | Implementation |
|------|---------------|
| **Password Hashing** | bcrypt with 10 salt rounds |
| **JWT Auth** | Verified on every REST request (middleware) AND Socket.IO handshake |
| **Conversation Access** | Every message/read action verifies the user is a conversation participant |
| **Friends-Only Gating** | Enforced at 3 levels: conversation creation, REST send, Socket.IO send |
| **Input Validation** | Username regex, password min length, message requires body or image |
| **Rate Limiting** | Atomic Redis Lua script prevents message flooding |
| **File Upload** | Server-authoritative: multer enforces 10MB limit + MIME type whitelist |
| **Privacy** | `searchUsers` deliberately omits email addresses. Strangers only see @username |
| **CORS** | Restricted to `FRONTEND_URL` origin only |
| **Ownership Checks** | Only message sender can edit or delete-for-everyone |

---

## 9. Design Patterns & Best Practices

| Pattern | Where Used |
|---------|-----------|
| **Singleton** | Prisma client (`globalForPrisma`), Redis client, Socket.IO instance (`getIO()`) |
| **Factory** | `createRedisClient()` — returns new Redis instances for pub/sub |
| **Observer** | Socket.IO event-driven architecture |
| **Strategy** | Kafka → synchronous DB fallback; Redis → in-memory fallback |
| **Optimistic UI** | Client updates state before server confirms (edit, delete, read) |
| **Cursor-based Pagination** | Immune to data shifting, anchors to specific message IDs |
| **Transaction Batching** | Prisma `$transaction` ensures atomicity (message + conversation update) |
| **Graceful Degradation** | Every external service has a fallback path |
| **At-Least-Once Delivery** | Kafka consumer manually commits offsets only after successful DB write |
| **Sliding Window Rate Limiting** | Prevents boundary-exploit attacks possible with fixed windows |

---

## 10. Kafka Deep Dive (Interview Gold)

### Why Kafka for a Chat App?

1. **Decouples broadcast from persistence**: Users see messages instantly (~5ms) while DB writes happen asynchronously (~50-100ms)
2. **Partition key = conversationId**: All messages for the same conversation go to the same partition → guarantees ordering within a conversation
3. **At-least-once delivery**: Consumer commits offset ONLY after successful Prisma `$transaction`. If it crashes mid-write, the message is re-processed on restart
4. **Back-pressure handling**: If the DB is slow, Kafka buffers messages without affecting real-time delivery

### Kafka Config
- **Topic**: `MESSAGES`
- **Consumer Group**: `syncup-message-consumer`
- **Auth**: SASL/PLAIN over TLS OR mTLS (client certificates)
- **Connection**: 10s timeout, 5 retries with exponential backoff

---

## 11. Redis Deep Dive

### Three Distinct Use Cases

1. **Socket.IO Pub/Sub Adapter** — Two dedicated connections (pub + sub) for cross-server event broadcasting
2. **Presence Tracking** — SETs and HASHes for online user tracking with multi-tab awareness
3. **Rate Limiting** — Sorted sets + cooldown keys with Lua scripts for atomic sliding window enforcement

---

## 12. Performance Highlights

- **Sub-50ms message delivery**: Optimistic broadcast before Kafka/DB persistence
- **Connection pooling**: Supabase PgBouncer for efficient DB connections
- **Lazy connections**: Redis uses `lazyConnect: true` — connects on first use
- **Exponential backoff**: Kafka and Redis both use backoff strategies to avoid thundering-herd on reconnect
- **Notification sounds without files**: WebAudio API synthesizes tones programmatically — zero network requests

---

## 13. Project Structure

```
SyncUp/
├── client/                          # React frontend (Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── ChatArea.jsx         # Message list + scroll + header
│   │   │   ├── MessageBubble.jsx    # Single message (edit/delete/reply)
│   │   │   ├── MessageInput.jsx     # Input + typing + image attach
│   │   │   ├── Sidebar.jsx          # Conv list + search + online dots
│   │   │   ├── NewGroupModal.jsx    # Group creation
│   │   │   ├── GroupSettingsModal.jsx# Group management
│   │   │   └── ProtectedRoute.jsx   # Auth guard
│   │   ├── context/
│   │   │   ├── AuthContext.jsx      # Auth state + JWT management
│   │   │   └── ChatContext.jsx      # Chat state + Socket.IO events
│   │   ├── lib/
│   │   │   ├── api.js               # Axios instance + interceptors
│   │   │   └── socket.js            # Socket.IO client manager
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx
│   │   │   ├── RegisterPage.jsx
│   │   │   ├── ChatPage.jsx
│   │   │   └── FriendsPage.jsx
│   │   ├── App.jsx                  # Router + providers
│   │   └── main.jsx                 # Entry point
│   └── .env                         # VITE_SOCKET_URL, VITE_API_URL
│
├── server/                          # Node.js backend
│   ├── src/
│   │   ├── config/
│   │   │   ├── kafka.js             # Producer + Consumer + Aiven auth
│   │   │   ├── redis.js             # Client factory + singleton
│   │   │   ├── cloudinary.js        # Upload + delete helpers
│   │   │   └── ratelimit.js         # Sliding window Lua script
│   │   ├── controllers/
│   │   │   ├── auth.controller.js   # Register, login, me
│   │   │   ├── user.controller.js   # List, search, getById
│   │   │   ├── conversation.controller.js  # CRUD + pagination
│   │   │   ├── message.controller.js       # REST send + image upload
│   │   │   ├── friend.controller.js        # Request lifecycle + unfriend
│   │   │   └── group.controller.js         # Group lifecycle + admin logic
│   │   ├── middlewares/
│   │   │   ├── auth.middleware.js    # JWT verification
│   │   │   ├── upload.middleware.js  # Multer (memory, 10MB, type filter)
│   │   │   └── error.middleware.js   # Global error handler
│   │   ├── routes/                  # Express route definitions
│   │   ├── lib/
│   │   │   ├── prisma.js            # Singleton Prisma client
│   │   │   └── friendship.js        # Shared areFriends() helper
│   │   ├── utils/
│   │   │   └── asyncHandler.js
│   │   ├── index.js                 # Server entry (Express + Socket.IO + Kafka)
│   │   └── socket.js               # Socket.IO setup (auth, events, presence)
│   ├── prisma/
│   │   ├── schema.prisma            # Database schema
│   │   ├── migrations/              # Migration history
│   │   └── seed.js                  # DB seeding script
│   ├── ca.pem                       # Aiven Kafka CA certificate
│   ├── service.key / service.cert   # Kafka mTLS client certs
│   └── .env                        # All service credentials
```

---

## 14. Potential Interview Questions & Talking Points

### Architecture
- Why Kafka for a chat app instead of just Socket.IO → DB?
- How does the optimistic messaging pattern work?
- What happens if Kafka is down? How does the app handle it?
- How does the presence system work across multiple tabs?
- Why cursor-based pagination instead of offset-based?

### Database
- Why a join table (`ConversationsOnUsers`) instead of an array field?
- How does the self-referencing many-to-many work for friends?
- Why two database URLs (PgBouncer vs Direct)?
- How do soft deletes vs "delete for me" work differently?

### Real-Time
- How do you prevent duplicate messages in the UI?
- How does Socket.IO auth work differently from REST auth?
- What's the purpose of the Redis adapter?
- How does the typing indicator handle edge cases (lost events)?

### Security
- Where is friendship enforced? (Answer: 3 levels)
- How does the rate limiter prevent race conditions? (Answer: Lua script atomicity)
- Why memory storage for multer instead of disk?

### Performance
- What's the message delivery latency? (Answer: sub-50ms broadcast, async persist)
- How do you avoid stale closures in React? (Answer: refs)
- Why generate notification sounds programmatically? (Answer: zero network requests)

import { useChat } from '../context/ChatContext.jsx'
import Sidebar from '../components/Sidebar.jsx'
import ChatArea from '../components/ChatArea.jsx'

/**
 * ChatPage
 * 
 * The main chat page layout. Two-panel design:
 * - Left: Sidebar (conversation list, search, new chat)
 * - Right: ChatArea (messages, input)
 * 
 * This is a protected route — only accessible when authenticated.
 * The ProtectedRoute wrapper in App.jsx handles the auth check.
 * 
 * On mobile, only one panel shows at a time:
 * - No active chat → sidebar visible
 * - Active chat → chat area visible (with back button)
 */
const ChatPage = () => {
  const { activeConversation } = useChat()

  return (
    <div className={`chat-layout ${activeConversation ? 'has-active-chat' : ''}`} id="chat-page">
      <Sidebar />
      <ChatArea />
    </div>
  )
}

export default ChatPage

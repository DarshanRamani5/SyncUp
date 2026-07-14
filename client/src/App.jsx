import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext.jsx'
import { ChatProvider } from './context/ChatContext.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import LoginPage from './pages/LoginPage.jsx'
import RegisterPage from './pages/RegisterPage.jsx'
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx'
import ChatPage from './pages/ChatPage.jsx'
import FriendsPage from './pages/FriendsPage.jsx'

/**
 * App
 *
  * Root component that sets up:
 * 1. AuthProvider — wraps everything for auth state
 * 2. ChatProvider — wraps chat pages for conversation/message state
 * 3. Router — handles navigation between pages
 * Routes:
 * - /login    → LoginPage (public)
 * - /register → RegisterPage (public)
 * - /chat     → ChatPage (protected)
 * - /friends  → FriendsPage (protected) — NEW: add friend / requests / friends list
 * - /         → Redirects to /chat
 * - *         → Redirects to /chat (catch-all)
 */
function App() {
  return (
    <Router>
      <AuthProvider>
        <ChatProvider>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />

            {/* Protected routes */}
            <Route
              path="/chat"
              element={
                <ProtectedRoute>
                  <ChatPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/friends"
              element={
                <ProtectedRoute>
                  <FriendsPage />
                </ProtectedRoute>
              }
            />

            {/* Default redirect */}
            <Route path="/" element={<Navigate to="/chat" replace />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </ChatProvider>
      </AuthProvider>
    </Router>
  )
}

export default App
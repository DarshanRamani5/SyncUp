import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

/**
 * ProtectedRoute
 * 
 * Wraps routes that require authentication.
 * - While checking auth: shows a loading spinner
 * - If not authenticated: redirects to /login
 * - If authenticated: renders the child component
 * 
 * Usage in App.jsx:
 *   <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
 */
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth()

  // Still checking if token is valid — show loading
  if (loading) {
    return (
      <div className="loading-page">
        <div className="loading-spinner lg"></div>
        <p className="loading-page-text">Loading SyncUp...</p>
      </div>
    )
  }

  // Not logged in — redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  // Authenticated — render the page
  return children
}

export default ProtectedRoute

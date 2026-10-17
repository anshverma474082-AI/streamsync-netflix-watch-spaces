import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import Auth from './pages/Auth.jsx';
import Home from './pages/Home.jsx';
import Room from './pages/Room.jsx';
import Dashboard from './pages/Dashboard.jsx';
import './styles.css';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="room-loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading) return <div className="room-loading">Loading…</div>;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Auth />} />
      <Route path="/" element={<Protected><Home /></Protected>} />
      <Route path="/room/:id" element={<Protected><Room /></Protected>} />
      <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);

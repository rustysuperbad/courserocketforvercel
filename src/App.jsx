import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Course from "./pages/Course";
import Profile from "./pages/Profile";
import { useAuth } from "./context/AuthContext";

function AuthGate() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid rgba(99,102,241,0.25)", borderTopColor: "var(--primary-2)", animation: "spin 0.9s linear infinite" }} />
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, authLoading } = useAuth();
  if (authLoading) return <AuthGate />;
  return user ? children : <Navigate to="/login" replace />;
}

function PublicOnlyRoute({ children }) {
  const { user, authLoading } = useAuth();
  if (authLoading) return <AuthGate />;
  return user ? <Navigate to="/dashboard" replace /> : children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/course/:id" element={<ProtectedRoute><Course /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  );
}
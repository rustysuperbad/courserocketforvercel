import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Course = lazy(() => import("./pages/Course"));
const Profile = lazy(() => import("./pages/Profile"));
const LearnHome = lazy(() => import("./pages/learn/LearnHome"));
import { useAuth } from "./context/AuthContext";

function DeferredPage({ children }) {
  return (
    <Suspense fallback={<div className="cr-route-loading"><span /></div>}>
      {children}
    </Suspense>
  );
}

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
        <Route path="/" element={<DeferredPage><Landing /></DeferredPage>} />
        <Route path="/login" element={<PublicOnlyRoute><DeferredPage><Login /></DeferredPage></PublicOnlyRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><DeferredPage><Dashboard /></DeferredPage></ProtectedRoute>} />
        <Route path="/course/:id" element={<ProtectedRoute><DeferredPage><Course /></DeferredPage></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><DeferredPage><Profile /></DeferredPage></ProtectedRoute>} />
        <Route path="/learn" element={<ProtectedRoute><DeferredPage><LearnHome /></DeferredPage></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  );
}
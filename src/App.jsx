import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Course = lazy(() => import("./pages/Course"));
const Profile = lazy(() => import("./pages/Profile"));
const Studio = lazy(() => import("./pages/learn/Studio"));
const Privacy = lazy(() => import("./pages/Privacy"));
const PracticeBentoPreview = import.meta.env.DEV
  ? lazy(() => import("./pages/PracticeBentoPreview"))
  : null;
import { useAuth } from "./context/AuthContext";
import BrandIntro from "./components/BrandIntro";
const CommandPalette = lazy(() => import("./components/CommandPalette"));

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
      <div style={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--ink)", animation: "spin 0.9s linear infinite" }} />
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
      <a className="cr-skip" href="#main">Skip to content</a>
      <BrandIntro />
      <Suspense fallback={null}><CommandPalette /></Suspense>
      <Routes>
        <Route path="/" element={<DeferredPage><Landing /></DeferredPage>} />
        <Route path="/login" element={<PublicOnlyRoute><DeferredPage><Login /></DeferredPage></PublicOnlyRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><DeferredPage><Dashboard /></DeferredPage></ProtectedRoute>} />
        <Route path="/course/:id" element={<ProtectedRoute><DeferredPage><Course /></DeferredPage></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><DeferredPage><Profile /></DeferredPage></ProtectedRoute>} />
        <Route path="/sandbox" element={<ProtectedRoute><DeferredPage><Studio /></DeferredPage></ProtectedRoute>} />
        <Route path="/learn" element={<Navigate to="/dashboard" replace />} />
        <Route path="/learn/onboarding" element={<Navigate to="/dashboard" replace />} />
        <Route path="/learn/review" element={<Navigate to="/dashboard" replace />} />
        <Route path="/learn/practice" element={<Navigate to="/sandbox" replace />} />
        <Route path="/learn/notes" element={<Navigate to="/dashboard" replace />} />
        <Route path="/learn/studio" element={<Navigate to="/sandbox" replace />} />
        <Route path="/learn/analytics" element={<Navigate to="/profile" replace />} />
        <Route path="/learn/course/:courseId" element={<Navigate to="/dashboard" replace />} />
        <Route path="/privacy" element={<DeferredPage><Privacy /></DeferredPage>} />
        {import.meta.env.DEV ? (
          <Route path="/dev/practice-bento" element={<DeferredPage><PracticeBentoPreview /></DeferredPage>} />
        ) : null}
      </Routes>
    </BrowserRouter>
  );
}
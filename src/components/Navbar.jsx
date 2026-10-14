import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";

function readTheme() {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  try {
    const stored = localStorage.getItem("cr-theme");
    if (stored === "dark" || stored === "light") return stored;
  } catch { /* private mode */ }
  return "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  try { localStorage.setItem("cr-theme", theme); } catch { /* private mode */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0a0e1a" : "#f3f5f9");
}

function ThemeToggle() {
  const [theme, setTheme] = useState(readTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="cr-btn cr-theme-toggle"
      aria-pressed={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          fill="currentColor"
          d="M21 14.55A9 9 0 0 1 9.45 3 7.2 7.2 0 1 0 21 14.55Z"
        />
      </svg>
    </button>
  );
}

export default function Navbar({ minimal = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const handleSignOut = async () => {
    await signOut(auth);
    navigate("/");
  };

  return (
    <nav className="cr-navbar">
      <div className="cr-nav-inner">
        <div className="cr-nav-left">
          <button type="button" className="cr-brand" onClick={() => navigate("/")} aria-label="CourseRocket home">
            <img src="/logo-mark.svg" alt="" className="cr-brand-mark" draggable={false} />
            <span className="cr-brand-word">course<span>rocket</span></span>
          </button>
          {!minimal && user && (
            <div className="cr-nav-links" aria-label="Main navigation">
              <NavLink active={location.pathname === "/dashboard"} onClick={() => navigate("/dashboard")}>Courses</NavLink>
              <NavLink active={location.pathname === "/profile"} onClick={() => navigate("/profile")}>Stats</NavLink>
              <NavLink active={location.pathname === "/sandbox"} onClick={() => navigate("/sandbox")}>Sandbox</NavLink>
            </div>
          )}
        </div>
        <div className="cr-nav-actions">
          <ThemeToggle />
          {user ? (
            <>
              <button type="button" className="cr-user-pill" onClick={() => navigate("/profile")} aria-label="Account">
                <span className="cr-user-avatar">{(user.displayName || user.email || "U").charAt(0).toUpperCase()}</span>
                <span className="cr-user-name">{user.displayName || user.email}</span>
              </button>
              <span className="cr-kbd" aria-hidden="true">⌘K</span>
              <button type="button" className="cr-btn cr-btn-ghost cr-nav-signout" onClick={handleSignOut}>Sign out</button>
            </>
          ) : minimal ? null : (
            <>
              <button type="button" className="cr-btn cr-btn-ghost" onClick={() => navigate("/login")}>Sign in</button>
              <button type="button" className="cr-btn cr-btn-ghost cr-nav-cta" onClick={() => navigate("/login?signup=1")}>Create account</button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

function NavLink({ active, onClick, children }) {
  return (
    <button type="button" className={"cr-nav-link" + (active ? " is-active" : "")} onClick={onClick} aria-current={active ? "page" : undefined}>
      {children}
    </button>
  );
}

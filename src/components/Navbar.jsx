import { useNavigate, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";

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
            <img src="/logo-mark.png" alt="" className="cr-brand-mark" draggable={false} />
            <span className="cr-brand-word">course<span>rocket</span></span>
          </button>
          {!minimal && (
            <div className="cr-nav-links" aria-label="Main navigation">
              {user && <NavLink active={location.pathname === "/dashboard"} onClick={() => navigate("/dashboard")}>Dashboard</NavLink>}
              {user && <NavLink active={location.pathname.startsWith("/learn")} onClick={() => navigate("/learn")}>Learn</NavLink>}
              <NavLink active={location.pathname === "/"} onClick={() => navigate("/")}>Home</NavLink>
            </div>
          )}
        </div>
        <div className="cr-nav-actions">
          {user ? (
            <>
              <button type="button" className="cr-user-pill" onClick={() => navigate("/profile")} aria-label="Open profile">
                <span className="cr-user-avatar">{(user.displayName || user.email || "U").charAt(0).toUpperCase()}</span>
                <span className="cr-user-name">{user.displayName || user.email}</span>
              </button>
              <button type="button" className="cr-btn cr-btn-ghost cr-nav-signout" onClick={handleSignOut}>Sign out</button>
            </>
          ) : (
            <>
              <button type="button" className="cr-btn cr-btn-ghost" onClick={() => navigate("/login")}>Sign in</button>
              <button type="button" className="cr-btn cr-btn-primary" onClick={() => navigate("/login?signup=1")}>Get started <span aria-hidden="true">↗</span></button>
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

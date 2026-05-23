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

  const isActive = (path) => location.pathname === path;

  return (
    <nav style={styles.nav}>
      <div style={styles.inner}>
        <div style={styles.left}>
          <div style={styles.brand} onClick={() => navigate("/")}>
            <img
              src="/logo-mark.png"
              alt="CourseRocket"
              height={72}
              width={72}
              draggable={false}
              style={styles.brandMark}
            />
            <div style={styles.brandText}>
              course<span style={{ color: "var(--primary-2)" }}>rocket</span>
            </div>
          </div>

          {!minimal && (
            <div style={styles.links}>
              {user && (
                <>
                  <NavLink active={isActive("/dashboard")} onClick={() => navigate("/dashboard")}>
                    Dashboard
                  </NavLink>
                </>
              )}
              <NavLink active={isActive("/")} onClick={() => navigate("/")}>
                Home
              </NavLink>
            </div>
          )}
        </div>

        <div style={styles.right}>
          {user ? (
            <>
              <div
                style={styles.userPill}
                onClick={() => navigate("/profile")}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") navigate("/profile");
                }}
                aria-label="Open profile"
              >
                <div style={styles.avatar}>
                  {(user.displayName || user.email || "U").charAt(0).toUpperCase()}
                </div>
                <span style={styles.userEmail}>{user.displayName || user.email}</span>
              </div>
              <button className="cr-btn cr-btn-ghost" onClick={handleSignOut}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <button className="cr-btn cr-btn-ghost" onClick={() => navigate("/login")}>
                Sign in
              </button>
              <button className="cr-btn cr-btn-primary" onClick={() => navigate("/login?signup=1")}>
                Get started
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

function NavLink({ active, onClick, children }) {
  return (
    <span
      onClick={onClick}
      style={{
        fontSize: "15px",
        color: active ? "var(--text)" : "var(--text-2)",
        cursor: "pointer",
        padding: "8px 12px",
        borderRadius: "8px",
        background: active ? "rgba(255,255,255,0.04)" : "transparent",
        transition: "all 0.15s ease",
      }}
    >
      {children}
    </span>
  );
}

const styles = {
  nav: {
    position: "sticky",
    top: 0,
    zIndex: 50,
    backdropFilter: "blur(14px)",
    background: "rgba(10,14,26,0.72)",
    borderBottom: "1px solid var(--border)",
  },
  inner: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "18px 24px",
    display: "flex",
    alignItems: "center",
    gap: "16px",
    flexWrap: "nowrap",
    minWidth: 0,
  },
  left: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flex: "1 1 auto",
    minWidth: 0,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    cursor: "pointer",
    flexShrink: 0,
  },
  brandMark: {
    display: "block",
    flexShrink: 0,
    width: 72,
    height: 72,
    objectFit: "contain",
  },
  brandText: {
    fontFamily: "var(--font-display)",
    fontSize: "23px",
    fontWeight: 700,
    color: "var(--text)",
    letterSpacing: "-0.44px",
  },
  links: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    flexShrink: 0,
    flexWrap: "wrap",
    minWidth: 0,
  },
  right: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  userPill: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "5px 10px 5px 5px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--border)",
    borderRadius: "999px",
    cursor: "pointer",
  },
  avatar: {
    width: "26px",
    height: "26px",
    borderRadius: "50%",
    background: "linear-gradient(135deg, var(--primary), var(--accent))",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontWeight: 600,
    fontSize: "12px",
  },
  userEmail: {
    fontSize: "13px",
    color: "var(--text-2)",
    maxWidth: "180px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};

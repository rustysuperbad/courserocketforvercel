import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { auth, googleProvider } from "../lib/firebase";
import { upsertUserProfile } from "../lib/userProgress";
import Navbar from "../components/Navbar";

export default function Login() {
  const [searchParams] = useSearchParams();
  const initialMode = searchParams.get("signup") === "1";
  const topicParam = searchParams.get("topic") || "";

  const [isSignUp, setIsSignUp] = useState(initialMode);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setIsSignUp(searchParams.get("signup") === "1");
  }, [searchParams]);

  const goNext = () => {
    const t = topicParam.trim();
    if (t) {
      navigate(`/dashboard?autostart=1&topic=${encodeURIComponent(t)}`);
    } else {
      navigate("/dashboard");
    }
  };

  const handleEmailAuth = async (e) => {
    e?.preventDefault();
    setErr("");
    setLoading(true);
    try {
      if (isSignUp) {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (fullName.trim()) {
          await updateProfile(cred.user, { displayName: fullName.trim() });
        }
        await upsertUserProfile(cred.user, fullName.trim());
      } else {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        await upsertUserProfile(cred.user);
      }
      goNext();
    } catch (e2) {
      setErr(prettyAuthError(e2?.code || e2?.message));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setErr("");
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      await upsertUserProfile(cred.user);
      goNext();
    } catch (e2) {
      setErr(prettyAuthError(e2?.code || e2?.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.root}>
      <Navbar minimal />

      <div style={s.wrap}>
        <div style={s.left}>
          <div style={s.eyebrow}>
            <span style={s.dot} /> Welcome to CourseRocket
          </div>
          <h1 style={s.h1}>
            {isSignUp ? "Create your account" : "Sign in to continue"}
          </h1>
          <p style={s.sub}>
            {isSignUp
              ? "Save courses, track progress, and pick up where you left off across devices."
              : "Pick up exactly where you left off. All your courses, ready."}
          </p>

          <ul style={s.list}>
            <li style={s.li}><span style={s.tick}>✓</span> Persistent course progress</li>
            <li style={s.li}><span style={s.tick}>✓</span> Auto-saved videos and papers</li>
            <li style={s.li}><span style={s.tick}>✓</span> Instant resume on any device</li>
          </ul>
        </div>

        <div className="cr-card cr-fade" style={s.card}>
          <div style={s.tabs}>
            <button
              style={tabStyle(!isSignUp)}
              onClick={() => setIsSignUp(false)}
            >
              Sign in
            </button>
            <button
              style={tabStyle(isSignUp)}
              onClick={() => setIsSignUp(true)}
            >
              Create account
            </button>
          </div>

          <button
            className="cr-btn cr-btn-ghost"
            style={s.googleBtn}
            onClick={handleGoogle}
            disabled={loading}
          >
            <GoogleMark />
            Continue with Google
          </button>

          <div style={s.divider}>
            <div style={s.line} />
            <span style={s.orLabel}>or</span>
            <div style={s.line} />
          </div>

          <form onSubmit={handleEmailAuth} style={s.form}>
            {isSignUp && (
              <input
                className="cr-input"
                type="text"
                placeholder="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            )}
            <input
              className="cr-input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <input
              className="cr-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={isSignUp ? "new-password" : "current-password"}
              minLength={6}
            />

            {err && <div style={s.error}>{err}</div>}

            <button
              type="submit"
              className="cr-btn cr-btn-primary"
              style={{ width: "100%", padding: "12px" }}
              disabled={loading}
            >
              {loading ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
            </button>
          </form>

          <div style={s.foot}>
            {isSignUp ? "Already have an account? " : "New here? "}
            <span className="cr-link" onClick={() => setIsSignUp((v) => !v)}>
              {isSignUp ? "Sign in" : "Create one"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.5 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.8 0 19.5-8.7 19.5-19.5 0-1.3-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.7 19 12.5 24 12.5c3 0 5.7 1.1 7.8 2.9l5.7-5.7C34.5 6.5 29.5 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 43.5c5.2 0 10-2 13.6-5.2l-6.3-5.2c-2 1.4-4.5 2.4-7.3 2.4-5.3 0-9.7-3.5-11.3-8.3l-6.5 5C9.6 38.9 16.2 43.5 24 43.5z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.7 2.1-2.1 4-3.7 5.3l6.3 5.2c-.4.4 6.6-4.8 6.6-14.5 0-1.3-.1-2.3-.4-3.5z"/>
    </svg>
  );
}

function tabStyle(active) {
  return {
    flex: 1,
    padding: "10px 12px",
    background: active ? "rgba(99,102,241,0.12)" : "transparent",
    color: active ? "var(--text)" : "var(--text-2)",
    border: "1px solid",
    borderColor: active ? "rgba(99,102,241,0.3)" : "var(--border)",
    borderRadius: "8px",
    fontSize: "13.5px",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 120ms ease",
  };
}

function prettyAuthError(code) {
  const map = {
    "auth/invalid-email": "That email looks invalid.",
    "auth/user-not-found": "No account exists for that email.",
    "auth/wrong-password": "Wrong password. Try again.",
    "auth/invalid-credential": "Invalid credentials. Try again.",
    "auth/email-already-in-use": "An account with this email already exists.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/popup-closed-by-user": "Sign-in window was closed.",
  };
  return map[code] || "Something went wrong. Please try again.";
}

const s = {
  root: { minHeight: "100vh" },
  wrap: {
    maxWidth: "1100px",
    margin: "0 auto",
    padding: "60px 24px",
    display: "grid",
    gridTemplateColumns: "1fr 440px",
    gap: "60px",
    alignItems: "center",
  },
  left: {},
  eyebrow: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    background: "var(--primary-soft)",
    border: "1px solid rgba(99,102,241,0.25)",
    color: "var(--primary-2)",
    padding: "6px 14px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 500,
    marginBottom: "20px",
  },
  dot: {
    width: "6px",
    height: "6px",
    background: "var(--primary)",
    borderRadius: "999px",
    boxShadow: "0 0 12px var(--primary)",
  },
  h1: {
    fontFamily: "var(--font-display)",
    fontSize: "44px",
    fontWeight: 800,
    lineHeight: 1.1,
    letterSpacing: "-1px",
    color: "var(--text)",
    marginBottom: "14px",
  },
  sub: {
    fontSize: "16px",
    color: "var(--text-2)",
    lineHeight: 1.6,
    marginBottom: "26px",
    maxWidth: "440px",
  },
  list: { listStyle: "none", display: "flex", flexDirection: "column", gap: "10px" },
  li: { color: "var(--text-2)", fontSize: "14.5px", display: "flex", alignItems: "center", gap: "10px" },
  tick: {
    width: "20px", height: "20px", borderRadius: "50%",
    background: "rgba(16,185,129,0.14)", color: "var(--success)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "11px", fontWeight: 700,
  },
  card: {
    padding: "26px",
  },
  tabs: { display: "flex", gap: "8px", marginBottom: "20px" },
  googleBtn: {
    width: "100%",
    padding: "12px",
    fontSize: "14px",
  },
  divider: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    margin: "18px 0",
  },
  line: { flex: 1, height: "1px", background: "var(--border)" },
  orLabel: { color: "var(--text-3)", fontSize: "12px" },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  error: {
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.3)",
    color: "#fca5a5",
    fontSize: "13px",
    padding: "10px 12px",
    borderRadius: "8px",
  },
  foot: {
    marginTop: "16px",
    fontSize: "13.5px",
    color: "var(--text-2)",
    textAlign: "center",
  },
};

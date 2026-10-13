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
        try {
          await upsertUserProfile(cred.user, fullName.trim());
        } catch (profileErr) {
          console.warn("[login] profile write failed after email sign-up:", profileErr);
        }
      } else {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        try {
          await upsertUserProfile(cred.user);
        } catch (profileErr) {
          console.warn("[login] profile write failed after email sign-in:", profileErr);
        }
      }
      goNext();
    } catch (e2) {
      setErr(prettyAuthError(e2));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setErr("");
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      try {
        await upsertUserProfile(cred.user);
      } catch (profileErr) {
        console.warn("[login] profile write failed after Google sign-in:", profileErr);
      }
      goNext();
    } catch (e2) {
      setErr(prettyAuthError(e2));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cr-shell">
      <Navbar minimal />

      <main id="main" className="cr-login-layout">
        <div className="cr-cell cr-cell-ink cr-span-7 cr-login-copy">
          <p className="cr-kicker">Your courses live here</p>
          <h1>{isSignUp ? "Create your account" : "Sign in"}</h1>
          <p className="cr-body">
            {isSignUp
              ? "Save the courses you make and pick them up on another device."
              : "Your courses and progress are waiting."}
          </p>
          <ul className="cr-login-points">
            <li><span className="cr-kicker">01</span> Courses stay on this account</li>
            <li><span className="cr-kicker">02</span> Progress follows you</li>
            <li><span className="cr-kicker">03</span> Open them on another device</li>
          </ul>
        </div>

        <div className="cr-cell cr-span-5 cr-login-panel">
        <div className="cr-login-form">
          <div className="cr-login-tabs" role="tablist" aria-label="Account">
            <button
              type="button"
              role="tab"
              aria-selected={!isSignUp}
              className={"cr-login-tab" + (!isSignUp ? " is-on" : "")}
              onClick={() => setIsSignUp(false)}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isSignUp}
              className={"cr-login-tab" + (isSignUp ? " is-on" : "")}
              onClick={() => setIsSignUp(true)}
            >
              Create account
            </button>
          </div>

          <button
            type="button"
            className="cr-btn cr-btn-ghost cr-btn-plain"
            onClick={handleGoogle}
            disabled={loading}
            style={{ justifyContent: "flex-start", paddingInline: 0, minHeight: 44 }}
          >
            <GoogleMark />
            Continue with Google
          </button>

          <div className="cr-login-or">or email</div>

          <form onSubmit={handleEmailAuth} className="cr-login-form">
            {isSignUp && (
              <input
                className="cr-input"
                type="text"
                placeholder="Full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
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

            {err && <div className="cr-auth-error" role="alert">{err}</div>}

            <button
              type="submit"
              className="cr-btn cr-btn-primary"
              disabled={loading}
            >
              {loading ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
            </button>
          </form>
        </div>
        </div>
      </main>
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

function prettyAuthError(err) {
  const code = err?.code || "";
  const map = {
    "auth/invalid-email": "That email looks invalid.",
    "auth/user-not-found": "No account exists for that email.",
    "auth/wrong-password": "Wrong password. Try again.",
    "auth/invalid-credential": "Invalid credentials. Try again.",
    "auth/email-already-in-use": "An account with this email already exists.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/popup-closed-by-user": "Sign-in window was closed.",
    "auth/popup-blocked": "The sign-in window was blocked. Allow popups and try again.",
    "auth/cancelled-popup-request": "Sign-in was cancelled. Try again.",
    "auth/operation-not-allowed": "Google sign-in is not enabled on this Firebase project.",
    "auth/unauthorized-domain": "This site is not in Firebase authorized domains.",
    "permission-denied": "Your account cannot save data yet. Firestore rules are blocking writes.",
  };
  if (map[code]) return map[code];
  const msg = String(err?.message || "").trim();
  if (/missing or insufficient permissions/i.test(msg)) {
    return "Your account cannot save data yet. Firestore rules are blocking writes.";
  }
  return msg || "Something went wrong. Please try again.";
}

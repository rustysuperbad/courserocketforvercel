import { useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { useAuth } from "../context/AuthContext";
import { deleteLearningData, describeCallableError, exportLearningData } from "../lib/learningApi";

export default function Privacy() {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");

  async function handleExport() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = await exportLearningData();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `courserocket-export-${payload.exportedAt.slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage("A JSON copy of your learning records was downloaded. Firestore legacy courses are not included.");
    } catch (err) {
      setError(describeCallableError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (confirm !== "DELETE") {
      setError("Type DELETE to confirm.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await deleteLearningData();
      setMessage("Learning-model data for this account was deleted. Course generation history is marked deleted; Firebase Auth is not removed.");
      setConfirm("");
    } catch (err) {
      setError(describeCallableError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cr-shell">
      <Navbar />
      <main className="cr-legal" id="main">
        <p className="cr-kicker">Privacy</p>
        <h1>Your learning data</h1>
        <p className="cr-body">
          CourseRocket keeps Firebase Authentication and stores new learning records in Supabase.
          Lessons are generated from cited sources; private notes stay on your account only.
          This page is a working placeholder for a fuller policy.
        </p>
        <div className="cr-legal-grid">
          <div>
            <p className="cr-kicker">What we store</p>
          </div>
          <div>
            <ul>
              <li>Firebase Auth identity (email or Google account).</li>
              <li>Onboarding profile, mastery estimates, reviews, quiz attempts, and course jobs.</li>
              <li>Optional private notes you upload, used only for your retrieval.</li>
              <li>Lesson feedback you submit. We do not log full lesson text in traces.</li>
            </ul>
            {!user && <p className="cr-body" style={{ marginTop: 24 }}>Sign in to export or delete your learning records.</p>}
            {user && (
              <>
                <div className="cr-hero-form" style={{ marginTop: 36 }}>
                  <button type="button" className="cr-btn cr-btn-primary" onClick={() => void handleExport()} disabled={busy}>
                    {busy ? "Working…" : "Export learning data"}
                  </button>
                </div>
                <label className="cr-kicker" style={{ display: "block", marginTop: 36, marginBottom: 12 }}>
                  Type DELETE to remove learning-model records
                </label>
                <input className="cr-input" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="off" />
                <button type="button" className="cr-btn cr-btn-ghost" style={{ marginTop: 12 }} onClick={() => void handleDelete()} disabled={busy || confirm !== "DELETE"}>
                  Delete my learning data
                </button>
              </>
            )}
            {error && <p className="cr-auth-error" role="alert" style={{ marginTop: 18 }}>{error}</p>}
            {message && <p className="cr-body" role="status" style={{ marginTop: 18 }}>{message}</p>}
          </div>
        </div>
        <p style={{ marginTop: 60 }}>
          <Link className="cr-link" to={user ? "/learn" : "/"}>{user ? "Back to Learn" : "Back to home"}</Link>
        </p>
      </main>
    </div>
  );
}

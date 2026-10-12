import { useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { useAuth } from "../context/AuthContext";
import { deleteLearningData, describeCallableError, exportLearningData } from "../lib/learningApi";
import "../styles/learn.css";

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
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <main className="lr-page" id="main">
        <header className="lr-head">
          <div className="cr-page-kicker">PRIVACY</div>
          <h1>Your learning data</h1>
          <p>
            CourseRocket keeps Firebase Authentication and stores new learning records in Supabase.
            Lessons are generated from cited sources; private notes stay on your account only.
            This page is a working placeholder for a fuller policy.
          </p>
        </header>
        <section className="cr-card lr-card">
          <h2>What we store</h2>
          <ul className="lr-sources">
            <li>Firebase Auth identity (email or Google account).</li>
            <li>Onboarding profile, mastery estimates, reviews, quiz attempts, and course jobs.</li>
            <li>Optional private notes you upload, used only for your retrieval.</li>
            <li>Lesson feedback you submit. We do not log full lesson text in traces.</li>
          </ul>
          {!user && <p className="lr-muted">Sign in to export or delete your learning records.</p>}
          {user && (
            <>
              <div className="lr-actions">
                <button type="button" className="cr-btn cr-btn-primary" onClick={() => void handleExport()} disabled={busy}>
                  {busy ? "Working…" : "Export learning data"}
                </button>
              </div>
              <label className="lr-field">
                <span>Type DELETE to remove learning-model records</span>
                <input className="cr-input" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="off" />
              </label>
              <div className="lr-actions">
                <button type="button" className="cr-btn cr-btn-ghost" onClick={() => void handleDelete()} disabled={busy || confirm !== "DELETE"}>
                  Delete my learning data
                </button>
              </div>
            </>
          )}
          {error && <div className="lr-error" role="alert">{error}</div>}
          {message && <div className="lr-success" role="status">{message}</div>}
        </section>
        <p className="lr-muted" style={{ marginTop: 18 }}><Link className="cr-link" to="/learn">Back to Learn</Link></p>
      </main>
    </div>
  );
}

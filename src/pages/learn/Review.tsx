import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../components/Navbar";
import { describeCallableError, listDueReviews, submitReviewGrade, type DueReview } from "../../lib/learningApi";
import "../../styles/learn.css";

export default function Review() {
  const [reviews, setReviews] = useState<DueReview[]>([]);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function refresh() {
    try {
      setReviews(await listDueReviews());
      setError("");
    } catch (err) {
      setError(describeCallableError(err));
    }
  }

  useEffect(() => { void refresh(); }, []);
  const current = reviews[index];

  async function grade(rating: "again" | "hard" | "good" | "easy") {
    if (!current) return;
    setBusy(true);
    try {
      const result = await submitReviewGrade(current.conceptSlug, rating);
      setNotice(`Next due ${new Date(result.dueAt).toLocaleString()} · p(known)=${result.pKnown.toFixed(2)}`);
      setChoice(null);
      const remaining = reviews.filter((_, i) => i !== index);
      setReviews(remaining);
      setIndex(0);
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
          <div className="cr-page-kicker">SPACED REPETITION</div>
          <h1>Daily review</h1>
          <p>Cards use FSRS. A forgotten card returns sooner than one you marked good.</p>
        </header>
        {error && <div className="lr-error" role="alert">{error}</div>}
        {!current && !error && <p className="lr-muted">Nothing is due. Quiz misses and reviews will fill this queue.</p>}
        {current && (
          <section className="cr-card lr-card" aria-labelledby="review-title">
            <h2 id="review-title">{current.title}</h2>
            <p>{current.description}</p>
            {current.question && (
              <>
                <p>{current.question.question}</p>
                <div className="lr-list">
                  {current.question.options.map((option) => (
                    <button key={option} type="button" className="lr-option" aria-pressed={choice === option} onClick={() => setChoice(option)}>{option}</button>
                  ))}
                </div>
              </>
            )}
            <div className="lr-actions">
              <button type="button" className="cr-btn cr-btn-ghost" disabled={busy} onClick={() => void grade("again")}>Again</button>
              <button type="button" className="cr-btn cr-btn-ghost" disabled={busy} onClick={() => void grade("hard")}>Hard</button>
              <button type="button" className="cr-btn cr-btn-soft" disabled={busy} onClick={() => void grade("good")}>Good</button>
              <button type="button" className="cr-btn cr-btn-primary" disabled={busy} onClick={() => void grade("easy")}>Easy</button>
            </div>
            {notice && <div className="lr-success" role="status">{notice}</div>}
          </section>
        )}
        <p className="lr-muted" style={{ marginTop: 16 }}><Link className="cr-link" to="/learn">Back to Learn</Link></p>
      </main>
    </div>
  );
}

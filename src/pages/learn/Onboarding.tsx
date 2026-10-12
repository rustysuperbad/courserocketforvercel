import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../../components/Navbar";
import { useAuthState } from "../../lib/authState";
import {
  describeCallableError, getNextDiagnosticQuestion, idempotencyKeyFor, listNetworkingCatalog, saveLearnerProfile,
  startCourseJob, submitDiagnosticChoice, type DiagnosticQuestion, type PathStep, type PublicConcept,
} from "../../lib/learningApi";
import "../../styles/learn.css";

const STEPS = ["Goal", "What you know", "Diagnostic", "Your path"] as const;

export default function Onboarding() {
  const { user } = useAuthState();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [catalog, setCatalog] = useState<PublicConcept[]>([]);
  const [interestsPool, setInterestsPool] = useState<string[]>([]);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [targetId, setTargetId] = useState("packet-journey");
  const [goal, setGoal] = useState("Trace a web request across a network");
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [interests, setInterests] = useState<Set<string>>(new Set());
  const [question, setQuestion] = useState<DiagnosticQuestion | null>(null);
  const [askedCount, setAskedCount] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ correct: boolean; explanation: string } | null>(null);
  const [pendingNext, setPendingNext] = useState<DiagnosticQuestion | null>(null);
  const [path, setPath] = useState<PathStep[]>([]);
  const [minutes, setMinutes] = useState(0);

  useEffect(() => {
    void listNetworkingCatalog().then((data) => {
      setCatalog(data.concepts);
      setInterestsPool(data.interestSuggestions);
    }).catch((err) => setLoadError(describeCallableError(err)));
  }, []);

  const target = catalog.find((concept) => concept.id === targetId) ?? catalog.at(-1);

  const stepLabel = useMemo(() => STEPS.map((label, index) => ({ label, current: index === step, done: index < step })), [step]);

  async function persistProfile() {
    if (!target) throw new Error("Choose a networking goal.");
    return saveLearnerProfile({
      goal: goal.trim() || target.title,
      targetConceptSlug: target.id,
      knownConceptSlugs: [...known],
      interests: [...interests],
    });
  }

  async function handleProfileNext() {
    setBusy(true);
    setError("");
    try {
      await persistProfile();
      const next = await getNextDiagnosticQuestion(targetId);
      setAskedCount(next.askedCount);
      if (next.done && next.steps) {
        setPath(next.steps);
        setMinutes(next.totalEstimatedMinutes ?? 0);
        setStep(3);
      } else {
        setQuestion(next.question);
        setSelected(null);
        setFeedback(null);
        setStep(2);
      }
    } catch (err) {
      setError(describeCallableError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleAnswer() {
    if (!question || !selected) { setError("Choose an answer to continue."); return; }
    setBusy(true);
    setError("");
    try {
      const result = await submitDiagnosticChoice(question.conceptSlug, selected, targetId);
      setAskedCount(result.askedCount);
      setFeedback({ correct: Boolean(result.isCorrect), explanation: result.explanation ?? "" });
      if (result.done && result.steps) {
        setPath(result.steps);
        setMinutes(result.totalEstimatedMinutes ?? 0);
        setPendingNext(null);
      } else {
        setPendingNext(result.question);
      }
    } catch (err) {
      setError(describeCallableError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleStartCourse() {
    if (!user || !target) return;
    setBusy(true);
    setError("");
    const goalText = goal.trim() || target.title;
    const key = idempotencyKeyFor(user.uid, goalText, "networking", target.id);
    try {
      const result = await startCourseJob({ goal: goalText, idempotencyKey: key, domain: "networking", targetConceptSlug: target.id });
      navigate("/learn", { state: { startedRunId: result.runId } });
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
          <div className="cr-page-kicker">NETWORKING ONBOARDING</div>
          <h1>Start from what you already know</h1>
          <p>Pick a goal, mark familiar topics, then answer a short adaptive diagnostic. Two learners with different knowledge get different paths for the same goal.</p>
        </header>
        <nav className="lr-stepper" aria-label="Onboarding steps">
          {stepLabel.map((item) => (
            <span key={item.label} aria-current={item.current ? "step" : undefined} data-done={item.done}>{item.label}</span>
          ))}
        </nav>
        {loadError && <div className="lr-error" role="alert">{loadError}</div>}

        {step === 0 && (
          <section className="cr-card lr-card" aria-labelledby="goal-heading">
            <h2 id="goal-heading">What do you want to be able to do?</h2>
            <label className="lr-field">
              <span>Launch goal</span>
              <select className="cr-input" value={targetId} onChange={(event) => {
                const next = event.target.value;
                setTargetId(next);
                const match = catalog.find((concept) => concept.id === next);
                if (match) setGoal(match.title);
              }}>
                {catalog.map((concept) => <option key={concept.id} value={concept.id}>{concept.title}</option>)}
              </select>
            </label>
            <label className="lr-field">
              <span>Your words (optional)</span>
              <textarea className="cr-input" rows={3} maxLength={500} value={goal} onChange={(event) => setGoal(event.target.value)} />
            </label>
            <fieldset className="lr-field" style={{ border: 0, padding: 0 }}>
              <legend>Interests used for analogies later</legend>
              <div className="lr-list">
                {interestsPool.map((item) => (
                  <label key={item} className="lr-check">
                    <input type="checkbox" checked={interests.has(item)} onChange={() => setInterests(toggle(interests, item))} />
                    <span>{item}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="lr-actions">
              <button type="button" className="cr-btn cr-btn-primary" onClick={() => setStep(1)} disabled={!catalog.length}>Continue</button>
              <Link className="cr-btn cr-btn-ghost" to="/learn">Back to Learn</Link>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="cr-card lr-card" aria-labelledby="known-heading">
            <h2 id="known-heading">Which topics do you already know?</h2>
            <p>Check anything you could explain to a friend. Unchecked topics start as unknown; the diagnostic will refine the rest.</p>
            <div className="lr-list">
              {catalog.map((concept) => (
                <label key={concept.id} className="lr-check">
                  <input type="checkbox" checked={known.has(concept.id)} onChange={() => setKnown(toggle(known, concept.id))} />
                  <span>{concept.title}<small>{concept.description}</small></span>
                </label>
              ))}
            </div>
            <div className="lr-actions">
              <button type="button" className="cr-btn cr-btn-ghost" onClick={() => setStep(0)}>Back</button>
              <button type="button" className="cr-btn cr-btn-primary" onClick={() => void handleProfileNext()} disabled={busy} aria-busy={busy}>
                {busy ? "Saving…" : "Start diagnostic"}
              </button>
            </div>
            {error && <div className="lr-error" role="alert">{error}</div>}
          </section>
        )}

        {step === 2 && question && (
          <section className="cr-card lr-card" aria-labelledby="diag-heading">
            <h2 id="diag-heading">{question.title}</h2>
            <p className="lr-muted">Question {askedCount + 1} · {question.questionType}</p>
            <p>{question.question}</p>
            <div className="lr-list" role="listbox" aria-label="Answer choices">
              {question.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="lr-option"
                  aria-pressed={selected === option}
                  data-result={feedback && option === selected ? (feedback.correct ? "correct" : "incorrect") : undefined}
                  onClick={() => { setSelected(option); setFeedback(null); }}
                >
                  {option}
                </button>
              ))}
            </div>
            {feedback && <div className={feedback.correct ? "lr-success" : "lr-notice"} role="status">{feedback.correct ? "Correct. " : "Not quite. "}{feedback.explanation}</div>}
            <div className="lr-actions">
              {feedback ? (
                <button type="button" className="cr-btn cr-btn-primary" onClick={() => {
                  if (pendingNext) {
                    setQuestion(pendingNext);
                    setPendingNext(null);
                    setSelected(null);
                    setFeedback(null);
                  } else {
                    setStep(3);
                  }
                }}>
                  {pendingNext ? "Next question" : "See my path"}
                </button>
              ) : (
                <button type="button" className="cr-btn cr-btn-primary" onClick={() => void handleAnswer()} disabled={busy || !selected} aria-busy={busy}>
                  {busy ? "Checking…" : "Submit answer"}
                </button>
              )}
            </div>
            {error && <div className="lr-error" role="alert">{error}</div>}
          </section>
        )}

        {step === 3 && (
          <section className="cr-card lr-card" aria-labelledby="path-heading">
            <h2 id="path-heading">Your path</h2>
            <p>About {minutes} minutes of new or shortened lessons. Skipped topics stay available as review.</p>
            <ol className="lr-steps">
              {path.map((item, index) => (
                <li key={item.conceptId} className="lr-step" data-action={item.action}>
                  <b>{index + 1}</b>
                  <span>{item.title}</span>
                  <small className="lr-muted">{item.action} · {item.estimatedMinutes} min · p={item.pKnown.toFixed(2)}</small>
                </li>
              ))}
            </ol>
            <h3>Prerequisite map for this goal</h3>
            <ul className="lr-map">
              {catalog.flatMap((concept) => concept.prerequisiteIds.flatMap((fromId) => {
                const from = catalog.find((item) => item.id === fromId);
                if (!from) return [];
                const onPath = path.some((step) => step.conceptId === concept.id || step.conceptId === from.id);
                return [(
                  <li key={`${from.id}->${concept.id}`}>
                    <span data-related={onPath}>{from.title}</span>
                    <span aria-hidden="true"> → </span>
                    <span data-related={onPath}>{concept.title}</span>
                  </li>
                )];
              }))}
            </ul>
            <div className="lr-actions">
              <button type="button" className="cr-btn cr-btn-primary" onClick={() => void handleStartCourse()} disabled={busy} aria-busy={busy}>
                {busy ? "Starting…" : "Generate this verified course"}
              </button>
              <Link className="cr-btn cr-btn-ghost" to="/learn">Save and go back</Link>
            </div>
            {error && <div className="lr-error" role="alert">{error}</div>}
          </section>
        )}
      </main>
    </div>
  );
}

function toggle(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

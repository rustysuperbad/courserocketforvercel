import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../../components/Navbar";
import { RunStatusBadge } from "../../components/learn/StatusBadge";
import { useAuthState } from "../../lib/authState";
import {
  clearIdempotencyKey, describeCallableError, getCourseJobStatus, idempotencyKeyFor, listLearningRuns, startCourseJob,
  type JobDomain, type RunView,
} from "../../lib/learningApi";
import "../../styles/learn.css";

const ACTIVE: ReadonlySet<string> = new Set(["queued", "running"]);
const POLL_MS = 4000;

export default function LearnHome() {
  const { user } = useAuthState();
  const navigate = useNavigate();
  const [goal, setGoal] = useState("");
  const [domain, setDomain] = useState<JobDomain>("networking");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [runs, setRuns] = useState<RunView[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState("");

  const refreshRuns = useCallback(async () => {
    try {
      setRuns(await listLearningRuns());
      setRunsError("");
    } catch (err) {
      setRunsError(describeCallableError(err));
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => { void refreshRuns(); }, [refreshRuns]);

  const activeRunIds = useMemo(() => runs.filter((run) => ACTIVE.has(run.status)).map((run) => run.runId), [runs]);
  useEffect(() => {
    if (!activeRunIds.length) return;
    const timer = window.setInterval(async () => {
      const updates = await Promise.allSettled(activeRunIds.map((runId) => getCourseJobStatus(runId)));
      setRuns((previous) => previous.map((run) => {
        const index = activeRunIds.indexOf(run.runId);
        const update = index >= 0 ? updates[index] : undefined;
        return update && update.status === "fulfilled" ? { ...run, ...update.value } : run;
      }));
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [activeRunIds]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    const trimmed = goal.trim();
    if (!trimmed) { setError("Describe what you want to be able to do."); return; }
    setSubmitting(true);
    setError("");
    setNotice("");
    const key = idempotencyKeyFor(user.uid, trimmed, domain);
    try {
      const result = await startCourseJob({ goal: trimmed, idempotencyKey: key, domain });
      setNotice(result.status === "queued" ? "Your course job is queued. Progress updates below." : `This goal already has a run (${result.status}).`);
      setGoal("");
      clearIdempotencyKey(user.uid, trimmed, domain);
      await refreshRuns();
    } catch (err) {
      setError(describeCallableError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <main className="lr-page" id="main">
        <header className="lr-head">
          <div className="cr-page-kicker">LEARN FROM WHAT YOU KNOW</div>
          <h1>Your learning path</h1>
          <p>
            Tell CourseRocket what you want to be able to do. For networking, start with the onboarding diagnostic so the
            path skips what you already know; every lesson is written from cited sources and labelled by how it was checked.
          </p>
        </header>

        <div className="lr-grid">
          <section className="cr-card lr-card" aria-labelledby="start-heading">
            <h2 id="start-heading">Start a verified course</h2>
            <p>Networking is the launch domain with a reviewed prerequisite graph. Other goals run the general pipeline and only teach from approved sources.</p>
            <form onSubmit={handleSubmit} noValidate>
              <label className="lr-field">
                <span>Goal</span>
                <textarea className="cr-input" rows={3} maxLength={500} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="e.g. Understand how a web request travels across a network" aria-describedby="goal-help" />
                <small id="goal-help" className="lr-muted">Up to 500 characters.</small>
              </label>
              <label className="lr-field">
                <span>Domain</span>
                <select className="cr-input" value={domain} onChange={(event) => setDomain(event.target.value as JobDomain)}>
                  <option value="networking">Networking for beginners (prerequisite-aware)</option>
                  <option value="general">General (single module, sources required)</option>
                </select>
              </label>
              <div className="lr-actions">
                <button type="submit" className="cr-btn cr-btn-primary" disabled={submitting} aria-busy={submitting}>
                  {submitting ? "Starting…" : "Start course job"}
                </button>
                {domain === "networking" && (
                  <button type="button" className="cr-btn cr-btn-ghost" onClick={() => navigate("/learn/onboarding")}>
                    Do the diagnostic first
                  </button>
                )}
              </div>
              {error && <div className="lr-error" role="alert">{error}</div>}
              {notice && <div className="lr-success" role="status">{notice}</div>}
            </form>
          </section>

          <section className="cr-card lr-card" aria-labelledby="more-heading">
            <h2 id="more-heading">Practice and review</h2>
            <p>Reviews are scheduled with spaced repetition after every quiz. Practice tools run entirely in your browser.</p>
            <div className="lr-actions">
              <Link className="cr-btn cr-btn-soft" to="/learn/review">Daily review queue</Link>
              <Link className="cr-btn cr-btn-ghost" to="/learn/practice">Practice tools</Link>
              <Link className="cr-btn cr-btn-ghost" to="/dashboard">Classic courses</Link>
            </div>
          </section>

          <section className="cr-card lr-card lr-span" aria-labelledby="runs-heading" aria-live="polite">
            <h2 id="runs-heading">Recent course jobs</h2>
            {runsLoading ? (
              <div className="lr-list" aria-busy="true">
                {[0, 1].map((index) => <div key={index} className="cr-skeleton" style={{ height: 64 }} />)}
              </div>
            ) : runsError ? (
              <div className="lr-notice" role="status">{runsError}</div>
            ) : runs.length === 0 ? (
              <p className="lr-muted">No jobs yet. Start one above; the run record, progress, and cost estimate appear here.</p>
            ) : (
              <ul className="lr-list" style={{ listStyle: "none", padding: 0 }}>
                {runs.map((run) => <RunRow key={run.runId} run={run} />)}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function RunRow({ run }: { run: RunView }) {
  const percent = Math.max(0, Math.min(100, Number(run.progress?.percent ?? 0)));
  const stage = typeof run.progress?.stage === "string" ? run.progress.stage : run.status;
  const note = typeof run.progress?.note === "string" ? run.progress.note : "";
  return (
    <li className="lr-run">
      <div className="lr-run-top">
        <span className="lr-run-goal">{run.goal ?? "Course job"}</span>
        <RunStatusBadge status={run.status} />
      </div>
      <div className="lr-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`Progress for ${run.goal ?? "course job"}`}>
        <i style={{ width: `${percent}%` }} />
      </div>
      <div className="lr-muted">
        {stage.replace(/-/g, " ")} · {run.domain} · est. ${run.estimatedCostUsd.toFixed(2)}
        {run.actualCostUsd > 0 ? ` · spent $${run.actualCostUsd.toFixed(4)}` : ""}
        {run.fallbackUsed ? " · fallback used" : ""}
        {run.errorCode ? ` · ${run.errorCode.replace(/_/g, " ")}` : ""}
      </div>
      {note && <div className="lr-muted">{note}</div>}
      {run.courseId && (
        <div>
          <Link className="cr-link" to={`/learn/course/${run.courseId}`}>Open course</Link>
        </div>
      )}
    </li>
  );
}

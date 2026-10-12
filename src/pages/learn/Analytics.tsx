import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../components/Navbar";
import { describeCallableError, getLearningAnalytics, type AnalyticsStats } from "../../lib/learningApi";
import "../../styles/learn.css";

export default function Analytics() {
  const [stats, setStats] = useState<AnalyticsStats | null>(null);
  const [scope, setScope] = useState<"project" | "personal">("personal");
  const [queue, setQueue] = useState<Array<{ id: string; category: string; note: string | null; created_at: string }>>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void getLearningAnalytics().then((result) => {
      setStats(result.stats);
      setScope(result.scope);
      setQueue(result.feedbackQueue);
    }).catch((err) => setError(describeCallableError(err)));
  }, []);

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <main className="lr-page" id="main">
        <header className="lr-head">
          <div className="cr-page-kicker">OUTCOMES</div>
          <h1>{scope === "project" ? "Project analytics" : "Your learning stats"}</h1>
          <p>
            Activation is unique learners who started a job. Completion is finished course runs.
            7-day return counts learners who started another job at least six days later. Cost is
            recorded spend on completed runs, not a live provider invoice.
          </p>
        </header>
        {error && <div className="lr-error" role="alert">{error}</div>}
        {!stats && !error && <div className="cr-skeleton" style={{ height: 120 }} aria-busy="true" />}
        {stats && (
          <div className="lr-kpis" role="list">
            <div className="lr-kpi" role="listitem"><b>{stats.activation}</b><span>Activation</span></div>
            <div className="lr-kpi" role="listitem"><b>{stats.completion}</b><span>Completions</span></div>
            <div className="lr-kpi" role="listitem"><b>{stats.sevenDayReturn}</b><span>7-day return</span></div>
            <div className="lr-kpi" role="listitem"><b>${stats.costPerCompletionUsd.toFixed(2)}</b><span>Cost / completion</span></div>
          </div>
        )}
        {scope === "project" && (
          <section className="cr-card lr-card" style={{ marginTop: 18 }} aria-labelledby="queue-heading">
            <h2 id="queue-heading">Lesson feedback queue</h2>
            {queue.length === 0 ? <p className="lr-muted">No new reports.</p> : (
              <table className="lr-table">
                <thead><tr><th>When</th><th>Category</th><th>Note</th></tr></thead>
                <tbody>
                  {queue.map((item) => (
                    <tr key={item.id}>
                      <td>{item.created_at.slice(0, 16).replace("T", " ")}</td>
                      <td>{item.category.replace("_", " ")}</td>
                      <td>{item.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
        <p className="lr-muted" style={{ marginTop: 18 }}><Link className="cr-link" to="/learn">Back to Learn</Link></p>
      </main>
    </div>
  );
}

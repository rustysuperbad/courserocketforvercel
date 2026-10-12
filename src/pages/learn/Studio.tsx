import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../components/Navbar";
import { scriptedStudioReply, studioIsLarge, type StudioTurn } from "../../data/scriptedDemos";
import "../../styles/learn.css";

export default function Studio() {
  const [brief, setBrief] = useState("A Python function that prints the network address for 192.168.10.42/24");
  const [turns, setTurns] = useState<StudioTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const large = useMemo(() => studioIsLarge(brief), [brief]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (large) return;
    setBusy(true);
    window.setTimeout(() => {
      setTurns(scriptedStudioReply(brief));
      setBusy(false);
    }, 400);
  }

  const code = [...turns].reverse().find((turn) => turn.code)?.code ?? "# The assistant writes here after you describe one behaviour.";

  return (
    <div className="cr-shell">
      <Navbar />
      <main className="cr-studio" id="main">
        <section className="cr-studio-pane">
          <p className="cr-kicker">Studio · local sketch</p>
          <h1 className="cr-display" style={{ fontSize: 32, margin: "8px 0 12px" }}>Build the smallest thing that proves it.</h1>
          <p style={{ color: "var(--text-2)", marginBottom: 16 }}>
            This pair-programmer runs on cached replies. It never calls OpenAI or Gemini.
            Say one behaviour. If the brief sounds like a product company, we stop and show rates.
          </p>
          <form onSubmit={handleSubmit}>
            <label className="lr-field">
              <span>What are you trying to build?</span>
              <textarea className="cr-input" rows={5} value={brief} onChange={(event) => setBrief(event.target.value)} />
            </label>
            <div className="lr-actions">
              <button type="submit" className="cr-btn cr-btn-primary" disabled={busy || large || brief.trim().length < 8}>
                {busy ? "Sketching…" : "Sketch with me"}
              </button>
              <Link className="cr-btn cr-btn-ghost" to="/learn/practice">Subnetting drills</Link>
            </div>
          </form>
          {large && (
            <div className="cr-rate" style={{ marginTop: 16 }} role="status">
              <strong className="cr-display" style={{ display: "block", marginBottom: 8 }}>This is a course studio, not an IDE company.</strong>
              <p style={{ color: "var(--text-2)", fontSize: 14 }}>
                Included: one-file exercises tied to a module. Larger briefs need a paid session pack once billing exists.
                Split the idea into a networking drill, then a capstone write-up.
              </p>
            </div>
          )}
          <ol style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            {turns.map((turn, index) => (
              <li key={index} style={{ color: turn.role === "assistant" ? "var(--text)" : "var(--text-2)", fontSize: 15 }}>
                <span className="cr-kicker">{turn.role}</span>
                <p>{turn.text}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="cr-studio-pane" aria-label="Code sketch">
          <div className="cr-instrument-head">
            <span className="cr-kicker">main.py</span>
            <span className="cr-kind">Not verified · not executed here</span>
          </div>
          <pre className="cr-code">{code}</pre>
          <p className="lr-muted" style={{ marginTop: 12 }}>Run Python in Practice → Pyodide if you want it to execute on this device.</p>
        </section>
      </main>
    </div>
  );
}

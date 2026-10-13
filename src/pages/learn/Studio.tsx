import { useMemo, useState, type FormEvent } from "react";
import Navbar from "../../components/Navbar";
import PythonSandbox from "../../components/learn/PythonSandbox";
import { scriptedStudioReply, studioIsLarge, type StudioTurn } from "../../data/scriptedDemos";
import "../../styles/learn.css";

const STARTER = `def main():
    print("What should this program do first?")

if __name__ == "__main__":
    main()
`;

export default function Studio() {
  const [brief, setBrief] = useState("A tiny Python function that prints hello and 2 + 2");
  const [turns, setTurns] = useState<StudioTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(STARTER);
  const large = useMemo(() => studioIsLarge(brief), [brief]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (large) return;
    setBusy(true);
    window.setTimeout(() => {
      const next = scriptedStudioReply(brief);
      setTurns(next);
      const sketched = [...next].reverse().find((turn) => turn.code)?.code;
      if (sketched) setCode(sketched);
      setBusy(false);
    }, 400);
  }

  return (
    <div className="cr-shell">
      <Navbar />
      <main className="cr-studio" id="main">
        <section className="cr-studio-pane cr-span-5 cr-scroll-rise">
          <p className="cr-kicker">Sandbox</p>
          <h1>Try a tiny program.</h1>
          <p className="cr-studio-lede">
            Runs in this browser. Describe one small behaviour, sketch it, then hit Run.
          </p>
          <form onSubmit={handleSubmit}>
            <label className="lr-field">
              <span>What should it do?</span>
              <textarea className="cr-input" rows={4} value={brief} onChange={(event) => setBrief(event.target.value)} />
            </label>
            <div className="lr-actions">
              <button type="submit" className="cr-btn cr-btn-primary" disabled={busy || large || brief.trim().length < 8}>
                {busy ? "Sketching…" : "Sketch"}
              </button>
            </div>
          </form>
          {large && (
            <div className="cr-rate" style={{ marginTop: 16 }} role="status">
              <p className="cr-studio-lede">Keep it to one small program. Split bigger ideas into a course instead.</p>
            </div>
          )}
          <ol className="cr-studio-turns">
            {turns.map((turn, index) => (
              <li key={index}>
                <span className="cr-kicker">{turn.role}</span>
                <p>{turn.text}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="cr-studio-pane cr-span-7 cr-scroll-rise" aria-label="Python sandbox">
          <PythonSandbox
            heading="main.py"
            code={code}
            onCodeChange={setCode}
            note="Run it here. Nothing is sent to a server."
          />
        </section>
      </main>
    </div>
  );
}

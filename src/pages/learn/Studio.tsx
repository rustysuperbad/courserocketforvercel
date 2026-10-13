import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../components/Navbar";
import PythonSandbox from "../../components/learn/PythonSandbox";
import { scriptedStudioReply, studioIsLarge, type StudioTurn } from "../../data/scriptedDemos";
import "../../styles/learn.css";

const STARTER = `def network_address(ip: str, prefix: int) -> str:
    parts = [int(p) for p in ip.split(".")]
    mask = (0xFFFFFFFF << (32 - prefix)) & 0xFFFFFFFF
    packed = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]
    net = packed & mask
    return ".".join(str((net >> s) & 255) for s in (24, 16, 8, 0))

print(network_address("192.168.10.42", 24))`;

export default function Studio() {
  const [brief, setBrief] = useState("A Python function that prints the network address for 192.168.10.42/24");
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
        <section className="cr-studio-pane cr-scroll-rise">
          <p className="cr-kicker">Studio · local sketch</p>
          <h1>Build the smallest thing that proves it.</h1>
          <p className="cr-studio-lede">
            Cached replies only — never OpenAI or Gemini. One behaviour. Oversized briefs stop here.
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
              <strong className="cr-display" style={{ display: "block", marginBottom: 8, fontSize: "var(--text-heading-2xs)" }}>This is a course studio, not an IDE company.</strong>
              <p className="cr-studio-lede">
                Included: one-file exercises tied to a module. Split a larger idea into a drill, then a capstone write-up.
              </p>
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
        <section className="cr-studio-pane cr-scroll-shift" aria-label="Python sandbox">
          <PythonSandbox
            heading="main.py"
            code={code}
            onCodeChange={setCode}
            note="Sketch, then run. Pyodide executes on this device; it cannot reach your network."
          />
        </section>
      </main>
    </div>
  );
}

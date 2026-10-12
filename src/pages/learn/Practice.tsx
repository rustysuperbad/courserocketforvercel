import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../../components/Navbar";
import { generateSubnetProblem, gradeProtocolOrder, gradeSubnetAnswer, PROTOCOL_STEPS } from "../../lib/subnetting";
import "../../styles/learn.css";

export default function Practice() {
  const [tab, setTab] = useState<"subnet" | "protocol" | "python">("subnet");
  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <main className="lr-page" id="main">
        <header className="lr-head">
          <div className="cr-page-kicker">IN-BROWSER PRACTICE</div>
          <h1>Networking drills</h1>
          <p>These tools run on your device. Subnetting and protocol order never leave the browser; Python uses Pyodide in WebAssembly.</p>
        </header>
        <div className="lr-tabs" role="tablist" aria-label="Practice tools">
          <button type="button" role="tab" aria-selected={tab === "subnet"} onClick={() => setTab("subnet")}>Subnetting</button>
          <button type="button" role="tab" aria-selected={tab === "protocol"} onClick={() => setTab("protocol")}>Packet order</button>
          <button type="button" role="tab" aria-selected={tab === "python"} onClick={() => setTab("python")}>Python sandbox</button>
        </div>
        {tab === "subnet" && <SubnetTool />}
        {tab === "protocol" && <ProtocolTool />}
        {tab === "python" && <PythonSandbox />}
        <p className="lr-muted" style={{ marginTop: 16 }}><Link className="cr-link" to="/learn">Back to Learn</Link></p>
      </main>
    </div>
  );
}

function SubnetTool() {
  const [seed, setSeed] = useState(1);
  const problem = useMemo(() => generateSubnetProblem(seed), [seed]);
  const [network, setNetwork] = useState("");
  const [broadcast, setBroadcast] = useState("");
  const [hosts, setHosts] = useState("");
  const [result, setResult] = useState("");
  return (
    <section className="cr-card lr-card" aria-labelledby="subnet-heading">
      <h2 id="subnet-heading">Subnetting trainer</h2>
      <p>{problem.prompt}</p>
      <label className="lr-field"><span>Network address</span><input className="cr-input lr-mono" value={network} onChange={(event) => setNetwork(event.target.value)} /></label>
      <label className="lr-field"><span>Broadcast address</span><input className="cr-input lr-mono" value={broadcast} onChange={(event) => setBroadcast(event.target.value)} /></label>
      <label className="lr-field"><span>Usable hosts</span><input className="cr-input lr-mono" value={hosts} onChange={(event) => setHosts(event.target.value)} inputMode="numeric" /></label>
      <div className="lr-actions">
        <button type="button" className="cr-btn cr-btn-primary" onClick={() => {
          try {
            const grade = gradeSubnetAnswer(problem, { network, broadcast, hosts });
            setResult(grade.correct ? "Correct." : `Not quite. Network ${grade.expected.network}, broadcast ${grade.expected.broadcast}, ${grade.expected.hosts} hosts.`);
          } catch (err) {
            setResult(err instanceof Error ? err.message : "Check the IPv4 values.");
          }
        }}>Check</button>
        <button type="button" className="cr-btn cr-btn-ghost" onClick={() => { setSeed(seed + 1); setNetwork(""); setBroadcast(""); setHosts(""); setResult(""); }}>New problem</button>
      </div>
      {result && <div className="lr-notice" role="status">{result}</div>}
    </section>
  );
}

function ProtocolTool() {
  const [order, setOrder] = useState(() => [...PROTOCOL_STEPS].map((step) => step.id).reverse());
  const [result, setResult] = useState("");
  function move(index: number, direction: -1 | 1) {
    const next = [...order];
    const swap = index + direction;
    if (swap < 0 || swap >= next.length) return;
    const current = next[index]!;
    next[index] = next[swap]!;
    next[swap] = current;
    setOrder(next);
  }
  return (
    <section className="cr-card lr-card" aria-labelledby="proto-heading">
      <h2 id="proto-heading">Order a web request</h2>
      <p>Put the steps of fetching https://example.com into the order they actually happen.</p>
      <ol className="lr-order">
        {order.map((id, index) => {
          const label = PROTOCOL_STEPS.find((step) => step.id === id)?.label ?? id;
          return (
            <li key={id}>
              <span>{label}</span>
              <button type="button" className="cr-btn cr-btn-ghost" onClick={() => move(index, -1)} aria-label={`Move ${label} up`}>Up</button>
              <button type="button" className="cr-btn cr-btn-ghost" onClick={() => move(index, 1)} aria-label={`Move ${label} down`}>Down</button>
            </li>
          );
        })}
      </ol>
      <div className="lr-actions">
        <button type="button" className="cr-btn cr-btn-primary" onClick={() => setResult(gradeProtocolOrder(order) ? "Correct order." : "Not yet. Think DNS, then TCP, then TLS, then HTTP.")}>Check order</button>
      </div>
      {result && <div className="lr-notice" role="status">{result}</div>}
    </section>
  );
}

function PythonSandbox() {
  const [code, setCode] = useState("print('CIDR /24 has', 2 ** 8 - 2, 'usable hosts')");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    setOutput("Loading Pyodide…");
    try {
      const mod = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs");
      const pyodide = await mod.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" });
      const result = await pyodide.runPythonAsync(code);
      setOutput(String(result ?? "done"));
    } catch (err) {
      setOutput(err instanceof Error ? err.message : "The in-browser Python runtime could not start.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="cr-card lr-card lr-sandbox" aria-labelledby="py-heading">
      <h2 id="py-heading">Python sandbox</h2>
      <p>Pyodide runs in your browser. Use it for binary/CIDR experiments; it cannot reach your local network.</p>
      <label className="lr-field">
        <span>Python</span>
        <textarea className="cr-input" value={code} onChange={(event) => setCode(event.target.value)} spellCheck={false} />
      </label>
      <div className="lr-actions">
        <button type="button" className="cr-btn cr-btn-primary" onClick={() => void run()} disabled={busy}>{busy ? "Running…" : "Run"}</button>
      </div>
      <pre aria-live="polite">{output}</pre>
    </section>
  );
}

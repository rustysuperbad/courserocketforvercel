import { useEffect, useState } from "react";

type PyodideRuntime = {
  setStdout: (handlers: { batched: (text: string) => void }) => void;
  setStderr: (handlers: { batched: (text: string) => void }) => void;
  runPythonAsync: (code: string) => Promise<unknown>;
};

let pyodidePromise: Promise<PyodideRuntime> | null = null;

async function loadPyodideRuntime(): Promise<PyodideRuntime> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      const mod = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs");
      return mod.loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" }) as Promise<PyodideRuntime>;
    })();
  }
  try {
    return await pyodidePromise;
  } catch (error) {
    pyodidePromise = null;
    throw error;
  }
}

type Props = {
  code: string;
  onCodeChange?: (value: string) => void;
  heading?: string;
  note?: string;
  editable?: boolean;
};

export default function PythonSandbox({
  code,
  onCodeChange,
  heading = "Python",
  note = "Runs in this browser. Nothing is sent to a server.",
  editable = true,
}: Props) {
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOutput("");
  }, [code]);

  async function run() {
    setBusy(true);
    setOutput("Loading runtime…");
    try {
      const pyodide = await loadPyodideRuntime();
      let captured = "";
      pyodide.setStdout({ batched: (text) => { captured += text; } });
      pyodide.setStderr({ batched: (text) => { captured += text; } });
      const result = await pyodide.runPythonAsync(code);
      const printed = captured.trim();
      const value = result === undefined || result === null ? "" : String(result);
      setOutput([printed, value && value !== "None" ? value : ""].filter(Boolean).join("\n") || "(no output)");
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "The in-browser Python runtime could not start.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="lr-sandbox" aria-labelledby="py-heading">
      <div className="cr-instrument-head">
        <div>
          <p className="cr-kicker">Sandbox</p>
          <h2 id="py-heading">{heading}</h2>
        </div>
        <span className="cr-kind">On this device</span>
      </div>
      <p className="lr-sandbox-note">{note}</p>
      <label className="lr-field">
        <span>Program</span>
        <textarea
          className="cr-input lr-mono"
          value={code}
          onChange={(event) => onCodeChange?.(event.target.value)}
          spellCheck={false}
          readOnly={!editable}
          rows={14}
        />
      </label>
      <div className="lr-actions">
        <button type="button" className="cr-btn cr-btn-primary" onClick={() => void run()} disabled={busy || !code.trim()}>
          {busy ? "Running…" : "Run"}
        </button>
      </div>
      <pre className="lr-sandbox-out" aria-live="polite">{output || "Output appears here."}</pre>
    </section>
  );
}

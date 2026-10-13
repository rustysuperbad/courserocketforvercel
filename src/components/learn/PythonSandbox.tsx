import { useEffect, useId, useState } from "react";
import {
  SANDBOX_LANGUAGES,
  SANDBOX_STARTERS,
  type SandboxLangId,
} from "./sandboxLanguages";

type PyodideRuntime = {
  setStdout: (handlers: { batched: (text: string) => void }) => void;
  setStderr: (handlers: { batched: (text: string) => void }) => void;
  runPythonAsync: (code: string) => Promise<unknown>;
};

let pyodidePromise: Promise<PyodideRuntime> | null = null;
let sqlPromise: Promise<SqlModule> | null = null;
let sucrasePromise: Promise<{ transform: (code: string, opts: { transforms: string[] }) => { code: string } }> | null = null;

type SqlDatabase = {
  exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>;
  close: () => void;
};
type SqlModule = { Database: new () => SqlDatabase };

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

async function loadSucrase() {
  if (!sucrasePromise) {
    sucrasePromise = import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/sucrase@3.35.0/+esm") as Promise<{
      transform: (code: string, opts: { transforms: string[] }) => { code: string };
    }>;
  }
  try {
    return await sucrasePromise;
  } catch (error) {
    sucrasePromise = null;
    throw error;
  }
}

async function loadSql(): Promise<SqlModule> {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const w = window as Window & { initSqlJs?: (opts: { locateFile: (file: string) => string }) => Promise<SqlModule> };
      if (typeof w.initSqlJs !== "function") {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/sql-wasm.js";
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("The in-browser SQL runtime could not start."));
          document.head.appendChild(script);
        });
      }
      if (typeof w.initSqlJs !== "function") {
        throw new Error("The in-browser SQL runtime could not start.");
      }
      return w.initSqlJs({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/sql.js@1.11.0/dist/${file}`,
      });
    })();
  }
  try {
    return await sqlPromise;
  } catch (error) {
    sqlPromise = null;
    throw error;
  }
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function runJavaScript(code: string): Promise<string> {
  return new Promise((resolve) => {
    const id = "cr-sb-" + Math.random().toString(36).slice(2);
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.display = "none";
    let settled = false;
    const finish = (output: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      iframe.remove();
      resolve(output);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.source !== "cr-sandbox" || event.data?.id !== id) return;
      finish(String(event.data.output || "(no output)"));
    };
    const timer = window.setTimeout(() => finish("Timed out after 4 seconds."), 4000);
    window.addEventListener("message", onMessage);
    iframe.srcdoc = `<!doctype html><script>
      const logs = [];
      const capture = (fn) => (...args) => {
        logs.push(args.map((value) => {
          try { return typeof value === "string" ? value : JSON.stringify(value); }
          catch { return String(value); }
        }).join(" "));
        try { fn.apply(console, args); } catch {}
      };
      console.log = capture(console.log);
      console.info = capture(console.info);
      console.warn = capture(console.warn);
      console.error = capture(console.error);
      window.onerror = (msg) => { logs.push(String(msg)); };
      try {
        const result = (0, eval)(${JSON.stringify(code)});
        if (result !== undefined) logs.push(typeof result === "string" ? result : JSON.stringify(result));
      } catch (error) {
        logs.push(error && error.message ? error.message : String(error));
      }
      parent.postMessage({ source: "cr-sandbox", id: ${JSON.stringify(id)}, output: logs.join("\\n") || "(no output)" }, "*");
    <\/script>`;
    document.body.appendChild(iframe);
  });
}

function formatSqlTables(tables: Array<{ columns: string[]; values: unknown[][] }>): string {
  if (!tables.length) return "(statement finished, no rows)";
  return tables.map((table) => {
    const header = table.columns.join(" | ");
    const rows = table.values.map((row) => row.map((cell) => stringifyValue(cell)).join(" | "));
    return [header, "-".repeat(Math.max(header.length, 3)), ...rows].join("\n");
  }).join("\n\n");
}

type Props = {
  code: string;
  onCodeChange?: (value: string) => void;
  language?: SandboxLangId;
  onLanguageChange?: (value: SandboxLangId) => void;
  heading?: string;
  note?: string;
  editable?: boolean;
  compact?: boolean;
  showLanguageSelect?: boolean;
};

export default function PythonSandbox({
  code,
  onCodeChange,
  language: languageProp,
  onLanguageChange,
  heading,
  note = "Runs in this browser. Nothing is sent to a server.",
  editable = true,
  compact = false,
  showLanguageSelect = true,
}: Props) {
  const headingId = useId();
  const [internalLang, setInternalLang] = useState<SandboxLangId>("python");
  const language = languageProp ?? internalLang;
  const meta = SANDBOX_LANGUAGES.find((item) => item.id === language) || SANDBOX_LANGUAGES[0];
  const [output, setOutput] = useState("");
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOutput("");
    setPreview("");
  }, [code, language]);

  function setLanguage(next: SandboxLangId) {
    if (onLanguageChange) onLanguageChange(next);
    else {
      setInternalLang(next);
      onCodeChange?.(SANDBOX_STARTERS[next]);
    }
  }

  async function run() {
    setBusy(true);
    setOutput("Loading runtime…");
    setPreview("");
    try {
      if (language === "python") {
        const pyodide = await loadPyodideRuntime();
        let captured = "";
        pyodide.setStdout({ batched: (text) => { captured += text; } });
        pyodide.setStderr({ batched: (text) => { captured += text; } });
        const result = await pyodide.runPythonAsync(code);
        const printed = captured.trim();
        const value = result === undefined || result === null ? "" : String(result);
        setOutput([printed, value && value !== "None" ? value : ""].filter(Boolean).join("\n") || "(no output)");
        return;
      }
      if (language === "javascript") {
        setOutput(await runJavaScript(code));
        return;
      }
      if (language === "typescript") {
        const sucrase = await loadSucrase();
        const js = sucrase.transform(code, { transforms: ["typescript"] }).code;
        setOutput(await runJavaScript(js));
        return;
      }
      if (language === "sql") {
        const SQL = await loadSql();
        const db = new SQL.Database();
        try {
          const tables = db.exec(code);
          setOutput(formatSqlTables(tables));
        } finally {
          db.close();
        }
        return;
      }
      setPreview(code);
      setOutput("Preview updated.");
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "The in-browser runtime could not start.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={"lr-sandbox" + (compact ? " is-compact" : "")} aria-labelledby={headingId}>
      <div className="cr-instrument-head">
        <div>
          <p className="cr-kicker">Sandbox</p>
          <h2 id={headingId}>{heading || meta.file}</h2>
        </div>
        {showLanguageSelect ? (
          <label className="lr-sandbox-lang">
            <span className="cr-sr-only">Language</span>
            <select
              className="cr-input"
              value={language}
              onChange={(event) => setLanguage(event.target.value as SandboxLangId)}
              aria-label="Sandbox language"
            >
              {SANDBOX_LANGUAGES.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
        ) : (
          <span className="cr-kind">On this device</span>
        )}
      </div>
      {note ? <p className="lr-sandbox-note">{note}</p> : null}
      <label className="lr-field">
        <span>Program</span>
        <textarea
          className="cr-input lr-mono"
          value={code}
          onChange={(event) => onCodeChange?.(event.target.value)}
          spellCheck={false}
          readOnly={!editable}
          rows={compact ? 8 : 14}
        />
      </label>
      <div className="lr-actions">
        <button type="button" className="cr-btn cr-btn-primary" onClick={() => void run()} disabled={busy || !code.trim()}>
          {busy ? "Running…" : "Run"}
        </button>
        <span className="lr-sandbox-hint">Runs here. Nothing is sent out.</span>
      </div>
      {language === "html" && preview ? (
        <iframe className="lr-sandbox-preview" title="HTML preview" sandbox="allow-scripts" srcDoc={preview} />
      ) : (
        <pre className="lr-sandbox-out" aria-live="polite">{output || "Output appears here."}</pre>
      )}
    </section>
  );
}

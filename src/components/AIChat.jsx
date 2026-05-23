import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { askGroq, buildSystemPrompt } from "../lib/groqChat";

const SUGGESTIONS = [
  "Explain this module in simple terms",
  "Give me a real-world example",
  "What are the key things to remember?",
  "Quiz me on this topic",
];

// Very lightweight markdown renderer: handles **bold**, `code`, ```blocks```, and bullet lines.
function RenderMessage({ text }) {
  const parts = [];
  const lines = text.split("\n");
  let inCode = false;
  let codeLines = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      if (inCode) {
        parts.push(
          <pre key={key++} style={md.codeBlock}>
            <code>{codeLines.join("\n")}</code>
          </pre>
        );
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    const isBullet = /^(\s*[-*•]|\d+\.)\s/.test(line);
    const rendered = renderInline(line.replace(/^(\s*[-*•]|\d+\.)\s/, ""), key++);
    if (isBullet) {
      parts.push(
        <div key={key++} style={md.bullet}>
          <span style={md.bulletDot}>·</span>
          <span>{rendered}</span>
        </div>
      );
    } else if (line.trim() === "") {
      parts.push(<div key={key++} style={{ height: 6 }} />);
    } else {
      parts.push(<div key={key++}>{rendered}</div>);
    }
  }
  if (inCode && codeLines.length > 0) {
    parts.push(
      <pre key={key++} style={md.codeBlock}>
        <code>{codeLines.join("\n")}</code>
      </pre>
    );
  }
  return <div style={md.wrap}>{parts}</div>;
}

function renderInline(text, baseKey) {
  const result = [];
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`)/g;
  let last = 0;
  let m;
  let k = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) result.push(<span key={baseKey + "_" + k++}>{text.slice(last, m.index)}</span>);
    if (m[2]) result.push(<strong key={baseKey + "_" + k++} style={md.bold}>{m[2]}</strong>);
    else if (m[3]) result.push(<code key={baseKey + "_" + k++} style={md.inlineCode}>{m[3]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) result.push(<span key={baseKey + "_" + k++}>{text.slice(last)}</span>);
  return result.length > 0 ? result : text;
}

const md = {
  wrap: { fontSize: 13.5, lineHeight: 1.65, color: "var(--text)" },
  bold: { color: "var(--text)", fontWeight: 700 },
  inlineCode: {
    background: "rgba(99,102,241,0.12)",
    color: "var(--primary-2)",
    padding: "1px 5px",
    borderRadius: 5,
    fontFamily: "ui-monospace, monospace",
    fontSize: 12.5,
  },
  codeBlock: {
    background: "rgba(0,0,0,0.35)",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    padding: "10px 12px",
    fontFamily: "ui-monospace, monospace",
    fontSize: 12,
    color: "#a5b4fc",
    overflowX: "auto",
    whiteSpace: "pre",
    margin: "6px 0",
  },
  bullet: {
    display: "flex",
    gap: 8,
    paddingLeft: 4,
    marginTop: 2,
  },
  bulletDot: {
    color: "var(--primary-2)",
    fontWeight: 700,
    flexShrink: 0,
    marginTop: 1,
  },
};

export default function AIChat({ open, onOpen, onClose, course, module: currentModule }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  const systemPrompt = useMemo(
    () =>
      buildSystemPrompt({
        courseTitle: course?.title,
        moduleTitle: currentModule?.title,
        moduleSummary: currentModule?.summary,
        concepts: currentModule?.concepts,
        lessons: currentModule?.lessons,
      }),
    [course?.title, currentModule?.title, currentModule?.summary, currentModule?.concepts, currentModule?.lessons]
  );

  useEffect(() => {
    setMessages([]);
    setError("");
    setInput("");
  }, [currentModule?.title]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Auto-resize textarea.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [input]);

  // Focus textarea when panel opens.
  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 280);
    }
  }, [open]);

  const send = useCallback(
    async (forced) => {
      const text = (forced ?? input).trim();
      if (!text || loading) return;
      setError("");
      const next = [...messages, { role: "user", content: text }];
      setMessages(next);
      setInput("");
      setLoading(true);
      try {
        const reply = await askGroq([
          { role: "system", content: systemPrompt },
          ...next.slice(-10),
        ]);
        setMessages((m) => [...m, { role: "assistant", content: reply }]);
      } catch (e) {
        const msg = String(e?.message || "");
        if (msg.includes("429")) {
          setError("Rate-limited right now. Try again in ~20 seconds.");
        } else {
          setError(msg || "Couldn't get a response. Please try again.");
        }
      } finally {
        setLoading(false);
      }
    },
    [input, loading, messages, systemPrompt]
  );

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <>
      <style>{`
        .ai-fab-launch:hover {
          transform: translateY(-2px);
          box-shadow:
            0 16px 52px rgba(0,0,0,0.4),
            0 0 0 1px rgba(129,140,248,0.25),
            inset 0 1px 0 rgba(255,255,255,0.1),
            inset 0 -1px 0 rgba(0,0,0,0.22);
          color: rgba(248,250,252,0.96);
        }
        .ai-fab-launch:active {
          transform: translateY(0);
        }
        @keyframes ai-bounce {
          0%, 100% { transform: translateY(0); opacity: 0.35; }
          50% { transform: translateY(-4px); opacity: 1; }
        }
        .ai-suggestion:hover {
          background: rgba(99,102,241,0.1) !important;
          border-color: rgba(99,102,241,0.3) !important;
          color: var(--text) !important;
        }
        .ai-bubble-user { animation: cr-fade-up 180ms ease both; }
        .ai-bubble-ai { animation: cr-fade-up 200ms ease both; }
        @keyframes cr-fade-up {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Backdrop */}
      <div
        style={{
          ...p.backdrop,
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        style={{
          ...p.panel,
          transform: open ? "translateX(0)" : "translateX(110%)",
        }}
        aria-hidden={!open}
        aria-label="AI Assistant"
      >
        {/* Header */}
        <div style={p.head}>
          <div style={p.headLeft}>
            <div style={p.aiBadge}>✦</div>
            <div>
              <div style={p.headTitle}>AI Assistant</div>
              <div style={p.headSub}>
                {currentModule?.title
                  ? currentModule.title.length > 32
                    ? currentModule.title.slice(0, 32) + "…"
                    : currentModule.title
                  : "Ask me anything about this course"}
              </div>
            </div>
          </div>
          <button style={p.closeBtn} onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Context strip */}
        {currentModule?.concepts?.length > 0 && (
          <div style={p.contextStrip}>
            <span style={p.contextLabel}>Context:</span>
            {currentModule.concepts.slice(0, 4).map((c) => (
              <span key={c} style={p.contextChip}>{c}</span>
            ))}
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} style={p.body}>
          {messages.length === 0 && (
            <div style={p.empty} className="cr-fade">
              <div style={p.emptyIcon}>✦</div>
              <div style={p.emptyTitle}>Have a question?</div>
              <div style={p.emptyText}>
                I know this course and the current module. Ask anything or try a suggestion below.
              </div>
              <div style={p.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    className="ai-suggestion"
                    style={p.suggestion}
                    onClick={() => send(s)}
                    disabled={loading}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={m.role === "user" ? "ai-bubble-user" : "ai-bubble-ai"}
              style={{
                ...p.bubble,
                ...(m.role === "user" ? p.userBubble : p.aiBubble),
              }}
            >
              {m.role === "assistant" && (
                <div style={p.aiBubbleTag}>✦ AI</div>
              )}
              {m.role === "assistant"
                ? <RenderMessage text={m.content} />
                : <div style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.55 }}>{m.content}</div>}
            </div>
          ))}

          {loading && (
            <div className="ai-bubble-ai" style={{ ...p.bubble, ...p.aiBubble }}>
              <div style={p.aiBubbleTag}>✦ AI</div>
              <div style={p.typingDots}>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    style={{
                      ...p.dot,
                      animationDelay: i * 130 + "ms",
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {error && (
            <div style={p.errorBox} className="cr-fade">
              <span style={{ color: "var(--danger)", marginRight: 6 }}>⚠</span>
              {error}
            </div>
          )}
        </div>

        {/* Clear history */}
        {messages.length > 0 && !loading && (
          <div style={p.clearRow}>
            <button style={p.clearBtn} onClick={() => { setMessages([]); setError(""); }}>
              Clear conversation
            </button>
          </div>
        )}

        {/* Input */}
        <div style={p.inputBar}>
          <textarea
            ref={textareaRef}
            style={p.textarea}
            placeholder={loading ? "Thinking…" : "Ask about this module… (Enter to send)"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={loading}
            rows={1}
          />
          <button
            className="cr-btn cr-btn-primary"
            style={{
              ...p.sendBtn,
              opacity: !input.trim() || loading ? 0.45 : 1,
            }}
            disabled={!input.trim() || loading}
            onClick={() => send()}
          >
            {loading ? (
              <span style={p.sendSpinner} />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </aside>

      {/* Floating action button */}
        {!open && (
        <button
          type="button"
          className="ai-fab-launch"
          style={p.fab}
          onClick={onOpen}
          title="Open AI Assistant"
        >
          <span style={{ fontSize: 14.5, lineHeight: 1, opacity: 0.9 }}>✦</span>
          <span>Ask AI</span>
        </button>
      )}
    </>
  );
}

const p = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(5,8,16,0.5)",
    backdropFilter: "blur(3px)",
    transition: "opacity 220ms ease",
    zIndex: 90,
  },
  panel: {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    width: "min(440px, 94vw)",
    background: "var(--surface)",
    borderLeft: "1px solid var(--border-strong)",
    boxShadow: "-8px 0 60px rgba(0,0,0,0.45)",
    display: "flex",
    flexDirection: "column",
    transition: "transform 300ms cubic-bezier(0.22, 1, 0.36, 1)",
    zIndex: 100,
  },

  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 16px",
    borderBottom: "1px solid var(--border)",
    background: "var(--surface-2)",
  },
  headLeft: { display: "flex", alignItems: "center", gap: 11 },
  aiBadge: {
    width: 38,
    height: 38,
    borderRadius: 11,
    background: "linear-gradient(135deg, var(--primary), var(--accent))",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 16,
    flexShrink: 0,
    boxShadow: "0 4px 12px var(--primary-ring)",
  },
  headTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 15,
    color: "var(--text)",
    fontWeight: 700,
    marginBottom: 1,
  },
  headSub: {
    fontSize: 11.5,
    color: "var(--text-3)",
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--border)",
    color: "var(--text-2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },

  contextStrip: {
    padding: "7px 16px",
    background: "rgba(99,102,241,0.05)",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 5,
  },
  contextLabel: {
    fontSize: 10.5,
    color: "var(--text-3)",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    fontWeight: 600,
    marginRight: 2,
  },
  contextChip: {
    fontSize: 11,
    color: "var(--primary-2)",
    background: "var(--primary-soft)",
    border: "1px solid rgba(99,102,241,0.25)",
    padding: "2px 8px",
    borderRadius: 999,
  },

  body: {
    flex: 1,
    overflowY: "auto",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  empty: {
    padding: "4px 0 8px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  emptyIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    background: "linear-gradient(135deg, var(--primary), var(--accent))",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    marginBottom: 2,
  },
  emptyTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 17,
    color: "var(--text)",
    fontWeight: 700,
  },
  emptyText: {
    fontSize: 13,
    color: "var(--text-2)",
    lineHeight: 1.55,
  },
  suggestions: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginTop: 4,
  },
  suggestion: {
    textAlign: "left",
    background: "rgba(255,255,255,0.025)",
    border: "1px solid var(--border)",
    color: "var(--text-2)",
    fontSize: 12.5,
    padding: "9px 13px",
    borderRadius: 9,
    cursor: "pointer",
    transition: "all 120ms ease",
    lineHeight: 1.4,
  },

  bubble: {
    padding: "10px 13px 11px",
    borderRadius: 12,
    maxWidth: "94%",
    wordBreak: "break-word",
  },
  userBubble: {
    background: "var(--primary-soft)",
    border: "1px solid rgba(99,102,241,0.3)",
    alignSelf: "flex-end",
    borderBottomRightRadius: 4,
  },
  aiBubble: {
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    alignSelf: "flex-start",
    borderBottomLeftRadius: 4,
    maxWidth: "100%",
  },
  aiBubbleTag: {
    fontSize: 10,
    fontWeight: 700,
    color: "var(--primary-2)",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 5,
  },

  typingDots: {
    display: "flex",
    gap: 5,
    padding: "3px 0",
    alignItems: "center",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--text-2)",
    display: "inline-block",
    animation: "ai-bounce 1s infinite ease-in-out",
  },

  errorBox: {
    fontSize: 12.5,
    color: "#fca5a5",
    background: "rgba(239,68,68,0.08)",
    border: "1px solid rgba(239,68,68,0.25)",
    borderRadius: 9,
    padding: "9px 12px",
    alignSelf: "stretch",
  },

  clearRow: {
    display: "flex",
    justifyContent: "center",
    padding: "4px 16px 6px",
    borderTop: "1px solid var(--border)",
  },
  clearBtn: {
    background: "none",
    border: "none",
    color: "var(--text-3)",
    fontSize: 12,
    cursor: "pointer",
    padding: "4px 8px",
  },

  inputBar: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    padding: "10px 14px 14px",
    borderTop: "1px solid var(--border)",
    background: "var(--surface-2)",
  },
  textarea: {
    flex: 1,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "10px 12px",
    color: "var(--text)",
    fontSize: 13.5,
    outline: "none",
    resize: "none",
    lineHeight: 1.5,
    maxHeight: 120,
    overflowY: "auto",
    fontFamily: "var(--font-sans)",
    transition: "border-color 120ms ease, box-shadow 120ms ease",
  },
  sendBtn: {
    width: 38,
    height: 38,
    padding: 0,
    borderRadius: 10,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "opacity 120ms ease",
  },
  sendSpinner: {
    display: "inline-block",
    width: 14,
    height: 14,
    borderRadius: "50%",
    border: "2px solid rgba(255,255,255,0.25)",
    borderTopColor: "#fff",
    animation: "spin 0.8s linear infinite",
  },

  fab: {
    position: "fixed",
    right: 24,
    bottom: 26,
    padding: "10px 18px",
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 999,
    zIndex: 80,
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "var(--font-display)",
    letterSpacing: "0.03em",
    color: "rgba(237,241,251,0.92)",
    background: "linear-gradient(155deg, rgba(28,34,54,0.62), rgba(18,23,41,0.48))",
    border: "1px solid rgba(255,255,255,0.1)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    cursor: "pointer",
    boxShadow:
      "0 12px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.2)",
    transition: "transform 180ms cubic-bezier(0.22,1,0.36,1), box-shadow 180ms ease, opacity 180ms ease",
  },
};

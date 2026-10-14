import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { buildTutorSystemPrompt, requestCourseTutor } from "../lib/courseAiApi";

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
  wrap: { fontSize: 15, lineHeight: 1.55, color: "var(--text-1)", fontWeight: 300 },
  bold: { color: "var(--text-1)", fontWeight: 600 },
  inlineCode: {
    background: "var(--surface-2)",
    color: "var(--text-1)",
    padding: "1px 6px",
    borderRadius: 6,
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    border: "var(--hairline)",
  },
  codeBlock: {
    background: "var(--code-bg)",
    border: "none",
    borderRadius: "var(--radius-nested)",
    padding: "12px 14px",
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    color: "var(--code-fg)",
    overflowX: "auto",
    whiteSpace: "pre",
    margin: "8px 0",
  },
  bullet: {
    display: "flex",
    gap: 8,
    paddingLeft: 4,
    marginTop: 2,
  },
  bulletDot: {
    color: "var(--emphasis)",
    fontWeight: 600,
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
      buildTutorSystemPrompt({
        courseTitle: course?.title,
        moduleTitle: currentModule?.title,
        moduleSummary: currentModule?.summary,
        concepts: currentModule?.concepts,
        lessons: currentModule?.lessons,
        sources: currentModule?.sources,
      }),
    [course?.title, currentModule?.title, currentModule?.summary, currentModule?.concepts, currentModule?.lessons, currentModule?.sources]
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
        const reply = await requestCourseTutor({ systemPrompt, messages: next.slice(-10) });
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
          background: var(--text-1) !important;
        }
        .ai-fab-launch:active {
          transform: scale(0.98);
        }
        .ai-fab-launch:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 3px;
        }
        @keyframes ai-bounce {
          0%, 100% { transform: translateY(0); opacity: 0.35; }
          50% { transform: translateY(-3px); opacity: 1; }
        }
        .ai-suggestion:hover {
          background: var(--surface-2) !important;
          color: var(--text-1) !important;
        }
        .ai-suggestion:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .cr-ai-chat-panel textarea:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-ring);
        }
        .ai-bubble-user { animation: cr-fade-up 180ms var(--ease-out) both; }
        .ai-bubble-ai { animation: cr-fade-up 200ms var(--ease-out) both; }
        @keyframes cr-fade-up {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ai-bubble-user, .ai-bubble-ai, .ai-fab-launch { animation: none !important; transform: none !important; }
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
        className="cr-ai-chat-panel"
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
            <div style={p.aiBadge} aria-hidden="true">Ask</div>
            <div>
              <div style={p.headTitle}>Ask</div>
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
              <div style={p.emptyKicker}>Ask</div>
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
                <div style={p.aiBubbleTag}>Reply</div>
              )}
              {m.role === "assistant"
                ? <RenderMessage text={m.content} />
                : <div style={{ fontSize: 15, color: "inherit", lineHeight: 1.55, fontWeight: 300 }}>{m.content}</div>}
            </div>
          ))}

          {loading && (
            <div className="ai-bubble-ai" style={{ ...p.bubble, ...p.aiBubble }}>
              <div style={p.aiBubbleTag}>Reply</div>
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
              <span style={{ color: "var(--danger)", marginRight: 6 }}>Error</span>
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
          <span>Ask</span>
        </button>
      )}
    </>
  );
}

const p = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(10, 14, 26, 0.28)",
    transition: "opacity var(--dur-2) var(--ease-out)",
    zIndex: 90,
  },
  panel: {
    position: "fixed",
    top: 12,
    right: 12,
    bottom: 12,
    width: "min(420px, calc(100vw - 24px))",
    background: "var(--surface)",
    border: "var(--hairline)",
    borderRadius: "var(--radius)",
    boxShadow: "none",
    display: "flex",
    flexDirection: "column",
    transition: "transform var(--dur-3) var(--ease-out)",
    zIndex: 100,
    overflow: "hidden",
  },

  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "18px 20px",
    borderBottom: "var(--hairline)",
    background: "var(--surface)",
  },
  headLeft: { display: "flex", alignItems: "center", gap: 12 },
  aiBadge: {
    width: 38,
    height: 38,
    borderRadius: "var(--radius-nested)",
    background: "var(--ink)",
    color: "var(--canvas)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "var(--track-label)",
    textTransform: "uppercase",
    flexShrink: 0,
  },
  headTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 18,
    color: "var(--text-1)",
    fontWeight: 400,
    letterSpacing: "-0.03em",
    marginBottom: 2,
  },
  headSub: {
    fontSize: 13,
    color: "var(--text-3)",
    fontWeight: 300,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: "var(--radius-nested)",
    background: "var(--surface-2)",
    border: "var(--hairline)",
    color: "var(--text-2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },

  contextStrip: {
    padding: "10px 20px",
    background: "var(--canvas)",
    borderBottom: "var(--hairline)",
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  contextLabel: {
    fontSize: 12,
    color: "var(--text-3)",
    letterSpacing: "var(--track-label)",
    textTransform: "uppercase",
    fontWeight: 600,
    marginRight: 4,
  },
  contextChip: {
    fontSize: 12,
    color: "var(--text-2)",
    background: "var(--surface)",
    border: "var(--hairline)",
    padding: "3px 10px",
    borderRadius: "var(--radius-pill)",
  },

  body: {
    flex: 1,
    overflowY: "auto",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    background: "var(--canvas)",
  },
  empty: {
    padding: "8px 0",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  emptyKicker: {
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "var(--track-label)",
    textTransform: "uppercase",
    color: "var(--emphasis)",
  },
  emptyTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 28,
    color: "var(--text-1)",
    fontWeight: 400,
    letterSpacing: "-0.04em",
  },
  emptyText: {
    fontSize: 16,
    color: "var(--text-2)",
    lineHeight: 1.5,
    fontWeight: 300,
  },
  suggestions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginTop: 8,
  },
  suggestion: {
    textAlign: "left",
    background: "var(--surface)",
    border: "var(--hairline)",
    color: "var(--text-2)",
    fontSize: 14,
    padding: "12px 14px",
    borderRadius: "var(--radius-nested)",
    cursor: "pointer",
    transition: "background var(--dur-1) var(--ease-out)",
    lineHeight: 1.45,
  },

  bubble: {
    padding: "12px 16px",
    borderRadius: "var(--radius-nested)",
    maxWidth: "94%",
    wordBreak: "break-word",
  },
  userBubble: {
    background: "var(--ink)",
    color: "var(--canvas)",
    border: "none",
    alignSelf: "flex-end",
  },
  aiBubble: {
    background: "var(--surface)",
    border: "var(--hairline)",
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  aiBubbleTag: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--emphasis)",
    letterSpacing: "var(--track-label)",
    textTransform: "uppercase",
    marginBottom: 6,
  },

  typingDots: {
    display: "flex",
    gap: 5,
    padding: "3px 0",
    alignItems: "center",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--text-3)",
    display: "inline-block",
    animation: "ai-bounce 1s infinite ease-in-out",
  },

  errorBox: {
    fontSize: 14,
    color: "var(--danger)",
    background: "var(--surface)",
    border: "var(--hairline)",
    borderRadius: "var(--radius-nested)",
    padding: "10px 14px",
    alignSelf: "stretch",
  },

  clearRow: {
    display: "flex",
    justifyContent: "center",
    padding: "6px 16px",
    borderTop: "var(--hairline)",
    background: "var(--surface)",
  },
  clearBtn: {
    background: "none",
    border: "none",
    color: "var(--text-3)",
    fontSize: 13,
    cursor: "pointer",
    padding: "6px 10px",
  },

  inputBar: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    padding: "14px 16px 16px",
    borderTop: "var(--hairline)",
    background: "var(--surface)",
  },
  textarea: {
    flex: 1,
    background: "var(--canvas)",
    border: "var(--hairline)",
    borderRadius: "var(--radius-nested)",
    padding: "10px 12px",
    color: "var(--text-1)",
    fontSize: 15,
    outline: "none",
    resize: "none",
    lineHeight: 1.5,
    maxHeight: 120,
    overflowY: "auto",
    fontFamily: "var(--font-sans)",
    fontWeight: 300,
    transition: "border-color var(--dur-1) var(--ease-out), box-shadow var(--dur-1) var(--ease-out)",
  },
  sendBtn: {
    width: 40,
    height: 40,
    padding: 0,
    borderRadius: "var(--radius-pill)",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "opacity var(--dur-1) var(--ease-out)",
  },
  sendSpinner: {
    display: "inline-block",
    width: 14,
    height: 14,
    borderRadius: "50%",
    border: "2px solid rgba(243, 245, 249, 0.35)",
    borderTopColor: "var(--canvas)",
    animation: "spin 0.8s linear infinite",
  },

  fab: {
    position: "fixed",
    right: 24,
    bottom: 26,
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "var(--track-label)",
    textTransform: "uppercase",
    borderRadius: "var(--radius-pill)",
    zIndex: 80,
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "var(--font-sans)",
    color: "var(--canvas)",
    background: "var(--ink)",
    border: "none",
    cursor: "pointer",
    boxShadow: "none",
    transition: "background var(--dur-2) var(--ease-out)",
  },
};

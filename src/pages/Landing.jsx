import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import HeroInstrument from "../components/HeroInstrument";

const suggestions = [
  "Trace a web request across a network",
  "Build a chess engine in Python",
  "Explain DNS before TCP",
];

export default function Landing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [topic, setTopic] = useState("Trace a web request across a network");

  const handleStart = () => {
    const value = topic.trim();
    if (!value) {
      navigate(user ? "/learn" : "/login?signup=1");
      return;
    }
    if (user) navigate("/learn");
    else navigate("/login?signup=1&topic=" + encodeURIComponent(value));
  };

  return (
    <div className="cr-landing cr-shell">
      <Navbar />
      <main id="main">
        <section className="cr-landing-hero">
          <div>
            <p className="cr-kicker">Start from what you already know</p>
            <h1 className="cr-landing-title cr-display">
              A course that<br />begins at <em>your</em> edge.
            </h1>
            <p className="cr-landing-subtitle">
              Type a goal. Watch a path assemble: lessons, a quiz, a paper, a video — from attributed sources, labelled honestly.
              Networking for beginners is the launch domain.
            </p>
            <div className="cr-hero-form">
              <label className="cr-sr-only" htmlFor="landing-topic">What do you want to be able to do?</label>
              <input
                id="landing-topic"
                className="cr-input"
                placeholder="e.g. Trace a web request across a network"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleStart()}
              />
              <button type="button" className="cr-btn cr-btn-primary cr-hero-submit" onClick={handleStart}>
                {user ? "Open Learn" : "Continue"}
              </button>
            </div>
            <div className="cr-suggestion-list" style={{ marginTop: 14 }}>
              {suggestions.map((item) => (
                <button key={item} type="button" className="cr-suggestion-chip" onClick={() => setTopic(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
          <HeroInstrument goal={topic} />
        </section>

        <section className="cr-proof" aria-label="How a path is built">
          <span>Goal</span>
          <span>Prerequisite graph</span>
          <span>Cited lessons</span>
          <span>Practice until it sticks</span>
        </section>

        <section className="cr-editorial">
          <div>
            <p className="cr-kicker">Not a chat dump</p>
            <h2 className="cr-display" style={{ fontSize: 36, margin: "10px 0 12px" }}>The wait is the product.</h2>
            <p style={{ color: "var(--text-2)" }}>
              Generation is staged: read your level, retrieve sources, write only from passages, verify claims, then quiz keys.
              If a line is unsupported it stays marked as a draft.
            </p>
          </div>
          <div className="cr-split-list">
            {[
              ["01", "Diagnostic first", "Say what you know. The path shortens or skips those nodes."],
              ["02", "Sources with licenses", "Chunks carry title, URL, attribution. No invented paragraphs."],
              ["03", "Studio, on a leash", "Build the capstone in the browser. Oversized apps hit a rate wall, on purpose."],
            ].map(([n, title, copy]) => (
              <article key={n} className="cr-split-row">
                <span className="cr-kicker">{n}</span>
                <div>
                  <h3 className="cr-display" style={{ fontSize: 20, marginBottom: 6 }}>{title}</h3>
                  <p style={{ color: "var(--text-2)", fontSize: 15 }}>{copy}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="cr-footer">
        <div className="cr-footer-inner">
          <span className="cr-brand-word">course<span>rocket</span></span>
          <span>Cited paths. Honest labels.</span>
          <div className="cr-footer-links">
            <Link to="/privacy">Privacy</Link>
            <Link to={user ? "/learn" : "/login"}>{user ? "Learn" : "Sign in"}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

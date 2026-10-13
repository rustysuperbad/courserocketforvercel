import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import HeroInstrument from "../components/HeroInstrument";

const suggestions = [
  { label: "Build a chess engine in Python", example: false },
  { label: "Become fluent in Spanish", example: false },
  { label: "How a song is written", example: true },
];

export default function Landing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [topic, setTopic] = useState("Build a chess engine in Python");

  const handleStart = () => {
    const value = topic.trim();
    if (user) {
      navigate(value ? `/dashboard?topic=${encodeURIComponent(value)}` : "/dashboard");
      return;
    }
    navigate(value ? "/login?signup=1&topic=" + encodeURIComponent(value) : "/login?signup=1");
  };

  return (
    <div className="cr-landing cr-shell">
      <Navbar />
      <main id="main">
        <section className="cr-landing-hero">
          <div className="cr-cell cr-span-8 cr-scroll-rise">
            <p className="cr-kicker">A course from a sentence</p>
            <h1 className="cr-landing-title">
              Tell us what you want to get good at.
            </h1>
            <p className="cr-landing-subtitle">
              Type a goal, add what you already know, and we build a course you can actually continue — lessons, a quiz, something to watch.
            </p>
          </div>
          <div className="cr-cell cr-span-4 cr-scroll-rise">
            <label className="cr-sr-only" htmlFor="landing-topic">What do you want to get good at?</label>
            <div className="cr-hero-form">
              <input
                id="landing-topic"
                className="cr-input"
                placeholder="e.g. Build a chess engine in Python"
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleStart()}
              />
              <button type="button" className="cr-btn cr-btn-primary cr-hero-submit" onClick={handleStart}>
                {user ? "Open courses" : "Continue"}
              </button>
            </div>
            <div className="cr-suggestion-list">
              {suggestions.map((item) => (
                <button key={item.label} type="button" className="cr-goal-chip" onClick={() => setTopic(item.label)}>
                  {item.label}
                  {item.example ? <span className="cr-example-tag"> example</span> : null}
                </button>
              ))}
            </div>
            <p className="cr-example-note">Any subject works. The marked chip is only a sample of a path assembling.</p>
          </div>
          <div className="cr-cell cr-cell-ink cr-span-12 cr-scroll-rise">
            <HeroInstrument goal={topic} />
          </div>
        </section>

        <section className="cr-proof cr-scroll-rise" aria-label="How a course is built">
          <span className="cr-cell cr-span-3">Your goal</span>
          <span className="cr-cell cr-span-3">What you already know</span>
          <span className="cr-cell cr-span-3">Lessons and a quiz</span>
          <span className="cr-cell cr-span-3">A place to try it</span>
        </section>

        <section className="cr-editorial">
          <div className="cr-cell cr-cell-ink cr-span-5 cr-scroll-rise">
            <p className="cr-kicker">Keep it light</p>
            <h2>Make a course. Keep going.</h2>
            <p className="cr-body">
              Make a course, keep going, glance at your stats. If you want to run a tiny program, it sits next to the lesson.
            </p>
          </div>
          <div className="cr-split-list cr-span-7">
            {[
              ["01", "Say the goal", "One sentence is enough. Spanish, chess, guitar — whatever you are actually trying to learn."],
              ["02", "Mention what you know", "We skip the boring recap and start at your edge."],
              ["03", "Learn, then try", "Open the course. The Python runner sits next to the lesson; Ask is on the same page."],
            ].map(([n, title, copy]) => (
              <article key={n} className="cr-split-row">
                <span className="cr-kicker">{n}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="cr-footer">
        <div className="cr-footer-inner">
          <span className="cr-brand-word">courserocket</span>
          <span>Courses that start where you are.</span>
          <div className="cr-footer-links">
            <Link to="/privacy">Privacy</Link>
            <Link to={user ? "/dashboard" : "/login"}>{user ? "Courses" : "Sign in"}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

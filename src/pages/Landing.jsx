import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
const Scanner = lazy(() => import("../components/Scanner"));

const suggestions = [
  "Build a chess engine in Python",
  "Understand machine learning",
  "Learn conversational Spanish",
  "Design a personal finance plan",
];
const steps = [
  { number: "01", title: "Start with your goal", description: "Say what you want to understand, make, or be able to do.", icon: "↗" },
  { number: "02", title: "Get a learning path", description: "A clear sequence of modules, explanations, practice, and useful resources.", icon: "⌁" },
  { number: "03", title: "Keep moving forward", description: "Pick up where you left off and see the progress you have made.", icon: "✓" },
];
const features = [
  { title: "A path, not a pile of links", description: "Topics are arranged into modules so you know what to learn first and what comes next.", icon: "01" },
  { title: "Learn by doing", description: "Short checks and practical exercises give you a reason to use each new idea.", icon: "02" },
  { title: "Useful context, close by", description: "Open related video lessons and further reading alongside the module you are studying.", icon: "03" },
];

function ScannerBackdrop() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let supported = false;
    try {
      const probe = document.createElement("canvas").getContext("webgl2");
      supported = Boolean(probe);
      probe?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch { supported = false; }
    const update = () => setEnabled(supported && !preference.matches);
    update();
    preference.addEventListener?.("change", update);
    return () => preference.removeEventListener?.("change", update);
  }, []);
  if (!enabled) return null;
  return (
    <Suspense fallback={null}>
    <Scanner
      className="cr-scanner"
      color1="#0A0E1A" color2="#6366F1" color3="#22D3EE"
      speed={0.22} sweepSpeed={0.12} sweepWidth={1.85} sweepFalloff={5.5}
      scale={1.6} frequency={1.6} ripple={0.16} bandDensity={9}
      lineSharpness={4.5} glow={0.19} scanDirection="diagonal"
      colorSpread={0.34} brightness={0.66} contrast={1.12} softness={1.8}
      vignette={0.68} scanline={false} grain={true} grainIntensity={0.025}
      opacity={0.72} mouseInteraction={false}
    />
    </Suspense>
  );
}

function CoursePreview() {
  return (
    <div className="cr-hero-visual" aria-label="Example of a CourseRocket learning path">
      <div className="cr-preview-orbit cr-preview-orbit-one" aria-hidden="true" />
      <div className="cr-preview-orbit cr-preview-orbit-two" aria-hidden="true" />
      <div className="cr-preview-window">
        <div className="cr-preview-topbar">
          <div className="cr-preview-brand"><span className="cr-preview-mark">CR</span><span>YOUR LEARNING PATH</span></div>
          <span className="cr-preview-live"><i /> SAMPLE</span>
        </div>
        <div className="cr-preview-course">
          <div className="cr-preview-label">A FOUR-WEEK PATH</div>
          <h2>Machine learning<br />from the ground up</h2>
          <p>From your first model to a project you can explain.</p>
          <div className="cr-preview-progress">
            <span><b>YOUR PATH</b><b>3 of 8 modules</b></span>
            <div><i /></div>
          </div>
        </div>
        <div className="cr-preview-divider" />
        <div className="cr-preview-modules">
          <div className="cr-preview-module is-done">
            <span className="cr-preview-module-icon">✓</span>
            <span><b>Build an intuition for data</b><small>Concepts · 2 lessons · Practice</small></span>
            <span className="cr-preview-check">DONE</span>
          </div>
          <div className="cr-preview-module is-active">
            <span className="cr-preview-module-icon">2</span>
            <span><b>Teach a model to learn</b><small>Gradient descent · Loss · Feedback</small></span>
            <span className="cr-preview-arrow">↗</span>
          </div>
          <div className="cr-preview-module">
            <span className="cr-preview-module-icon">3</span>
            <span><b>Make your first prediction</b><small>A small project with real data</small></span>
            <span className="cr-preview-lock">03</span>
          </div>
        </div>
      </div>
      <div className="cr-preview-float">
        <span className="cr-preview-float-icon">✦</span>
        <span><b>Made for your goal</b><small>One step at a time</small></span>
      </div>
    </div>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");

  const handleStart = () => {
    const value = topic.trim();
    if (!value) {
      navigate(user ? "/dashboard" : "/login?signup=1");
      return;
    }
    if (user) navigate("/dashboard?autostart=1&topic=" + encodeURIComponent(value));
    else navigate("/login?signup=1&topic=" + encodeURIComponent(value));
  };

  return (
    <div className="cr-landing">
      <div className="cr-page-scanner-layer" aria-hidden="true"><ScannerBackdrop /></div>
      <Navbar />
      <main>
        <section className="cr-landing-hero cr-fade">
          <div className="cr-hero-copy">
            <div className="cr-landing-eyebrow"><i /> LEARNING THAT STARTS WITH YOU</div>
            <h1 className="cr-landing-title">Learn anything.<br /><span>Make it real.</span></h1>
            <p className="cr-landing-subtitle">Tell CourseRocket what you want to understand or build. Get a guided course that gives you a clear next step, from the first concept to hands-on practice.</p>
            <div className="cr-hero-form">
              <label className="cr-sr-only" htmlFor="landing-topic">What do you want to learn?</label>
              <input id="landing-topic" className="cr-input" placeholder="e.g. Build a chess engine in Python" value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleStart()} />
              <button className="cr-btn cr-btn-primary cr-hero-submit" onClick={handleStart}>{user ? "Build my course" : "Create my course"} <span aria-hidden="true">↗</span></button>
            </div>
            <div className="cr-hero-promise"><span>✦</span> Made around your goal <i /> Learn at your own pace <i /> Progress saves as you go</div>
            <div className="cr-hero-suggestions">
              <span className="cr-suggestion-label">A few ideas to get you started</span>
              <div className="cr-suggestion-list">
                {suggestions.map((item) => <button key={item} type="button" className="cr-suggestion-chip" onClick={() => setTopic(item)}>{item} <span aria-hidden="true">↗</span></button>)}
              </div>
            </div>
          </div>
          <CoursePreview />
        </section>

        <section className="cr-proof-strip" aria-label="CourseRocket learning experience">
          <span>YOUR GOAL</span><i /><span>A CLEAR COURSE</span><i /><span>PRACTICE THAT STICKS</span><i /><span>PROGRESS YOU CAN SEE</span>
        </section>

        <section className="cr-landing-section">
          <div className="cr-section-heading">
            <div className="cr-section-kicker">A BETTER WAY TO BEGIN</div>
            <h2>Make the first step feel easy.</h2>
            <p>No blank-page panic. Just tell us what you have in mind and start with a path you can follow.</p>
          </div>
          <div className="cr-step-grid">
            {steps.map((step) => <article key={step.number} className="cr-step-card">
              <div className="cr-step-top"><span>{step.number}</span><span className="cr-step-icon">{step.icon}</span></div>
              <h3>{step.title}</h3><p>{step.description}</p>
            </article>)}
          </div>
        </section>

        <section className="cr-landing-section cr-feature-section">
          <div className="cr-feature-heading">
            <div><div className="cr-section-kicker">BUILT FOR THE NEXT STEP</div><h2>Learning should take you somewhere.</h2></div>
            <p>Not just another summary. A structure for making sense of a topic and putting it to work.</p>
          </div>
          <div className="cr-feature-grid">
            {features.map((feature) => <article key={feature.title} className="cr-feature-card">
              <div className="cr-feature-index">{feature.icon}</div>
              <h3>{feature.title}</h3><p>{feature.description}</p><span className="cr-feature-arrow" aria-hidden="true">↗</span>
            </article>)}
          </div>
        </section>

        <section className="cr-final-cta">
          <div className="cr-cta-decoration" aria-hidden="true"><span>✦</span><i /><b /></div>
          <div className="cr-section-kicker">YOUR NEXT CHAPTER STARTS HERE</div>
          <h2>Pick a skill. Make it real.</h2>
          <p>Start with one thing you have always wanted to learn.</p>
          <button className="cr-btn cr-btn-primary" onClick={() => navigate(user ? "/dashboard" : "/login?signup=1")}>{user ? "Go to your courses" : "Get started"} <span aria-hidden="true">↗</span></button>
        </section>
      </main>
      <footer className="cr-footer">
        <div className="cr-footer-inner">
          <button className="cr-brand cr-footer-brand" onClick={() => navigate("/")} type="button"><img src="/logo-mark.png" alt="" className="cr-brand-mark" /><span className="cr-brand-word">course<span>rocket</span></span></button>
          <span>Make learning personal.</span>
          <div className="cr-footer-links">{user && <button onClick={() => navigate("/dashboard")} type="button">Your courses</button>}<button onClick={() => navigate("/login")} type="button">{user ? "Account" : "Sign in"}</button></div>
        </div>
      </footer>
    </div>
  );
}

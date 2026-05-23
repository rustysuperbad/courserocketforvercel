import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";

const suggestions = [
  "Black-Scholes options pricing",
  "Machine learning from scratch",
  "iOS app development with Swift",
  "Quantum computing fundamentals",
  "Full-stack web app",
  "Systems design interviews",
];

const features = [
  {
    title: "AI Curriculum Designer",
    desc: "Type any goal and get a structured, sequenced course in seconds.",
    icon: "✦",
  },
  {
    title: "Curated Videos",
    desc: "Best YouTube lessons sourced and ordered for your exact topic.",
    icon: "▶",
  },
  {
    title: "Research Papers",
    desc: "Academic papers attached at the right depth per module.",
    icon: "◈",
  },
  {
    title: "Module Quizzes",
    desc: "Auto-generated, instantly graded, with explanations.",
    icon: "◉",
  },
  {
    title: "Progress Tracking",
    desc: "Persistent progress synced to your account across devices.",
    icon: "◎",
  },
  {
    title: "Always Resumes",
    desc: "Refresh, reopen, come back tomorrow. Your work is safe.",
    icon: "↺",
  },
];

const steps = [
  { n: "01", t: "Describe a goal", d: "Tell us what you want to learn or build." },
  { n: "02", t: "Get a course", d: "We design modules, videos, papers, quizzes." },
  { n: "03", t: "Track progress", d: "Mark modules done, take quizzes, earn streaks." },
];

export default function Landing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");

  const handleStart = () => {
    if (!topic.trim()) {
      navigate(user ? "/dashboard" : "/login?signup=1");
      return;
    }
    if (user) {
      navigate(`/dashboard?autostart=1&topic=${encodeURIComponent(topic.trim())}`);
    } else {
      navigate(`/login?signup=1&topic=${encodeURIComponent(topic.trim())}`);
    }
  };

  return (
    <div style={s.root}>
      <Navbar />

      <section style={s.hero} className="cr-fade">
        <div style={s.eyebrow}>
          <span style={s.dot} /> AI-powered structured learning
        </div>
        <h1 style={s.h1}>
          Learn everything.
          <br />
          <span style={s.h1Accent}>Build anything.</span>
        </h1>
        <p style={s.subtitle}>
          Describe any topic, project or skill — CourseRocket designs a complete
          course with videos, papers, quizzes, and progress tracking.
        </p>

        <div style={s.inputRow}>
          <input
            className="cr-input"
            style={s.heroInput}
            placeholder="e.g. Build a stock predictor with Black-Scholes"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleStart()}
          />
          <button className="cr-btn cr-btn-primary" style={s.heroBtn} onClick={handleStart}>
            {user ? "Generate course" : "Get started"} →
          </button>
        </div>

        <div style={s.chipRow}>
          {suggestions.map((sug) => (
            <button
              key={sug}
              style={s.chip}
              onClick={() => setTopic(sug)}
            >
              {sug}
            </button>
          ))}
        </div>

        <div style={s.heroQuickActions}>
          {user ? (
            <>
              <button className="cr-btn cr-btn-soft" onClick={() => navigate("/dashboard")}>
                Open Dashboard
              </button>
              <button className="cr-btn cr-btn-ghost" onClick={() => navigate("/profile")}>
                View Profile
              </button>
            </>
          ) : (
            <>
              <button className="cr-btn cr-btn-soft" onClick={() => navigate("/login")}>
                Sign in
              </button>
              <button className="cr-btn cr-btn-ghost" onClick={() => navigate("/login?signup=1")}>
                Create account
              </button>
            </>
          )}
        </div>
      </section>

      <section style={s.section}>
        <div style={s.sectionHead}>
          <h2 style={s.h2}>How it works</h2>
          <p style={s.muted}>From idea to a structured course in three steps.</p>
        </div>
        <div style={s.stepsGrid}>
          {steps.map((step) => (
            <div key={step.n} className="cr-card" style={s.stepCard}>
              <div style={s.stepNum}>{step.n}</div>
              <div style={s.stepTitle}>{step.t}</div>
              <div style={s.stepDesc}>{step.d}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={s.section}>
        <div style={s.sectionHead}>
          <h2 style={s.h2}>Built for serious learning</h2>
          <p style={s.muted}>Everything you need to actually finish what you start.</p>
        </div>
        <div style={s.featureGrid}>
          {features.map((f) => (
            <div key={f.title} className="cr-card" style={s.featureCard}>
              <div style={s.featureIcon}>{f.icon}</div>
              <div style={s.featureTitle}>{f.title}</div>
              <div style={s.featureDesc}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={s.ctaSection}>
        <div className="cr-card" style={s.ctaCard}>
          <div>
            <div style={s.ctaTitle}>Ready to build your first course?</div>
            <div style={s.ctaSubtitle}>It takes less than a minute.</div>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            {user ? (
              <button className="cr-btn cr-btn-primary" onClick={() => navigate("/dashboard")}>
                Go to Dashboard
              </button>
            ) : (
              <>
                <button className="cr-btn cr-btn-ghost" onClick={() => navigate("/login")}>
                  Sign in
                </button>
                <button className="cr-btn cr-btn-primary" onClick={() => navigate("/login?signup=1")}>
                  Get started
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      <footer style={s.footer}>
        <div style={s.footerInner}>
          <div style={{ color: "var(--text-2)", fontSize: 13 }}>
            © {new Date().getFullYear()} CourseRocket
          </div>
          <div style={{ display: "flex", gap: 16, color: "var(--text-2)", fontSize: 13 }}>
            <span style={{ cursor: "pointer" }} onClick={() => navigate("/")}>Home</span>
            {user ? (
              <>
                <span style={{ cursor: "pointer" }} onClick={() => navigate("/dashboard")}>Dashboard</span>
                <span style={{ cursor: "pointer" }} onClick={() => navigate("/profile")}>Profile</span>
              </>
            ) : (
              <span style={{ cursor: "pointer" }} onClick={() => navigate("/login")}>Sign in</span>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}

const s = {
  root: { minHeight: "100vh" },
  hero: {
    maxWidth: "920px",
    margin: "0 auto",
    padding: "80px 24px 56px",
    textAlign: "center",
  },
  eyebrow: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    background: "var(--primary-soft)",
    border: "1px solid rgba(99,102,241,0.25)",
    color: "var(--primary-2)",
    padding: "6px 14px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 500,
    marginBottom: "26px",
  },
  dot: {
    width: "6px",
    height: "6px",
    background: "var(--primary)",
    borderRadius: "999px",
    boxShadow: "0 0 12px var(--primary)",
  },
  h1: {
    fontFamily: "var(--font-display)",
    fontSize: "60px",
    fontWeight: 800,
    lineHeight: 1.05,
    letterSpacing: "-1.5px",
    color: "var(--text)",
    marginBottom: "16px",
  },
  h1Accent: {
    background: "linear-gradient(135deg, var(--primary-2), var(--accent))",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  subtitle: {
    fontSize: "17px",
    color: "var(--text-2)",
    maxWidth: "560px",
    margin: "0 auto 36px",
    lineHeight: 1.65,
  },
  inputRow: {
    display: "flex",
    gap: "10px",
    maxWidth: "620px",
    margin: "0 auto 18px",
  },
  heroInput: {
    flex: 1,
    fontSize: "15px",
    padding: "14px 16px",
  },
  heroBtn: { padding: "12px 22px" },
  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "8px",
    maxWidth: "720px",
    margin: "0 auto 28px",
  },
  chip: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--border)",
    color: "var(--text-2)",
    fontSize: "12px",
    padding: "6px 14px",
    borderRadius: "999px",
    cursor: "pointer",
    transition: "all 120ms ease",
  },
  heroQuickActions: {
    display: "flex",
    justifyContent: "center",
    gap: "10px",
  },
  section: {
    maxWidth: "1100px",
    margin: "0 auto",
    padding: "60px 24px",
  },
  sectionHead: {
    textAlign: "center",
    marginBottom: "32px",
  },
  h2: {
    fontFamily: "var(--font-display)",
    fontSize: "30px",
    fontWeight: 700,
    color: "var(--text)",
    marginBottom: "8px",
    letterSpacing: "-0.5px",
  },
  muted: {
    color: "var(--text-2)",
    fontSize: "15px",
  },
  stepsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "16px",
  },
  stepCard: {
    padding: "22px 22px 24px",
  },
  stepNum: {
    fontFamily: "var(--font-display)",
    fontSize: "13px",
    color: "var(--primary-2)",
    fontWeight: 700,
    letterSpacing: "1px",
    marginBottom: "10px",
  },
  stepTitle: {
    fontFamily: "var(--font-display)",
    fontSize: "18px",
    color: "var(--text)",
    fontWeight: 700,
    marginBottom: "6px",
  },
  stepDesc: { color: "var(--text-2)", fontSize: "14px", lineHeight: 1.6 },
  featureGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "14px",
  },
  featureCard: {
    padding: "22px",
  },
  featureIcon: {
    width: "38px",
    height: "38px",
    borderRadius: "10px",
    background: "var(--primary-soft)",
    color: "var(--primary-2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "16px",
    marginBottom: "14px",
  },
  featureTitle: {
    fontFamily: "var(--font-display)",
    fontSize: "16px",
    color: "var(--text)",
    fontWeight: 700,
    marginBottom: "6px",
  },
  featureDesc: { color: "var(--text-2)", fontSize: "13.5px", lineHeight: 1.6 },
  ctaSection: {
    maxWidth: "1100px",
    margin: "0 auto",
    padding: "0 24px 80px",
  },
  ctaCard: {
    padding: "26px 28px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    flexWrap: "wrap",
  },
  ctaTitle: {
    fontFamily: "var(--font-display)",
    fontSize: "20px",
    color: "var(--text)",
    fontWeight: 700,
  },
  ctaSubtitle: {
    color: "var(--text-2)",
    fontSize: "14px",
    marginTop: "4px",
  },
  footer: {
    borderTop: "1px solid var(--border)",
    padding: "20px 0",
  },
  footerInner: {
    maxWidth: "1100px",
    margin: "0 auto",
    padding: "0 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
};

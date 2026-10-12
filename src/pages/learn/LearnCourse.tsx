import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "../../components/Navbar";
import { ContentStatusBadge } from "../../components/learn/StatusBadge";
import { describeCallableError, getLearningCourse, recordLearningOutcome, submitCourseProject, submitLessonFeedback, submitQuizAttempt, type FeedbackCategory, type LearningCourse } from "../../lib/learningApi";
import "../../styles/learn.css";

export default function LearnCourse() {
  const { courseId } = useParams();
  const [data, setData] = useState<LearningCourse | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!courseId) return;
    void getLearningCourse(courseId).then((result) => {
      setData(result);
      const firstLearn = result.modules.findIndex((module) => module.body?.learningStatus !== "skipped_mastered");
      setActive(firstLearn >= 0 ? firstLearn : 0);
    }).catch((err) => setError(describeCallableError(err)));
  }, [courseId]);

  const module = data?.modules[active];

  return (
    <div style={{ minHeight: "100vh" }}>
      <Navbar />
      <main className="lr-page" id="main">
        {!data && !error && <div className="cr-skeleton" style={{ height: 160 }} aria-busy="true" />}
        {error && <div className="lr-error" role="alert">{error}</div>}
        {data && (
          <>
            <header className="lr-head">
              <div className="cr-page-kicker">{data.course.domain}</div>
              <h1>{data.course.goal}</h1>
              <p>
                <ContentStatusBadge status={data.course.content_status} />
                {" · "}
                {data.course.estimated_minutes ?? "?"} min
                {" · "}
                {data.course.status}
              </p>
              {data.course.content_status !== "ai_verified" && data.course.content_status !== "human_reviewed" && (
                <div className="lr-notice" role="status">This course is not fully verified. Treat remaining claims as drafts until every citation passes review.</div>
              )}
            </header>
            <div className="lr-tabs" role="tablist" aria-label="Modules">
              {data.modules.map((item, index) => (
                <button key={item.id} type="button" role="tab" aria-selected={index === active} onClick={() => setActive(index)}>
                  {index + 1}. {item.title}
                </button>
              ))}
            </div>
            {module && <ModuleView module={module} courseId={data.course.id} />}
            <OutcomeBlock />
            <ProjectBlock courseId={data.course.id} />
            <p className="lr-muted" style={{ marginTop: 18 }}><Link className="cr-link" to="/learn">Back to Learn</Link></p>
          </>
        )}
      </main>
    </div>
  );
}

function ModuleView({ module, courseId }: { module: LearningCourse["modules"][number]; courseId: string }) {
  const body = module.body ?? {};
  if (body.learningStatus === "skipped_mastered") {
    return (
      <section className="cr-card lr-card" aria-labelledby="mod-title">
        <h2 id="mod-title">{module.title}</h2>
        <p>Skipped because your mastery estimate is already high. You can still open reviews later.</p>
      </section>
    );
  }
  const sources = body.sources ?? [];
  const citationFor = (claimId: string) => {
    const claim = module.claims.find((item) => item.claim_key === claimId);
    const chunkId = claim?.supporting_chunk_ids[0];
    const source = sources.find((item) => item.id === chunkId);
    return source?.citation;
  };
  return (
    <article className="cr-card lr-card lr-lesson" aria-labelledby="mod-title">
      <div className="lr-run-top">
        <h2 id="mod-title">{module.title}</h2>
        <ContentStatusBadge status={module.content_status} />
      </div>
      <p className="lr-muted">{module.summary}</p>
      {(body.verificationIssues ?? []).map((issue) => <div key={issue} className="lr-notice" role="status">{issue}</div>)}
      {(body.sections ?? []).map((section) => (
        <section key={section.heading}>
          <h3>{section.heading}</h3>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph.text.slice(0, 40)}>
              {paragraph.text}
              {paragraph.claimIds.map((claimId) => {
                const citation = citationFor(claimId);
                return citation ? <a key={claimId} className="lr-cite" href={`#source-${citation}`} aria-label={`Source ${citation}`}>[{citation}]</a> : null;
              })}
            </p>
          ))}
        </section>
      ))}
      <h3>Claims and verification</h3>
      <ul className="lr-sources">
        {module.claims.map((claim) => (
          <li key={claim.claim_key}>
            {claim.claim_text}{" "}
            <span className="lr-muted">
              {claim.verified ? "supported" : claim.verification_status}
              {claim.supporting_chunk_ids.length ? "" : " · missing citation"}
            </span>
          </li>
        ))}
      </ul>
      <h3 id="sources">Sources</h3>
      <ol className="lr-sources">
        {sources.map((source) => (
          <li key={source.id} id={`source-${source.citation}`}>
            <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
            <div className="lr-muted">{source.license} · {source.attribution} · link {source.linkStatus ?? "unchecked"}</div>
          </li>
        ))}
      </ol>
      {(body.resources ?? []).length > 0 && (
        <>
          <h3>Related videos and papers</h3>
          <ul className="lr-sources">
            {body.resources?.map((resource) => (
              <li key={resource.url}><a href={resource.url} target="_blank" rel="noreferrer">{resource.title}</a> <span className="lr-muted">{resource.kind}</span></li>
            ))}
          </ul>
        </>
      )}
      <FeedbackBar moduleId={module.id} courseId={courseId} />
      <h3>Practice</h3>
      <p className="lr-muted">Unverified quiz items are labelled and do not count as a checked answer key. A miss updates mastery, can insert a remedial module, and schedules a review.</p>
      {(module.quizItems ?? []).map((item) => <QuizBlock key={item.item_key} moduleId={module.id} item={item} />)}
    </article>
  );
}

const FEEDBACK: Array<{ id: FeedbackCategory; label: string }> = [
  { id: "confusing", label: "Confusing" },
  { id: "incorrect", label: "Incorrect" },
  { id: "too_easy", label: "Too easy" },
  { id: "too_hard", label: "Too hard" },
  { id: "useful", label: "Useful" },
];

function FeedbackBar({ moduleId, courseId }: { moduleId: string; courseId: string }) {
  const [sent, setSent] = useState<FeedbackCategory | null>(null);
  const [message, setMessage] = useState("");
  async function send(category: FeedbackCategory) {
    try {
      await submitLessonFeedback(moduleId, category, courseId);
      setSent(category);
      setMessage("Thanks. This goes to the review queue.");
    } catch (err) {
      setMessage(describeCallableError(err));
    }
  }
  return (
    <div className="lr-feedback" role="group" aria-label="Lesson feedback">
      {FEEDBACK.map((item) => (
        <button key={item.id} type="button" aria-pressed={sent === item.id} onClick={() => void send(item.id)}>{item.label}</button>
      ))}
      {message && <span className="lr-muted">{message}</span>}
    </div>
  );
}

function OutcomeBlock() {
  const [slug, setSlug] = useState("packet-journey");
  const [stage, setStage] = useState<"pre" | "post" | "delayed">("post");
  const [score, setScore] = useState(70);
  const [message, setMessage] = useState("");
  return (
    <section className="cr-card lr-card" style={{ marginTop: 18 }} aria-labelledby="outcome-heading">
      <h2 id="outcome-heading">Learning check</h2>
      <p className="lr-muted">Record a pre, post, or delayed self-score for a catalog concept. This is not a verified exam.</p>
      <label className="lr-field">
        <span>Concept slug</span>
        <input className="cr-input" value={slug} onChange={(event) => setSlug(event.target.value)} />
      </label>
      <label className="lr-field">
        <span>Stage</span>
        <select className="cr-input" value={stage} onChange={(event) => setStage(event.target.value as "pre" | "post" | "delayed")}>
          <option value="pre">Pre</option>
          <option value="post">Post</option>
          <option value="delayed">Delayed</option>
        </select>
      </label>
      <label className="lr-field">
        <span>Score {score}%</span>
        <input type="range" min={0} max={100} value={score} onChange={(event) => setScore(Number(event.target.value))} />
      </label>
      <div className="lr-actions">
        <button type="button" className="cr-btn cr-btn-soft" onClick={() => {
          void recordLearningOutcome(slug, stage, score / 100).then(() => setMessage("Check saved.")).catch((err) => setMessage(describeCallableError(err)));
        }}>Save check</button>
      </div>
      {message && <div className="lr-notice" role="status">{message}</div>}
    </section>
  );
}

function QuizBlock({ moduleId, item }: { moduleId: string; item: LearningCourse["modules"][number]["quizItems"][number] }) {
  const options = Array.isArray(item.options) ? item.options.map(String) : [];
  const [choice, setChoice] = useState<string | null>(null);
  const [result, setResult] = useState<string>("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!choice) return;
    setBusy(true);
    try {
      const outcome = await submitQuizAttempt(moduleId, item.item_key, choice);
      const bits = [outcome.isCorrect ? "Correct." : "Not quite.", item.explanation];
      if (outcome.remediationInserted) bits.push("A short remedial module was added for the missing prerequisite.");
      if (outcome.reviewDueAt) bits.push("A review card was scheduled.");
      if (!item.verified) bits.push("This answer key is not independently verified.");
      setResult(bits.join(" "));
    } catch (err) {
      setResult(describeCallableError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="lr-run" style={{ marginTop: 10 }}>
      <strong>{item.question}</strong>
      <div className="lr-muted">{item.question_type} · {item.verified ? "answer key verified" : "unverified answer key"}</div>
      <div className="lr-list">
        {options.map((option) => (
          <button key={option} type="button" className="lr-option" aria-pressed={choice === option} onClick={() => setChoice(option)}>{option}</button>
        ))}
      </div>
      <div className="lr-actions">
        <button type="button" className="cr-btn cr-btn-soft" onClick={() => void submit()} disabled={!choice || busy}>{busy ? "Checking…" : "Check answer"}</button>
      </div>
      {result && <div className="lr-notice" role="status">{result}</div>}
    </div>
  );
}

function ProjectBlock({ courseId }: { courseId: string }) {
  const [writeup, setWriteup] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section style={{ marginTop: 22 }} aria-labelledby="project-heading">
      <h3 id="project-heading">Final project</h3>
      <p>Explain, in your own words, how a browser fetch of https://example.com travels across a network. The rubric looks for DNS, TCP, TLS, HTTP, and the default gateway.</p>
      <label className="lr-field">
        <span>Your explanation</span>
        <textarea className="cr-input" rows={6} maxLength={8000} value={writeup} onChange={(event) => setWriteup(event.target.value)} />
      </label>
      <div className="lr-actions">
        <button type="button" className="cr-btn cr-btn-primary" disabled={busy || writeup.trim().length < 40} onClick={() => {
          setBusy(true);
          void submitCourseProject(courseId, writeup).then((result) => {
            setMessage(`${Math.round(result.score * 100)}% · ${result.rubric.feedback}`);
          }).catch((err) => setMessage(describeCallableError(err))).finally(() => setBusy(false));
        }}>{busy ? "Scoring…" : "Submit for rubric feedback"}</button>
      </div>
      {message && <div className="lr-notice" role="status">{message}</div>}
    </section>
  );
}

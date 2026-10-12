import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "../../components/Navbar";
import { ContentStatusBadge } from "../../components/learn/StatusBadge";
import { describeCallableError, getLearningCourse, type LearningCourse } from "../../lib/learningApi";
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
            {module && <ModuleView module={module} />}
            <p className="lr-muted" style={{ marginTop: 18 }}><Link className="cr-link" to="/learn">Back to Learn</Link></p>
          </>
        )}
      </main>
    </div>
  );
}

function ModuleView({ module }: { module: LearningCourse["modules"][number] }) {
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
      <h3>Practice</h3>
      <p className="lr-muted">Unverified quiz items are labelled and do not count as a checked answer key.</p>
      {(module.quizItems ?? []).map((item) => (
        <div key={item.item_key} className="lr-run" style={{ marginTop: 10 }}>
          <strong>{item.question}</strong>
          <div className="lr-muted">{item.question_type} · {item.verified ? "answer key verified" : "unverified answer key"}</div>
        </div>
      ))}
    </article>
  );
}

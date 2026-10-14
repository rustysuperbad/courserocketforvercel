import { useEffect, useState } from "react";
import { setVideoTimestampSeconds } from "../lib/coursePipeline";
import PythonSandbox from "./learn/PythonSandbox";
import { SANDBOX_STARTERS } from "./learn/sandboxLanguages";

export default function PracticeBento({
  showSandbox = false,
  isGenerating = false,
  sandboxLang,
  onSandboxLang,
  sandboxCode,
  onSandboxCode,
  videos = [],
  videoProgressMap = {},
  courseId,
  papers = [],
  quiz = [],
  quizAnswers = {},
  quizSubmitted = false,
  onQuizPick,
  onQuizSubmit,
  onQuizReset,
  quizCorrect = 0,
  nextLabel,
  onNext,
  renderText = (text) => text,
}) {
  const featured = videos[0];
  const rest = videos.slice(1);
  const featuredPaper = papers[0];
  const restPapers = papers.slice(1);

  return (
    <section
      className={
        "cr-practice" +
        (videos.length ? " has-videos" : "") +
        (showSandbox ? " has-sandbox" : "")
      }
      aria-label="Watch, try, read, and check"
    >
      <p className="cr-kicker">After the lesson</p>
      <div className="cr-practice-bento">
        <div className="cr-cell cr-practice-videos">
          <div className="cr-practice-head">
            <p className="cr-kicker">Watch</p>
            <h2>One video</h2>
          </div>
          {videos.length > 0 ? (
            <div className="cr-practice-video-stack">
              <VideoRow
                video={featured}
                featured
                courseId={courseId}
                stoppedSeconds={
                  typeof videoProgressMap[featured.videoId] === "number"
                    ? videoProgressMap[featured.videoId]
                    : null
                }
              />
              {rest.map((video) => (
                <VideoCard key={video.videoId} video={video} variant="compact" />
              ))}
            </div>
          ) : isGenerating ? (
            <p className="cr-practice-empty">Finding a video for this module…</p>
          ) : (
            <p className="cr-practice-empty">No video for this module yet.</p>
          )}
        </div>

        {showSandbox ? (
          <div className="cr-cell cr-cell-ink cr-practice-sandbox">
            <PythonSandbox
              compact
              language={sandboxLang}
              onLanguageChange={onSandboxLang}
              code={sandboxCode || SANDBOX_STARTERS.python}
              onCodeChange={onSandboxCode}
              note="Try the idea in this browser."
            />
          </div>
        ) : null}

        <div className="cr-cell cr-practice-papers">
          <div className="cr-practice-head">
            <p className="cr-kicker">Read</p>
            <h2>A paper</h2>
          </div>
          {papers.length > 0 ? (
            <div className="cr-practice-paper-stack">
              <a
                className="cr-paper-feature"
                href={featuredPaper.url}
                target="_blank"
                rel="noreferrer"
              >
                <span className="cr-paper-feature-title">{featuredPaper.title}</span>
                <span className="cr-paper-feature-meta">
                  {[featuredPaper.authors, featuredPaper.year].filter(Boolean).join(" · ")}
                </span>
                {featuredPaper.abstract ? (
                  <span className="cr-paper-feature-abs">{featuredPaper.abstract}</span>
                ) : null}
              </a>
              {restPapers.map((paper, index) => (
                <a
                  key={paper.url || index}
                  className="cr-paper-compact"
                  href={paper.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>{paper.title}</span>
                  <small>{paper.year || "Open"}</small>
                </a>
              ))}
            </div>
          ) : isGenerating ? (
            <p className="cr-practice-empty">Fetching related reading…</p>
          ) : (
            <p className="cr-practice-empty">No paper for this module yet.</p>
          )}
        </div>

        <div className="cr-cell cr-practice-quiz">
          <div className="cr-practice-head">
            <p className="cr-kicker">Check</p>
            <h2>Quiz</h2>
          </div>
          {quiz.length > 0 ? (
            <div className="cr-practice-quiz-body">
              {quiz.map((item, qIndex) => {
                const selected = quizAnswers[qIndex];
                return (
                  <div key={qIndex} className="cr-practice-q">
                    <p className="cr-practice-q-num">Question {qIndex + 1}</p>
                    <p className="cr-practice-q-text">{renderText(item.question, `qq-${qIndex}`)}</p>
                    <div className="cr-practice-opts" role="group" aria-label={`Question ${qIndex + 1}`}>
                      {(item.options || []).map((opt, optIndex) => {
                        let state = "";
                        if (quizSubmitted) {
                          if (optIndex === item.correctIndex) state = " is-correct";
                          else if (optIndex === selected) state = " is-wrong";
                        } else if (selected === optIndex) {
                          state = " is-on";
                        }
                        return (
                          <button
                            type="button"
                            key={optIndex}
                            className={"cr-practice-opt" + state}
                            disabled={quizSubmitted}
                            onClick={() => onQuizPick?.(qIndex, optIndex)}
                          >
                            <span aria-hidden="true">{["A", "B", "C", "D"][optIndex]}</span>
                            <span>{renderText(opt, `qo-${qIndex}-${optIndex}`)}</span>
                          </button>
                        );
                      })}
                    </div>
                    {quizSubmitted ? (
                      <p className={"cr-practice-explain" + (selected === item.correctIndex ? " is-good" : " is-bad")}>
                        {selected === item.correctIndex ? "Correct. " : "Not quite. "}
                        {renderText(item.explanation, `qe-${qIndex}`)}
                      </p>
                    ) : null}
                  </div>
                );
              })}
              {!quizSubmitted ? (
                <button
                  type="button"
                  className="cr-btn cr-btn-primary"
                  disabled={Object.keys(quizAnswers).length < quiz.length}
                  onClick={onQuizSubmit}
                >
                  Check answers
                </button>
              ) : (
                <div className="cr-practice-score">
                  <p>
                    <b className="cr-num">{quizCorrect}</b>
                    <span> / {quiz.length}</span>
                  </p>
                  <div className="cr-practice-score-actions">
                    <button type="button" className="cr-btn cr-btn-ghost" onClick={onQuizReset}>
                      Retry
                    </button>
                    {onNext ? (
                      <button type="button" className="cr-btn cr-btn-primary" onClick={onNext}>
                        {nextLabel}
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          ) : isGenerating ? (
            <p className="cr-practice-empty">Writing a short quiz…</p>
          ) : (
            <p className="cr-practice-empty">No quiz for this module yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function parseFlexibleTimestamp(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Math.max(0, parseInt(raw, 10));
  const chunks = raw.split(":").map((p) => p.trim()).filter(Boolean);
  const nums = chunks.map((c) => parseInt(c, 10));
  if (nums.some((n) => Number.isNaN(n))) return null;
  if (nums.length === 1) return nums[0];
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  return null;
}

function formatStopLabel(sec) {
  const secs = Math.max(0, Math.floor(Number(sec)));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const r = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

function VideoRow({ video, courseId, stoppedSeconds, featured = false }) {
  const seeded =
    stoppedSeconds != null && !Number.isNaN(Number(stoppedSeconds))
      ? formatStopLabel(stoppedSeconds)
      : "";
  const [raw, setRaw] = useState(seeded);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRaw(
      stoppedSeconds != null && !Number.isNaN(Number(stoppedSeconds))
        ? formatStopLabel(stoppedSeconds)
        : ""
    );
  }, [stoppedSeconds, video?.videoId]);

  const persist = async () => {
    const secs = parseFlexibleTimestamp(raw);
    if (secs == null || !video?.videoId || !courseId) return;
    setBusy(true);
    try {
      await setVideoTimestampSeconds(courseId, video.videoId, secs);
    } catch (error) {
      console.error(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cr-practice-video-feature">
      <VideoCard video={video} variant={featured ? "featured" : "compact"} />
      {featured ? (
        <div className="cr-video-stop">
          <span>Stopped at</span>
          <input
            className="cr-input"
            type="text"
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            placeholder="5:32"
            aria-label={`Where you left off: ${video.title}`}
          />
          <button type="button" className="cr-btn cr-btn-ghost" disabled={busy} onClick={() => void persist()}>
            {busy ? "…" : "Save"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function VideoCard({ video, variant = "featured" }) {
  const ytUrl = "https://www.youtube.com/watch?v=" + video.videoId;
  const thumb =
    video.thumbnail ||
    "https://img.youtube.com/vi/" + video.videoId + "/mqdefault.jpg";
  const compact = variant === "compact";

  return (
    <a
      href={ytUrl}
      target="_blank"
      rel="noreferrer"
      className={compact ? "cr-video-compact" : "cr-video-card cr-video-featured"}
    >
      <div className={compact ? "cr-video-compact-thumb" : "cr-video-thumb-wrap"}>
        <img
          src={thumb}
          alt={video.title}
          className="cr-video-thumb"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = "none";
            event.currentTarget.parentElement?.classList.add("is-fallback");
          }}
        />
        {compact ? null : (
          <>
            <div className="cr-video-overlay">
              <span className="cr-video-play">Play</span>
            </div>
            <span className="cr-video-yt">YouTube</span>
          </>
        )}
      </div>
      <div className={compact ? "cr-video-compact-meta" : "cr-video-meta"}>
        <strong>{video.title}</strong>
        <span>{video.channel}</span>
      </div>
    </a>
  );
}

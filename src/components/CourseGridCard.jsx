/**
 * Dashboard course tile: generation progress uses the same Firestore fields as
 * the pipeline (`generationStatus`, `generationMessage`, `generationProgress*`).
 */

const cardStyles = {
  courseCard: {
    padding: "22px 24px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  cardTopRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  levelPill: {
    fontSize: 12,
    color: "var(--text-2)",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--border)",
    padding: "5px 12px",
    borderRadius: 999,
    textTransform: "capitalize",
  },
  metaText: { fontSize: 13, color: "var(--text-3)", lineHeight: 1.4 },
  courseTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 17,
    color: "var(--text)",
    fontWeight: 650,
    lineHeight: 1.35,
    letterSpacing: "-0.02em",
  },
  conceptStrip: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 0,
    marginBottom: 4,
    minHeight: 0,
  },
  conceptChip: {
    fontSize: 12,
    fontWeight: 500,
    color: "var(--text-2)",
    background: "rgba(255,255,255,0.04)",
    borderRadius: 999,
    padding: "5px 11px",
    border: "1px solid var(--border)",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  courseDesc: {
    fontSize: 14.5,
    color: "var(--text-2)",
    lineHeight: 1.65,
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  progressBlock: { marginTop: "auto" },
  progressTrackSmall: {
    height: 4,
    background: "rgba(255,255,255,0.06)",
    borderRadius: 999,
    overflow: "hidden",
    marginBottom: 6,
  },
  progressFill: {
    height: "100%",
    background: "linear-gradient(90deg, var(--primary), var(--accent))",
    transition: "width 480ms ease",
  },
  progressMeta: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11.5,
    color: "var(--text-3)",
  },
  cardCta: {
    fontSize: 13,
    color: "var(--primary-2)",
    fontWeight: 600,
    marginTop: 4,
  },
};

export default function CourseGridCard({ course, onClick, onRetryGeneration }) {
  const s = cardStyles;
  const keyConcepts = Array.isArray(course.courseKeyConcepts) ? course.courseKeyConcepts : [];
  const totalModules = course.modules?.length || 0;
  const progress = course.progress || {};
  const isGenerating = course.generationStatus === "generating";
  const isFailed = course.generationStatus === "failed";
  const completed = (course.modules || []).filter((m) => {
    const p = progress[m.id];
    return p?.completed || p === true;
  }).length;
  const studyPct =
    totalModules > 0 ? Math.round((completed / totalModules) * 100) : 0;

  const genTotal = Number(course.generationProgressTotal) || 0;
  const genDone = Number(course.generationProgressDone) || 0;
  let barPct = studyPct;
  let leftMeta = `${completed}/${totalModules} done`;
  let rightMeta = `${studyPct}%`;
  let fillStyle = {};

  if (isGenerating) {
    if (genTotal > 0) {
      barPct = Math.min(95, Math.round((genDone / genTotal) * 100));
      leftMeta = `${genDone}/${genTotal} modules ready`;
      rightMeta = `${barPct}%`;
    } else {
      barPct = 8;
      leftMeta = "Preparing outline…";
      rightMeta = "…";
    }
  }

  if (isFailed) {
    barPct = 0;
    leftMeta = "Generation paused";
    rightMeta = "";
    fillStyle = {
      background: "linear-gradient(90deg, #ef4444, #f87171)",
    };
  }

  return (
    <div className="cr-card" style={s.courseCard} onClick={onClick}>
      <div style={s.cardTopRow}>
        <span style={s.levelPill}>
          {isFailed ? "Failed" : isGenerating ? "Generating" : course.level || "Course"}
        </span>
        <span style={s.metaText}>
          {isGenerating ? "Building…" : `${totalModules} modules · ${course.estimatedHours || "—"}h`}
        </span>
      </div>
      <div style={s.courseTitle}>{course.title || course.topic}</div>
      {keyConcepts.length > 0 && !isFailed ? (
        <div style={s.conceptStrip}>
          {keyConcepts.slice(0, 4).map((k) => (
            <span key={k} style={s.conceptChip} title={k}>
              {k}
            </span>
          ))}
        </div>
      ) : null}
      <div style={s.courseDesc}>
        {isFailed
          ? course.generationError || "Something went wrong. Tap Retry or open the course."
          : isGenerating && course.generationMessage
            ? course.generationMessage
            : course.description}
      </div>
      <div style={s.progressBlock}>
        <div style={s.progressTrackSmall}>
          <div style={{ ...s.progressFill, width: `${barPct}%`, ...fillStyle }} />
        </div>
        <div style={s.progressMeta}>
          <span>{leftMeta}</span>
          <span style={{ color: "var(--primary-2)", fontWeight: 600 }}>{rightMeta}</span>
        </div>
      </div>
      {isFailed && onRetryGeneration && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            onRetryGeneration(course);
          }}
        >
          <button
            type="button"
            className="cr-btn cr-btn-soft"
            style={{ width: "100%", padding: "6px 12px", fontSize: 12 }}
          >
            Retry generation
          </button>
        </div>
      )}
      <div style={s.cardCta}>Continue →</div>
    </div>
  );
}

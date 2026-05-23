import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { auth, db } from "../lib/firebase";
import { doc, getDoc, getDocFromServer, onSnapshot } from "firebase/firestore";
import { updateCourseWithRetry, progressDeltaFlatPatch } from "../lib/courseWrites";
import { updateUserCourseProgressMirror, touchUserCourseOpened } from "../lib/userProgress";
import { regenerateModuleContent } from "../lib/generateCourse";
import {
  runOrResumeCourseGeneration,
  mergeCourseModule,
  replaceCourseModule,
  setVideoTimestampSeconds,
} from "../lib/coursePipeline";
import {
  courseGenerationDraftRef,
  mergeCourseModulesForDisplay,
} from "../lib/courseGenerationDraft";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import AIChat from "../components/AIChat";

/** Total offset from viewport top where course chrome begins (sticky sub-bar under global nav). */
const COURSE_SCROLL_OFFSET_PX = 118;

/** Main column gutters + readable content measure. */
const MAIN_PAD = { px: "32px", py: "32px", pb: "64px" };
const CONTENT_MAX_W = "var(--content-max)";

const SIDEBAR_W_PX = 300;

export default function Course() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, authLoading } = useAuth();
  const [course, setCourse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeModule, setActiveModule] = useState(0);
  const [progress, setProgress] = useState({});
  const [showQuiz, setShowQuiz] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [confirmedMissing, setConfirmedMissing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [regenerateLoading, setRegenerateLoading] = useState(false);
  const [editNotes, setEditNotes] = useState("");
  const [editExtra, setEditExtra] = useState("");
  const [editEmphasis, setEditEmphasis] = useState("");
  /** Enriched modules while generation runs (canonical course doc stays outline-only until commit). */
  const [draftModules, setDraftModules] = useState(null);

  // Tracks whether we've EVER successfully loaded the course this session.
  // Once true, transient empty snapshots (from auth-token refresh / cross-tab
  // sync / network reconnect) are ignored — they cannot wipe the UI.
  const hasLoadedRef = useRef(false);
  // Tracks the last time we saw an empty snapshot. If it stays empty for more
  // than CONFIRM_MISSING_MS, we do a one-shot getDoc as a tiebreaker.
  const missingSinceRef = useRef(null);
  const CONFIRM_MISSING_MS = 6000;
  const touchTimerRef = useRef(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/login");
      return;
    }

    let cancelled = false;
    setDraftModules(null);

    void (async () => {
      try {
        const serverSnap = await getDocFromServer(doc(db, "courses", id));
        if (cancelled) return;
        if (serverSnap.exists()) {
          const data = serverSnap.data();
          if (data.userId === user.uid) {
            missingSinceRef.current = null;
            hasLoadedRef.current = true;
            setCourse(data);
            setProgress(data.progress || {});
            setConfirmedMissing(false);
            setLoadError("");
            setLoading(false);
          }
        }
      } catch (e) {
        if (!cancelled) {
          console.warn("[course] server seed read failed (listener may still load):", e?.message);
        }
      }
    })();

    const cref = doc(db, "courses", id);
    const unsub = onSnapshot(
      cref,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          missingSinceRef.current = null;
          hasLoadedRef.current = true;
          setCourse(data);
          setProgress(data.progress || {});
          setConfirmedMissing(false);
          setLoadError("");
          setLoading(false);
          return;
        }

        // exists:false — be very cautious about acting on this.
        if (hasLoadedRef.current) {
          // We already had real data. This is almost certainly a transient
          // auth/permission flicker. Keep showing the existing data.
          if (!missingSinceRef.current) missingSinceRef.current = Date.now();
          const elapsed = Date.now() - missingSinceRef.current;
          console.warn(`[course] empty snapshot after successful load (${elapsed}ms) — ignoring`);

          if (elapsed >= CONFIRM_MISSING_MS) {
            // Sustained absence — verify with a one-shot read before believing it.
            getDoc(cref)
              .then((d) => {
                if (!d.exists()) {
                  console.warn("[course] confirmed missing via getDoc");
                  setConfirmedMissing(true);
                  setCourse(null);
                  hasLoadedRef.current = false;
                } else {
                  // Doc exists after all — restore from cached snapshot.
                  setCourse(d.data());
                  setProgress(d.data().progress || {});
                  missingSinceRef.current = null;
                }
              })
              .catch((e) => {
                console.warn("[course] getDoc tiebreaker failed:", e?.message);
                // Keep existing data; do nothing.
              });
          }
          return;
        }

        // We never loaded data this session AND the doc is missing. This is real.
        setConfirmedMissing(true);
        setCourse(null);
        setLoading(false);
      },
      (err) => {
        // Listener errors NEVER clear data. Just log and surface a soft banner.
        console.warn("[course] snapshot listener error (will retry):", err?.message);
        if (!hasLoadedRef.current) {
          setLoadError("Could not load this course. Check your connection.");
          setLoading(false);
        }
        // Otherwise: keep showing last-known good data. Listener auto-retries.
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [id, navigate, authLoading, user]);

  useEffect(() => {
    if (!id || !course?.generationId) {
      setDraftModules(null);
      return;
    }
    if (course.generationStatus !== "generating") {
      setDraftModules(null);
      return;
    }
    const dRef = courseGenerationDraftRef(id);
    const unsub = onSnapshot(
      dRef,
      (snap) => {
        if (!snap.exists()) {
          setDraftModules(null);
          return;
        }
        const dm = snap.data();
        if (dm.generationId !== course.generationId) return;
        setDraftModules(Array.isArray(dm.modules) ? dm.modules : null);
      },
      (err) => console.warn("[course] draft listener error (will retry):", err?.message)
    );
    return () => unsub();
  }, [id, course?.generationId, course?.generationStatus]);

  const displayCourse = useMemo(() => {
    if (!course) return null;
    if (course.generationStatus !== "generating" || !Array.isArray(draftModules)) {
      return course;
    }
    return {
      ...course,
      modules: mergeCourseModulesForDisplay(course.modules, draftModules),
    };
  }, [course, draftModules]);

  useEffect(() => {
    if (authLoading || !user?.uid || !id || !course) return;

    if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    touchTimerRef.current = setTimeout(() => {
      touchTimerRef.current = null;
      void touchUserCourseOpened({ uid: user.uid, courseId: id });
      try {
        localStorage.setItem(`cr_last_course_${user.uid}`, id);
      } catch {
        /* noop */
      }
    }, 1200);

    return () => {
      if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    };
  }, [authLoading, user?.uid, id, course]);

  useEffect(() => {
    if (!course?.modules?.length) return;
    const n = course.modules.length;
    if (activeModule >= n) setActiveModule(Math.max(0, n - 1));
  }, [course?.modules?.length, activeModule]);

  useEffect(() => {
    if (authLoading || !user?.uid || !id || !course) return;
    if (course.generationStatus !== "generating") return;
    if (course.userId !== user.uid) return;
    void runOrResumeCourseGeneration(id, user.uid);
    // Intentionally omit `course` — only re-run when generation identity/status changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    authLoading,
    id,
    user?.uid,
    course?.generationStatus,
    course?.userId,
  ]);

  useEffect(() => {
    if (!editOpen || !displayCourse?.modules?.length) return;
    const m = displayCourse.modules[Math.min(activeModule, displayCourse.modules.length - 1)];
    if (!m) return;
    setEditNotes(m.customSectionNotes || "");
    setEditExtra(m.editExtraDetails || "");
    setEditEmphasis(m.editEmphasis || "");
  }, [editOpen, activeModule, displayCourse?.modules]);

  const completedCount = useMemo(() => {
    if (!displayCourse?.modules) return 0;
    return displayCourse.modules.filter((m) => progress[m.id]?.completed || progress[m.id] === true).length;
  }, [displayCourse, progress]);

  const persistProgress = async (newProgress) => {
    if (!course || !displayCourse) return;
    const flat = progressDeltaFlatPatch(course.progress, newProgress);
    if (Object.keys(flat).length === 0) {
      setProgress(newProgress);
      return;
    }

    setProgress(newProgress);
    setCourse({ ...course, progress: newProgress });

    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const writes = [
      updateCourseWithRetry(doc(db, "courses", id), flat, {
        expectedUserId: uid,
      }).then((ok) => {
        if (!ok) console.error("Failed to update course progress after retries");
      }),
    ];

    const completed = displayCourse.modules.filter(
      (m) => newProgress[m.id]?.completed || newProgress[m.id] === true
    ).length;
    const pct =
      displayCourse.modules.length > 0
        ? Math.round((completed / displayCourse.modules.length) * 100)
        : 0;
    writes.push(updateUserCourseProgressMirror({ uid, courseId: id, percent: pct }).catch(() => {}));

    await Promise.all(writes);
  };

  const markComplete = async () => {
    if (!displayCourse?.modules?.length) return;
    const m = displayCourse.modules[Math.min(activeModule, displayCourse.modules.length - 1)];
    if (!m?.id) return;
    const moduleId = m.id;
    const existing = progress[moduleId];
    const next = {
      ...progress,
      [moduleId]: { ...(typeof existing === "object" ? existing : {}), completed: true },
    };
    await persistProgress(next);
  };

  const submitQuiz = async () => {
    if (!displayCourse?.modules?.length) return;
    const m = displayCourse.modules[Math.min(activeModule, displayCourse.modules.length - 1)];
    if (!m?.quiz?.length) return;
    setQuizSubmitted(true);
    const score = m.quiz.filter((q, i) => quizAnswers[i] === q.correctIndex).length;
    const next = {
      ...progress,
      [m.id]: { completed: true, quizScore: score, quizTotal: m.quiz.length },
      [m.id + "_quiz"]: score,
    };
    await persistProgress(next);
  };

  const resetQuiz = () => {
    setQuizAnswers({});
    setQuizSubmitted(false);
  };

  const openModule = (index) => {
    setActiveModule(index);
    setShowQuiz(false);
    resetQuiz();
  };

  const retryGeneration = () => {
    if (!user?.uid) return;
    void runOrResumeCourseGeneration(id, user.uid);
  };

  const saveModuleEdits = async () => {
    if (!displayCourse?.modules?.length) return;
    const idx = Math.min(activeModule, displayCourse.modules.length - 1);
    setEditSaving(true);
    try {
      await mergeCourseModule(id, idx, {
        customSectionNotes: editNotes.trim(),
        editExtraDetails: editExtra.trim(),
        editEmphasis: editEmphasis.trim(),
      });
    } catch (e) {
      console.error(e);
    } finally {
      setEditSaving(false);
    }
  };

  const regenerateActiveModule = async () => {
    if (!displayCourse?.modules?.length) return;
    const idx = Math.min(activeModule, displayCourse.modules.length - 1);
    setRegenerateLoading(true);
    try {
      await mergeCourseModule(id, idx, {
        editExtraDetails: editExtra.trim(),
        editEmphasis: editEmphasis.trim(),
      });
      const snap = await getDoc(doc(db, "courses", id));
      const data = snap.data();
      if (!data?.modules?.[idx]) return;
      const mod = data.modules[idx];
      const topic = String(data.topic || "");
      const level = String(data.level || "");
      const nextMod = await regenerateModuleContent(mod, topic, level, idx, data.modules.length, {
        extraDetails: editExtra.trim(),
        emphasize: editEmphasis.trim(),
      });
      await replaceCourseModule(id, idx, nextMod);
      resetQuiz();
    } catch (e) {
      console.error(e);
    } finally {
      setRegenerateLoading(false);
    }
  };

  if (loading && !course) {
    return (
      <div style={s.root}>
        <Navbar />
        <div style={s.skeletonWrap}>
          <div style={s.skeletonSidebar}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="cr-skeleton" style={{ height: 36, marginBottom: 8 }} />
            ))}
          </div>
          <div style={s.skeletonMain}>
            <div className="cr-skeleton" style={{ height: 28, width: "55%", marginBottom: 12 }} />
            <div className="cr-skeleton" style={{ height: 16, width: "80%", marginBottom: 24 }} />
            <div className="cr-skeleton" style={{ height: 220, marginBottom: 16 }} />
            <div className="cr-skeleton" style={{ height: 80 }} />
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={s.root}>
        <Navbar />
        <div style={s.errorWrap}>
          <div className="cr-card" style={s.errorCard}>
            <div style={s.errorTitle}>Trouble loading this course</div>
            <div style={s.errorBody}>{loadError}</div>
            <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "center" }}>
              <button className="cr-btn cr-btn-ghost" onClick={() => navigate("/dashboard")}>
                Back to Dashboard
              </button>
              <button className="cr-btn cr-btn-primary" onClick={() => window.location.reload()}>
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (confirmedMissing || !course) {
    return (
      <div style={s.root}>
        <Navbar />
        <div style={s.errorWrap}>
          <div className="cr-card" style={s.errorCard}>
            <div style={s.errorTitle}>Course not found</div>
            <div style={s.errorBody}>This course may have been deleted or you don't have access.</div>
            <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "center" }}>
              <button className="cr-btn cr-btn-primary" onClick={() => navigate("/dashboard")}>
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const mods = displayCourse.modules || [];
  const isGeneratingCourse = displayCourse.generationStatus === "generating";
  const genFailed = displayCourse.generationStatus === "failed";
  const courseReady =
    displayCourse.generationStatus === undefined ||
    displayCourse.generationStatus === "complete";

  if (isGeneratingCourse && mods.length === 0) {
    return (
      <div style={s.root}>
        <Navbar />
        <div style={s.errorWrap}>
          <div className="cr-card" style={s.genWaitCard}>
            <div style={s.genSpinnerWrap}>
              <div style={s.genSpinner} />
            </div>
            <div style={s.genWaitTitle}>Designing your course</div>
            <div style={s.genWaitBody}>{displayCourse.generationMessage || "This usually takes less than a minute."}</div>
            <button type="button" className="cr-btn cr-btn-ghost" onClick={() => navigate("/dashboard")} style={{ marginTop: 8 }}>
              ← Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (genFailed && mods.length === 0) {
    return (
      <div style={s.root}>
        <Navbar />
        <div style={s.errorWrap}>
          <div className="cr-card" style={s.genWaitCard}>
            <div style={s.genWaitTitle}>Generation stopped</div>
            <div style={s.genWaitBody}>{displayCourse.generationError || "Something went wrong while creating this course."}</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
              <button type="button" className="cr-btn cr-btn-soft" onClick={retryGeneration}>
                Retry generation
              </button>
              <button type="button" className="cr-btn cr-btn-ghost" onClick={() => navigate("/dashboard")}>
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const ai = mods.length === 0 ? 0 : Math.min(activeModule, mods.length - 1);
  const module = mods[ai];
  const videoProgressMap = displayCourse.videoProgress && typeof displayCourse.videoProgress === "object"
    ? displayCourse.videoProgress
    : {};

  if (!module) {
    return (
      <div style={s.root}>
        <Navbar />
        <div style={s.errorWrap}>
          <div className="cr-card" style={s.errorCard}>
            <div style={s.errorTitle}>Nothing to display yet</div>
            <div style={s.errorBody}>This course has no modules.</div>
            <button type="button" className="cr-btn cr-btn-primary" onClick={() => navigate("/dashboard")}>
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  const progressPct = mods.length > 0
    ? Math.round((completedCount / mods.length) * 100)
    : 0;
  const moduleProgress = module ? progress[module.id] : undefined;
  const isCompleted = moduleProgress?.completed || moduleProgress === true;
  const quizScore = module?.id ? moduleProgress?.quizScore ?? progress[module.id + "_quiz"] : undefined;
  const quizCorrect = module?.quiz
    ? module.quiz.filter((q, i) => quizAnswers[i] === q.correctIndex).length
    : 0;

  return (
    <div style={s.root}>
      <style>{`
        .cr-video-card:hover .cr-video-overlay { opacity: 1 !important; }
        .cr-video-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md) !important; }
        .cr-video-card:hover .cr-video-thumb { opacity: 0.88; }
        .cr-mod-crumb {
          transition: background 160ms ease, box-shadow 200ms ease, transform 160ms ease;
          border: 1px solid transparent !important;
        }
        .cr-mod-crumb:hover:not(.cr-mod-crumb-active) {
          background: rgba(255,255,255,0.04) !important;
          box-shadow: inset 2px 0 0 rgba(99,102,241,0.35);
        }
        .cr-paper-link {
          transition: transform 170ms cubic-bezier(0.22,1,0.36,1), box-shadow 170ms ease;
        }
        .cr-paper-link:hover {
          transform: translateY(-3px);
          box-shadow:
            0 20px 48px rgba(0,0,0,0.32),
            0 0 0 1px rgba(255,255,255,0.06),
            inset 0 1px 0 rgba(255,255,255,0.06) !important;
        }
        .cr-concept-scroll {
          display: flex;
          flex-wrap: nowrap;
          gap: 10px;
          overflow-x: auto;
          padding: 4px 2px 8px;
          margin: 0 -2px;
          scrollbar-width: thin;
          scrollbar-color: rgba(148,163,184,0.35) transparent;
        }
        .cr-concept-scroll::-webkit-scrollbar { height: 5px; }
        .cr-concept-scroll::-webkit-scrollbar-thumb {
          background: rgba(148,163,184,0.28);
          border-radius: 999px;
        }
        .cr-sub-btn {
          flex-shrink: 0;
          white-space: nowrap;
        }
      `}</style>
      <Navbar />

      {genFailed && mods.length > 0 && (
        <div style={s.genBanner}>
          <span style={{ flex: 1 }}>
            Generation paused: {displayCourse.generationError || "Unknown error"}
          </span>
          <button
            type="button"
            className="cr-btn cr-btn-soft"
            style={{ padding: "6px 14px", fontSize: 12 }}
            onClick={retryGeneration}
          >
            Retry
          </button>
        </div>
      )}
      {isGeneratingCourse && mods.length > 0 && (
        <div style={{ ...s.subBarGen, ...(genFailed ? { borderTop: "none" } : {}) }}>
          <div style={{ ...s.enrichingBanner, margin: "0 auto", maxWidth: "1300px" }}>
            <span style={s.enrichingDot} aria-hidden />
            {displayCourse.generationMessage ||
              "Finishing lesson content, quizzes, videos, and papers…"}
          </div>
        </div>
      )}

      <div style={s.subBar}>
        <div style={s.subInner}>
          <div style={s.subTopRow}>
            <div style={s.subTitleWrap}>
              <div style={s.courseTitleNav}>{displayCourse.title}</div>
            </div>
            <div style={s.subRight}>
              <div style={s.progressPill}>
                {progressPct}% complete
              </div>
              {courseReady && (
                <button
                  type="button"
                  className={`cr-btn cr-sub-btn ${editOpen ? "cr-btn-soft" : "cr-btn-ghost"}`}
                  onClick={() => setEditOpen((o) => !o)}
                >
                  {editOpen ? "Close editor" : "Edit course"}
                </button>
              )}
              <button type="button" className="cr-btn cr-btn-ghost cr-sub-btn" onClick={() => navigate("/dashboard")}>
                Dashboard
              </button>
            </div>
          </div>
          {Array.isArray(displayCourse.courseKeyConcepts) && displayCourse.courseKeyConcepts.length > 0 ? (
            <div className="cr-concept-scroll" style={s.courseConceptScrollOuter}>
              {displayCourse.courseKeyConcepts.slice(0, 10).map((kw) => (
                <span key={kw} style={s.courseConceptChip}>
                  {kw}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div style={s.layout}>
        <aside style={s.sidebar}>
          <div style={s.sidebarHead}>
            <div style={s.sidebarLabel}>Modules</div>
            <div style={s.sidebarMeta}>
              {completedCount}/{mods.length} done
            </div>
          </div>

          <div style={s.progTrack}>
            <div style={{ ...s.progFill, width: `${progressPct}%` }} />
          </div>

          <div style={s.modList}>
            {mods.map((m, i) => {
              const done = progress[m.id]?.completed || progress[m.id] === true;
              const active = i === ai;
              return (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => openModule(i)}
                  className={active ? "cr-mod-crumb-active" : "cr-mod-crumb"}
                  style={{
                    ...s.modItem,
                    ...(active ? s.modItemActive : {}),
                  }}
                >
                  <div
                    style={{
                      ...s.modBadge,
                      background: done
                        ? "var(--success)"
                        : active
                        ? "var(--primary)"
                        : "rgba(255,255,255,0.06)",
                      color: done || active ? "#fff" : "var(--text-3)",
                    }}
                  >
                    {done ? "✓" : i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <div
                      style={{
                        fontSize: 13.75,
                        color: active ? "var(--text)" : "var(--text-2)",
                        fontWeight: active ? 600 : 500,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {m.title}
                    </div>
                    <div style={s.modMeta}>
                      {(m.videos?.length || 0)} videos · {(m.papers?.length || 0)} papers
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main style={s.main}>
          {!showQuiz ? (
            <div className="cr-fade" style={s.contentColumn}>
              <div style={s.moduleHeader}>
                <div style={s.moduleTag}>Module {ai + 1} of {mods.length}</div>
                <h1 style={s.moduleTitle}>{module.title}</h1>
                <p style={s.moduleSummary}>{module.summary}</p>
              </div>

              {module.concepts?.length > 0 && (
                <Section title="Key concepts">
                  <div style={s.conceptsRow}>
                    {module.concepts.map((c) => (
                      <span key={c} style={s.conceptTag}>{c}</span>
                    ))}
                  </div>
                </Section>
              )}

              <Section title="Lesson">
                {module.lessons?.length > 0 ? (
                  <div style={s.lessonsContainer}>
                    {module.lessons.map((lesson, i) => (
                      <div key={i} className="cr-card" style={s.lessonBlock}>
                        <h3 style={s.lessonHeading}>{renderLessonInlineMd(lesson.heading, `lh-${i}`)}</h3>
                        <LessonBody text={lesson.text} />
                      </div>
                    ))}
                  </div>
                ) : isGeneratingCourse ? (
                  <div style={s.pendingBlock}>
                    <span style={s.miniSpin} />
                    <span>Generating lessons…</span>
                  </div>
                ) : (
                  <div style={s.empty}>No lesson content available for this module.</div>
                )}
              </Section>

              {typeof module.customSectionNotes === "string" && module.customSectionNotes.trim() ? (
                <Section title="Your notes">
                  <div className="cr-card" style={s.noteCard}>
                    <div style={s.userNotesText}>{module.customSectionNotes.trim()}</div>
                  </div>
                </Section>
              ) : null}

              <Section title="Videos">
                {module.videos?.length > 0 ? (
                  <div style={s.videoList}>
                    {module.videos.map((v) => (
                      <VideoRow
                        key={v.videoId}
                        video={v}
                        courseId={id}
                        stoppedSeconds={
                          typeof videoProgressMap[v.videoId] === "number"
                            ? videoProgressMap[v.videoId]
                            : null
                        }
                      />
                    ))}
                  </div>
                ) : isGeneratingCourse ? (
                  <div style={s.pendingBlock}>
                    <span style={s.miniSpin} />
                    <span>Finding curated videos…</span>
                  </div>
                ) : (
                  <div style={s.empty}>No videos available for this module.</div>
                )}
              </Section>

              <Section title="Research and reading">
                {module.papers?.length > 0 ? (
                  <div style={s.paperList}>
                    {module.papers.map((p, i) => (
                      <a
                        key={i}
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="cr-card cr-paper-link"
                        style={s.paperCard}
                      >
                        <div style={s.paperIcon}>◈</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={s.paperTitle}>{p.title}</div>
                          <div style={s.paperMeta}>
                            {p.authors}
                            {p.year ? ` · ${p.year}` : ""}
                          </div>
                          {p.abstract && <div style={s.paperAbstract}>{p.abstract}</div>}
                        </div>
                        <div style={s.paperArrow}>→</div>
                      </a>
                    ))}
                  </div>
                ) : isGeneratingCourse ? (
                  <div style={s.pendingBlock}>
                    <span style={s.miniSpin} />
                    <span>Fetching related reading…</span>
                  </div>
                ) : (
                  <div style={s.empty}>No papers available for this module.</div>
                )}
              </Section>

              <div style={s.actions}>
                {module.quiz?.length > 0 && (
                  <button
                    className="cr-btn cr-btn-primary"
                    onClick={() => setShowQuiz(true)}
                  >
                    Take module quiz →
                  </button>
                )}
                {!isCompleted ? (
                  <button className="cr-btn cr-btn-soft" onClick={markComplete}>
                    Mark as complete
                  </button>
                ) : (
                  <div style={s.completedBadge}>
                    ✓ Completed
                    {quizScore !== undefined && module.quiz
                      ? ` · Quiz ${quizScore}/${module.quiz.length}`
                      : ""}
                  </div>
                )}
                <button className="cr-btn cr-btn-ghost" onClick={() => setChatOpen(true)}>
                  ✦ Ask AI about this module
                </button>
                {activeModule < mods.length - 1 && (
                  <button className="cr-btn cr-btn-ghost" onClick={() => openModule(activeModule + 1)}>
                    Next module →
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="cr-fade" style={{ maxWidth: "100%" }}>
              <button
                style={s.backBtn}
                onClick={() => {
                  setShowQuiz(false);
                  resetQuiz();
                }}
              >
                ← Back to module
              </button>
              <h2 style={s.quizTitle}>Module {ai + 1} Quiz</h2>
              <p style={s.quizSub}>Test your understanding of {module.title}</p>

              {module.quiz?.map((q, qIndex) => {
                const selected = quizAnswers[qIndex];
                return (
                  <div key={qIndex} className="cr-card" style={s.questionCard}>
                    <div style={s.questionNum}>Question {qIndex + 1}</div>
                    <div style={s.questionText}>{renderLessonInlineMd(q.question, `qq-${qIndex}`)}</div>
                    <div style={s.optionsList}>
                      {q.options.map((opt, optIndex) => {
                        let style = { ...s.option };
                        if (quizSubmitted) {
                          if (optIndex === q.correctIndex) style = { ...style, ...s.optCorrect };
                          else if (optIndex === selected) style = { ...style, ...s.optWrong };
                        } else if (selected === optIndex) {
                          style = { ...style, ...s.optSelected };
                        }
                        return (
                          <div
                            key={optIndex}
                            style={style}
                            onClick={() => {
                              if (quizSubmitted) return;
                              setQuizAnswers((p) => ({ ...p, [qIndex]: optIndex }));
                            }}
                          >
                            <div style={s.optLetter}>{["A", "B", "C", "D"][optIndex]}</div>
                            <div style={{ flex: 1 }}>{renderLessonInlineMd(opt, `qo-${qIndex}-${optIndex}`)}</div>
                          </div>
                        );
                      })}
                    </div>
                    {quizSubmitted && (
                      <div style={s.explanation}>
                        <strong style={{ color: quizAnswers[qIndex] === q.correctIndex ? "var(--success)" : "var(--danger)" }}>
                          {quizAnswers[qIndex] === q.correctIndex ? "✓ Correct. " : "✗ Incorrect. "}
                        </strong>
                        {renderLessonInlineMd(q.explanation, `qe-${qIndex}`)}
                      </div>
                    )}
                  </div>
                );
              })}

              {!quizSubmitted ? (
                <button
                  className="cr-btn cr-btn-primary"
                  style={{ width: "100%", padding: "14px", marginTop: 8 }}
                  disabled={module.quiz && Object.keys(quizAnswers).length < module.quiz.length}
                  onClick={submitQuiz}
                >
                  Submit answers
                </button>
              ) : (
                <div className="cr-card" style={s.resultCard}>
                  <div style={s.scoreNum}>
                    {quizCorrect}
                    <span style={{ fontSize: 26, color: "var(--text-3)" }}>
                      /{module.quiz?.length || 0}
                    </span>
                  </div>
                  <div style={s.scoreLabel}>correct answers</div>
                  <div style={s.resultActions}>
                    <button className="cr-btn cr-btn-ghost" onClick={resetQuiz}>
                      Retry
                    </button>
                    <button
                      className="cr-btn cr-btn-primary"
                      onClick={() => {
                        setShowQuiz(false);
                        resetQuiz();
                        if (activeModule < mods.length - 1) openModule(activeModule + 1);
                        else navigate("/dashboard");
                      }}
                    >
                      {activeModule < mods.length - 1
                        ? "Next module →"
                        : "Finish course ✓"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {editOpen && courseReady && (
        <>
          <button
            type="button"
            style={editUi.backdrop}
            aria-label="Close editor"
            onClick={() => setEditOpen(false)}
          />
          <aside style={editUi.panel}>
            <div style={editUi.panelTitle}>Customize this module</div>
            <p style={editUi.panelHint}>
              Notes save to Firestore immediately. Save keeps your text; regenerate only refreshes AI lessons, quizzes, videos, and papers for{" "}
              <strong>{module.title}</strong>.
            </p>
            <label style={editUi.label}>Topics to emphasize (used when regenerating)</label>
            <textarea
              className="cr-input"
              style={editUi.area}
              value={editEmphasis}
              onChange={(e) => setEditEmphasis(e.target.value)}
              placeholder="e.g. error handling, intuition for derivatives, JSX patterns…"
              rows={3}
            />
            <label style={editUi.label}>Extra detail for the AI to weave in</label>
            <textarea
              className="cr-input"
              style={editUi.area}
              value={editExtra}
              onChange={(e) => setEditExtra(e.target.value)}
              placeholder="Add context only you know—project constraints, prerequisites, pacing…"
              rows={4}
            />
            <label style={editUi.label}>Your notes (shown under lessons)</label>
            <textarea
              className="cr-input"
              style={editUi.area}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Reminders or links—you will see these every time you open this module."
              rows={5}
            />
            <div style={editUi.row}>
              <button
                type="button"
                className="cr-btn cr-btn-soft"
                disabled={editSaving || regenerateLoading}
                onClick={() => void saveModuleEdits()}
              >
                {editSaving ? "Saving…" : "Save notes"}
              </button>
              <button
                type="button"
                className="cr-btn cr-btn-primary"
                disabled={regenerateLoading || editSaving}
                title="Rebuilds AI content for this module only"
                onClick={() => void regenerateActiveModule()}
              >
                {regenerateLoading ? "Regenerating…" : "Regenerate module"}
              </button>
            </div>
          </aside>
        </>
      )}

      <AIChat
        open={chatOpen}
        onOpen={() => setChatOpen(true)}
        onClose={() => setChatOpen(false)}
        course={displayCourse}
        module={module}
      />
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={s.section}>
      <h2 style={s.sectionTitle}>{title}</h2>
      {children}
    </div>
  );
}

const lessonMd = {
  bold: { fontWeight: 650, color: "var(--text)" },
  inlineCode: {
    background: "rgba(99,102,241,0.1)",
    color: "var(--primary-2)",
    padding: "2px 6px",
    borderRadius: 5,
    fontFamily: "ui-monospace, monospace",
    fontSize: "0.9em",
  },
};

function lessonSectionKind(title) {
  const t = String(title || "").toLowerCase();
  if (/drill|exercise|predict|challenge|try this|debug/.test(t)) return "drill";
  if (/mistake|fail|pitfall|break|miss/.test(t)) return "caution";
  if (/tip|insight|shortcut/.test(t)) return "tip";
  if (/takeaway|recap|key pattern/.test(t)) return "takeaway";
  if (/scenario|match|walkthrough|step|case study|workflow|example|build|runs/.test(t)) return "scenario";
  if (/introduction|matters|concept|core/.test(t)) return "lead";
  if (/example|use case|real use/.test(t)) return "scenario";
  if (/quick exercise|exercise/.test(t)) return "drill";
  return "default";
}

function calloutStyleForLabel(label) {
  const l = String(label || "").toLowerCase();
  if (/drill|predict|challenge|exercise|try this|debug|what if/.test(l)) return s.calloutDrill;
  if (/pro tip|pro insight|tip/.test(l)) return s.calloutTip;
  if (/pitfall|mistake|watch out/.test(l)) return s.calloutCaution;
  return s.callout;
}

/** If the model left a lone ** pair, strip the last opener/closer so we never flash broken emphasis. */
function stripOrphanMarkdownEmphasis(text) {
  let t = String(text ?? "");
  const n = (t.match(/\*\*/g) || []).length;
  if (n % 2 === 1) {
    const i = t.lastIndexOf("**");
    if (i !== -1) t = t.slice(0, i) + t.slice(i + 2);
  }
  return t;
}

/** Same subset as AI chat: **bold** and `inline code` (lessons rarely need full CommonMark). */
function renderLessonInlineMd(text, baseKey = "") {
  const src = stripOrphanMarkdownEmphasis(text);
  const result = [];
  const re = /(\*\*(.+?)\*\*|`([^`]+)`)/g;
  let last = 0;
  let m;
  let k = 0;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) {
      result.push(
        <span key={`${baseKey}_t${k++}`}>{src.slice(last, m.index)}</span>
      );
    }
    if (m[2] != null) {
      result.push(
        <strong key={`${baseKey}_b${k++}`} style={lessonMd.bold}>{m[2]}</strong>
      );
    } else if (m[3] != null) {
      result.push(
        <code key={`${baseKey}_c${k++}`} style={lessonMd.inlineCode}>{m[3]}</code>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) {
    result.push(<span key={`${baseKey}_t${k++}`}>{src.slice(last)}</span>);
  }
  return result.length > 0 ? result : src;
}

/** Split lesson text into alternating prose / fenced code segments. */
function splitFencedSegments(text) {
  const src = String(text);
  const segments = [];
  const re = /```([\w+#.-]*)\s*\r?\n?([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) segments.push({ kind: "text", value: src.slice(last, m.index) });
    const lang = (m[1] || "code").trim() || "code";
    segments.push({ kind: "code", lang, value: m[2].replace(/\s+$/, "") });
    last = m.index + m[0].length;
  }
  if (last < src.length) segments.push({ kind: "text", value: src.slice(last) });
  if (segments.length === 0) segments.push({ kind: "text", value: src });
  return segments;
}

/** Paragraphs + bullets + callouts inside prose (no ## headings, no fences). */
function ParagraphBlocks({ text }) {
  if (!text) return null;
  const blocks = String(text)
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
        const isBulleted =
          lines.length >= 2 && lines.every((l) => /^[-*•]\s+/.test(l));

        if (isBulleted) {
          return (
            <ul key={i} style={s.bulletList}>
              {lines.map((line, j) => {
                const clean = line.replace(/^[-*•]\s+/, "");
                return (
                  <li key={j} style={s.bulletItem}>
                    <span style={s.bulletDot} aria-hidden />
                    <span style={s.bulletText}>{renderLessonInlineMd(clean, `li-${i}-${j}`)}</span>
                  </li>
                );
              })}
            </ul>
          );
        }

        const calloutMatch = block.match(
          /^(Example|In practice|Tip|Pro Tip|Note|Remember|Pitfall|Watch out|Exercise|Challenge|Drill|Try This|Visual|Predict|What if)\s*[:\-—]\s*([\s\S]*)/i
        );
        if (calloutMatch) {
          const label = calloutMatch[1];
          return (
            <div key={i} style={calloutStyleForLabel(label)}>
              <span style={s.calloutLabel}>{label}</span>
              <span style={s.calloutText}>{renderLessonInlineMd(calloutMatch[2], `co-${i}`)}</span>
            </div>
          );
        }

        if (lines.length > 1 && !/^[-*•]\s+/.test(lines[0] || "")) {
          const subParas = lines.map((ln) => ln.replace(/^[-*•]\s+/, "").trim()).filter(Boolean);
          if (subParas.length > 1) {
            return (
              <div key={i} style={{ marginBottom: 16 }}>
                {subParas.map((ln, j) => (
                  <p
                    key={j}
                    style={{
                      ...s.lessonParagraph,
                      marginBottom: j === subParas.length - 1 ? 0 : 11,
                    }}
                  >
                    {renderLessonInlineMd(ln, `sp-${i}-${j}`)}
                  </p>
                ))}
              </div>
            );
          }
        }

        return (
          <p key={i} style={s.lessonParagraph}>
            {renderLessonInlineMd(block, `p-${i}`)}
          </p>
        );
      })}
    </>
  );
}

/** Text regions: optional Markdown H2 sections (## Title) + paragraph-blocks. */
function ProseBlocks({ text }) {
  if (!text) return null;
  const normalized = String(text).replace(/\r\n/g, "\n");
  const pieces = normalized.split(/\n(?=## )/).map((p) => p.trim()).filter(Boolean);
  return (
    <>
      {pieces.map((piece, idx) => {
        if (/^##\s+/.test(piece)) {
          const firstNl = piece.indexOf("\n");
          const head = firstNl === -1 ? piece : piece.slice(0, firstNl);
          const body = firstNl === -1 ? "" : piece.slice(firstNl + 1).trim();
          const title = head.replace(/^##\s+/, "").trim();
          const kind = lessonSectionKind(title);
          return (
            <div key={idx} style={{ ...s.lessonSectionWrap, ...s.lessonSectionKind[kind] }}>
              <h3 style={{ ...s.lessonSectionHeading, ...s.lessonSectionHeadingKind[kind] }}>{title}</h3>
              {body ? <ParagraphBlocks text={body} /> : null}
            </div>
          );
        }
        return <ParagraphBlocks key={idx} text={piece} />;
      })}
    </>
  );
}

// Renders lesson `text`:
//    - fenced ```lang ... ``` regions → monospace <pre><code>
//    - prose regions → bullets, callouts, paragraphs
// Plain courses without fences keep working unchanged.
function LessonBody({ text }) {
  if (!text) return null;
  const chunks = splitFencedSegments(text);
  return (
    <div>
      {chunks.map((chunk, i) =>
        chunk.kind === "code" ? (
          <div key={i} style={s.codeBlockWrap}>
            <div style={s.codeBlockFrame}>
              <div style={s.codeToolbar}>
                <span style={s.codeLangPill}>{chunk.lang}</span>
              </div>
              <pre style={s.codePre}>
                <code style={s.codeInner}>{chunk.value}</code>
              </pre>
            </div>
          </div>
        ) : (
          <ProseBlocks key={i} text={chunk.value} />
        )
      )}
    </div>
  );
}

const editUi = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(7,10,18,0.55)",
    backdropFilter: "blur(2px)",
    zIndex: 110,
    border: "none",
    cursor: "pointer",
    padding: 0,
  },
  panel: {
    position: "fixed",
    top: `${COURSE_SCROLL_OFFSET_PX}px`,
    right: 0,
    width: "min(400px, 100vw)",
    height: `calc(100vh - ${COURSE_SCROLL_OFFSET_PX}px)`,
    background: "rgba(17,21,34,0.97)",
    borderLeft: "1px solid var(--border)",
    zIndex: 120,
    overflowY: "auto",
    padding: "22px 20px 32px",
    boxShadow: "-10px 0 32px rgba(0,0,0,0.35)",
  },
  panelTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 17,
    fontWeight: 700,
    color: "var(--text)",
    marginBottom: 4,
  },
  panelHint: {
    fontSize: 12,
    color: "var(--text-3)",
    margin: "0 0 16px",
    lineHeight: 1.55,
  },
  label: {
    display: "block",
    fontSize: 11,
    color: "var(--text-3)",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.55,
    fontWeight: 600,
  },
  area: {
    width: "100%",
    fontSize: 13.5,
    marginBottom: 14,
    minHeight: 0,
    resize: "vertical",
    display: "block",
    lineHeight: 1.5,
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 10,
  },
};

const vidRow = {
  shell: {
    marginTop: 6,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    opacity: 0.88,
    fontSize: 11.5,
    color: "var(--text-3)",
    paddingLeft: 2,
  },
  lab: { flexShrink: 0 },
  inp: {
    flex: "1 1 80px",
    maxWidth: 110,
    fontSize: 12,
    padding: "4px 9px",
  },
  btn: { padding: "4px 10px", fontSize: 11, minHeight: 0 },
};

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

/** Thumbnail row + subtle manual timestamp (persisted per course / user scope). */
function VideoRow({ video, courseId, stoppedSeconds }) {
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
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <VideoCard video={video} />
      <div style={vidRow.shell}>
        <span style={vidRow.lab}>Stopped at</span>
        <input
          className="cr-input"
          type="text"
          style={vidRow.inp}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="5:32"
          aria-label={`Where you left off: ${video.title}`}
        />
        <button
          type="button"
          className="cr-btn cr-btn-ghost"
          style={vidRow.btn}
          disabled={busy}
          onClick={() => void persist()}
        >
          {busy ? "…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function VideoCard({ video }) {
  const ytUrl = "https://www.youtube.com/watch?v=" + video.videoId;
  const thumb =
    video.thumbnail ||
    "https://img.youtube.com/vi/" + video.videoId + "/mqdefault.jpg";

  return (
    <a
      href={ytUrl}
      target="_blank"
      rel="noreferrer"
      className="cr-card cr-video-card"
      style={vc.card}
    >
      <div style={vc.thumbWrap}>
        <img src={thumb} alt={video.title} className="cr-video-thumb" style={vc.thumb} loading="lazy" />
        <div className="cr-video-overlay" style={vc.overlay}>
          <div style={vc.playBtn}>▶</div>
        </div>
        <div style={vc.ytBadge}>
          <svg width="14" height="10" viewBox="0 0 24 17" fill="none">
            <path
              d="M23.495 2.656a3.016 3.016 0 0 0-2.122-2.135C19.505 0 12 0 12 0S4.495 0 2.627.521A3.016 3.016 0 0 0 .505 2.656 31.64 31.64 0 0 0 0 8.5a31.64 31.64 0 0 0 .505 5.844 3.016 3.016 0 0 0 2.122 2.135C4.495 17 12 17 12 17s7.505 0 9.373-.521a3.016 3.016 0 0 0 2.122-2.135A31.64 31.64 0 0 0 24 8.5a31.64 31.64 0 0 0-.505-5.844z"
              fill="#FF0000"
            />
            <path d="M9.545 12.068V4.932L15.818 8.5l-6.273 3.568z" fill="white" />
          </svg>
          YouTube
        </div>
      </div>
      <div style={vc.meta}>
        <div style={vc.title}>{video.title}</div>
        <div style={vc.bottom}>
          <span style={vc.channel}>{video.channel}</span>
          <span style={vc.watchLink}>Watch on YouTube →</span>
        </div>
      </div>
    </a>
  );
}

const vc = {
  card: {
    display: "block",
    textDecoration: "none",
    color: "inherit",
    overflow: "hidden",
    borderRadius: "var(--radius-lg)",
    background: "linear-gradient(155deg, var(--surface) 0%, var(--surface-2) 100%)",
    boxShadow:
      "0 16px 48px rgba(0,0,0,0.32), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.05)",
    transition: "transform 200ms cubic-bezier(0.22,1,0.36,1), box-shadow 200ms ease",
    marginBottom: 6,
    border: "none",
  },
  thumbWrap: {
    position: "relative",
    paddingBottom: "52%",
    background: "linear-gradient(180deg, #0c1020, #000)",
    overflow: "hidden",
    borderRadius: "var(--radius-lg) var(--radius-lg) 0 0",
  },
  thumb: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transition: "opacity 180ms ease",
  },
  overlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.3)",
    opacity: 0,
    transition: "opacity 160ms ease",
  },
  playBtn: {
    width: 54,
    height: 54,
    borderRadius: "50%",
    background: "rgba(15,21,37,0.55)",
    backdropFilter: "blur(8px)",
    border: "1px solid rgba(255,255,255,0.18)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 18,
    color: "#fff",
    boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
  },
  ytBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "rgba(8,11,22,0.78)",
    backdropFilter: "blur(10px)",
    padding: "5px 9px",
    borderRadius: 8,
    fontSize: 11,
    color: "#f1f5f9",
    fontWeight: 600,
    boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.06)",
    letterSpacing: "0.02em",
  },
  meta: {
    padding: "16px 18px 18px",
  },
  title: {
    fontSize: 15,
    color: "var(--text)",
    fontWeight: 600,
    lineHeight: 1.48,
    marginBottom: 10,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  bottom: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  channel: {
    fontSize: 12.5,
    color: "var(--text-3)",
    fontWeight: 500,
  },
  watchLink: {
    fontSize: 12,
    color: "var(--primary-2)",
    fontWeight: 600,
    letterSpacing: "0.01em",
  },
};

const s = {
  root: { minHeight: "100vh" },

  skeletonWrap: {
    display: "grid",
    gridTemplateColumns: `${SIDEBAR_W_PX}px 1fr`,
    minHeight: "calc(100vh - 64px)",
  },
  skeletonSidebar: {
    padding: "22px 14px",
    boxShadow: "4px 0 32px rgba(0,0,0,0.2)",
    background: "linear-gradient(180deg, rgba(15,21,37,0.65), rgba(15,21,37,0.35))",
    borderRight: "none",
  },
  skeletonMain: { padding: "30px 40px" },

  errorWrap: {
    minHeight: "calc(100vh - 64px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 24px",
  },
  errorCard: { padding: "32px 36px", maxWidth: 480, textAlign: "center" },
  errorTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 20,
    color: "var(--text)",
    fontWeight: 700,
    marginBottom: 6,
  },
  errorBody: { fontSize: 14, color: "var(--text-2)", lineHeight: 1.6 },

  genBanner: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "11px 22px",
    background: "linear-gradient(90deg, rgba(239,68,68,0.1), rgba(239,68,68,0.04))",
    borderBottom: "none",
    boxShadow: "inset 0 -1px 0 rgba(239,68,68,0.2)",
    color: "#fca5a5",
    fontSize: 13,
    maxWidth: "100%",
    lineHeight: 1.55,
  },
  subBarGen: {
    borderBottom: "none",
    background: "linear-gradient(180deg, rgba(99,102,241,0.07), rgba(99,102,241,0.02))",
    padding: "10px 20px",
    boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.04)",
  },
  genWaitCard: {
    padding: "40px 32px",
    maxWidth: 460,
    width: "100%",
    textAlign: "center",
  },
  genSpinnerWrap: { marginBottom: 16 },
  genSpinner: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    border: "2px solid rgba(99,102,241,0.25)",
    borderTopColor: "var(--primary-2)",
    animation: "spin 0.85s linear infinite",
    margin: "0 auto",
  },
  genWaitTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text)",
    marginBottom: 10,
  },
  genWaitBody: { fontSize: 14.5, color: "var(--text-2)", lineHeight: 1.65 },

  pendingBlock: {
    fontSize: 13.75,
    color: "var(--text-3)",
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 18px",
    background: "rgba(255,255,255,0.03)",
    borderRadius: "var(--radius)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
    lineHeight: 1.6,
    letterSpacing: "0.02em",
  },
  miniSpin: {
    width: 13,
    height: 13,
    borderRadius: "50%",
    border: "2px solid rgba(99,102,241,0.2)",
    borderTopColor: "var(--primary-2)",
    animation: "spin 0.8s linear infinite",
    flexShrink: 0,
  },
  noteCard: {
    padding: "22px 24px",
    borderLeft: "none",
    background: "linear-gradient(100deg, rgba(99,102,241,0.1), rgba(99,102,241,0.02))",
    borderRadius: "var(--radius-lg)",
    boxShadow: "inset 3px 0 0 rgba(129,140,248,0.5), 0 16px 40px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.04)",
  },
  userNotesText: {
    fontSize: 15.5,
    color: "var(--text-2)",
    lineHeight: 1.86,
    whiteSpace: "pre-wrap",
    letterSpacing: "-0.01em",
  },

  subBar: {
    borderBottom: "1px solid rgba(148,163,184,0.06)",
    background: "rgba(10,14,26,0.72)",
    backdropFilter: "blur(16px)",
    boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
    position: "sticky",
    top: 64,
    zIndex: 30,
  },
  subInner: {
    maxWidth: "1320px",
    margin: "0 auto",
    padding: "16px 32px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  subTopRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 24,
    minHeight: 40,
  },
  subTitleWrap: { flex: 1, minWidth: 0 },
  courseTitleNav: {
    fontFamily: "var(--font-display)",
    fontSize: 15.5,
    color: "var(--text)",
    fontWeight: 650,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    letterSpacing: "-0.02em",
    lineHeight: 1.3,
  },
  courseConceptScrollOuter: { width: "100%" },
  courseConceptChip: {
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: "0.01em",
    textTransform: "none",
    color: "var(--text-2)",
    background: "rgba(255,255,255,0.04)",
    borderRadius: 999,
    padding: "8px 14px",
    flexShrink: 0,
    border: "1px solid rgba(148,163,184,0.1)",
    lineHeight: 1.2,
  },
  subRight: { display: "flex", alignItems: "center", gap: 12, flexShrink: 0 },
  progressPill: {
    display: "inline-flex",
    alignItems: "center",
    background: "rgba(255,255,255,0.05)",
    color: "var(--text-2)",
    fontSize: 13,
    fontWeight: 500,
    padding: "8px 14px",
    borderRadius: 999,
    letterSpacing: "0.01em",
    border: "1px solid rgba(148,163,184,0.08)",
  },

  layout: {
    display: "grid",
    gridTemplateColumns: `${SIDEBAR_W_PX}px 1fr`,
    minHeight: `calc(100vh - ${COURSE_SCROLL_OFFSET_PX}px)`,
  },

  sidebar: {
    borderRight: "none",
    boxShadow: "6px 0 40px rgba(0,0,0,0.22)",
    padding: "22px 12px",
    overflowY: "auto",
    background: "linear-gradient(180deg, rgba(17,21,37,0.92) 0%, rgba(13,17,31,0.85) 100%)",
    position: "sticky",
    top: COURSE_SCROLL_OFFSET_PX,
    height: `calc(100vh - ${COURSE_SCROLL_OFFSET_PX}px)`,
  },
  sidebarHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    padding: "0 8px 12px",
  },
  sidebarLabel: {
    fontSize: 10.5,
    color: "var(--text-3)",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    fontWeight: 700,
  },
  sidebarMeta: { fontSize: 12.5, color: "var(--text-2)", fontWeight: 500 },
  progTrack: {
    height: 5,
    background: "rgba(255,255,255,0.05)",
    borderRadius: 999,
    overflow: "hidden",
    margin: "0 8px 16px",
    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.35)",
  },
  progFill: {
    height: "100%",
    background: "linear-gradient(90deg, var(--primary), var(--accent))",
    transition: "width 360ms ease",
  },
  modList: { display: "flex", flexDirection: "column", gap: 6 },
  modItem: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 12px",
    borderRadius: 11,
    cursor: "pointer",
    width: "100%",
    background: "rgba(255,255,255,0.015)",
    textAlign: "left",
    color: "inherit",
    outline: "none",
  },
  modItemActive: {
    background: "rgba(99,102,241,0.1)",
    boxShadow: "inset 3px 0 0 rgba(129,140,248,0.85)",
    borderRadius: 11,
  },
  modBadge: {
    width: 29,
    height: 29,
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11.5,
    fontWeight: 700,
    flexShrink: 0,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
  },
  modMeta: { fontSize: 11.5, color: "var(--text-3)", marginTop: 3, letterSpacing: "0.02em", fontWeight: 500 },

  main: {
    padding: `${MAIN_PAD.py} ${MAIN_PAD.px} ${MAIN_PAD.pb}`,
    overflowY: "auto",
    background: "rgba(8,11,20,0.4)",
  },
  contentColumn: {
    maxWidth: CONTENT_MAX_W,
    width: "100%",
  },

  enrichingBanner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "linear-gradient(120deg, rgba(99,102,241,0.16), rgba(99,102,241,0.05))",
    border: "none",
    boxShadow: "0 12px 36px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)",
    color: "var(--primary-2)",
    fontSize: 13,
    padding: "11px 18px",
    borderRadius: "var(--radius)",
    marginBottom: 22,
    maxWidth: "100%",
    lineHeight: 1.55,
  },
  enrichingDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--primary)",
    boxShadow: "0 0 10px var(--primary)",
    flexShrink: 0,
    animation: "ai-bounce 1.2s infinite ease-in-out",
  },
  moduleHeader: { marginBottom: 24, maxWidth: "100%", paddingBottom: 2 },
  moduleTag: {
    fontSize: 10.5,
    color: "var(--primary-2)",
    fontWeight: 700,
    marginBottom: 8,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    opacity: 0.95,
  },
  moduleTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 30,
    fontWeight: 750,
    color: "var(--text)",
    letterSpacing: "-0.5px",
    lineHeight: 1.15,
    marginBottom: 12,
  },
  moduleSummary: {
    fontSize: 17,
    color: "var(--text-2)",
    lineHeight: 1.72,
    fontWeight: 400,
    letterSpacing: "-0.01em",
  },

  section: { marginBottom: 44, maxWidth: "100%" },
  sectionTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 11.5,
    fontWeight: 650,
    color: "var(--text-3)",
    marginBottom: 18,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
  },

  conceptsRow: { display: "flex", flexWrap: "wrap", gap: 10 },
  conceptTag: {
    background: "linear-gradient(125deg, rgba(99,102,241,0.18), rgba(99,102,241,0.06))",
    border: "none",
    color: "var(--primary-2)",
    fontSize: 12.5,
    padding: "7px 14px",
    borderRadius: 999,
    boxShadow: "0 6px 22px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.06)",
    letterSpacing: "0.02em",
    fontWeight: 500,
  },

  lessonsContainer: { display: "flex", flexDirection: "column", gap: 32 },
  videoList: { display: "flex", flexDirection: "column", gap: 18 },
  lessonBlock: {
    padding: "36px 38px 40px",
    borderRadius: "var(--radius-lg)",
    border: "1px solid rgba(148,163,184,0.07)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.03)",
    background: "var(--surface)",
  },
  lessonHeading: {
    fontFamily: "var(--font-display)",
    fontSize: 21,
    fontWeight: 700,
    color: "var(--text)",
    letterSpacing: "-0.35px",
    lineHeight: 1.3,
    marginBottom: 28,
    paddingBottom: 20,
    borderBottom: "1px solid rgba(148,163,184,0.08)",
  },
  lessonSectionWrap: {
    marginBottom: 26,
    padding: "20px 22px 22px",
    borderRadius: 11,
    background: "rgba(255,255,255,0.02)",
    border: "1px solid rgba(148,163,184,0.06)",
  },
  lessonSectionKind: {
    default: {},
    lead: { background: "rgba(255,255,255,0.025)" },
    drill: {
      background: "rgba(34,211,238,0.04)",
      borderColor: "rgba(34,211,238,0.12)",
    },
    caution: {
      background: "rgba(251,191,36,0.04)",
      borderColor: "rgba(251,191,36,0.1)",
    },
    tip: {
      background: "rgba(99,102,241,0.05)",
      borderColor: "rgba(99,102,241,0.1)",
    },
    takeaway: {
      background: "rgba(255,255,255,0.03)",
      borderColor: "rgba(148,163,184,0.08)",
    },
    scenario: {},
  },
  lessonSectionHeading: {
    fontFamily: "var(--font-display)",
    fontSize: 14.5,
    fontWeight: 650,
    color: "var(--text)",
    letterSpacing: "-0.02em",
    textTransform: "none",
    margin: "0 0 14px",
    lineHeight: 1.35,
  },
  lessonSectionHeadingKind: {
    default: {},
    lead: { fontSize: 15.5 },
    drill: { color: "rgba(34,211,238,0.95)" },
    caution: { color: "rgba(251,191,36,0.95)" },
    tip: { color: "var(--primary-2)" },
    takeaway: { color: "var(--text)" },
    scenario: {},
  },
  lessonParagraph: {
    fontSize: 17,
    color: "var(--text-2)",
    lineHeight: 1.82,
    marginBottom: 18,
    letterSpacing: "-0.01em",
    maxWidth: "72ch",
  },
  bulletList: {
    listStyle: "none",
    padding: 0,
    margin: "6px 0 18px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  bulletItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    fontSize: 16,
    color: "var(--text-2)",
    lineHeight: 1.72,
    letterSpacing: "-0.01em",
    maxWidth: "72ch",
  },
  bulletDot: {
    color: "rgba(148,163,184,0.55)",
    fontSize: 8,
    lineHeight: 2.2,
    flexShrink: 0,
    marginTop: 2,
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "rgba(129,140,248,0.65)",
    display: "inline-block",
  },
  bulletText: { flex: 1 },
  callout: {
    background: "rgba(255,255,255,0.03)",
    borderRadius: 10,
    padding: "14px 16px",
    margin: "10px 0 16px",
    fontSize: 15.5,
    lineHeight: 1.72,
    color: "var(--text-2)",
    border: "1px solid rgba(148,163,184,0.08)",
    maxWidth: "72ch",
  },
  calloutDrill: {
    background: "rgba(34,211,238,0.06)",
    borderRadius: 10,
    padding: "16px 18px",
    margin: "12px 0 18px",
    fontSize: 15.5,
    lineHeight: 1.72,
    color: "var(--text)",
    border: "1px solid rgba(34,211,238,0.14)",
    maxWidth: "72ch",
  },
  calloutTip: {
    background: "rgba(99,102,241,0.07)",
    borderRadius: 10,
    padding: "14px 16px",
    margin: "10px 0 16px",
    fontSize: 15.5,
    lineHeight: 1.72,
    color: "var(--text-2)",
    border: "1px solid rgba(99,102,241,0.12)",
    maxWidth: "72ch",
  },
  calloutCaution: {
    background: "rgba(251,191,36,0.06)",
    borderRadius: 10,
    padding: "14px 16px",
    margin: "10px 0 16px",
    fontSize: 15.5,
    lineHeight: 1.72,
    color: "var(--text-2)",
    border: "1px solid rgba(251,191,36,0.12)",
    maxWidth: "72ch",
  },
  calloutLabel: {
    fontWeight: 650,
    color: "var(--text)",
    marginRight: 8,
    fontSize: 13,
    letterSpacing: "0.02em",
    textTransform: "uppercase",
    fontSize: 11,
    letterSpacing: "0.1em",
  },
  calloutText: {},

  codeBlockWrap: { margin: "22px 0 28px" },
  codeBlockFrame: {
    borderRadius: "var(--radius-lg)",
    overflow: "hidden",
    boxShadow:
      "0 18px 48px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.04)",
  },
  codeToolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px 9px",
    background: "linear-gradient(180deg, rgba(24,30,50,0.98), rgba(14,18,32,0.96))",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
  },
  codeLangPill: {
    display: "inline-flex",
    alignItems: "center",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    color: "rgba(196,203,220,0.92)",
    background: "rgba(255,255,255,0.05)",
    border: "none",
    borderRadius: 6,
    padding: "5px 11px",
    fontFamily: "var(--font-sans)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
  },
  codePre: {
    margin: 0,
    padding: "20px 22px 22px",
    background: "linear-gradient(180deg, rgba(6,8,16,0.92) 0%, rgba(4,6,12,0.98) 100%)",
    border: "none",
    borderRadius: 0,
    overflowX: "auto",
    maxHeight: "min(520px, 62vh)",
  },
  codeInner: {
    fontFamily:
      "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 13.25,
    lineHeight: 1.68,
    color: "#e4e7ef",
    whiteSpace: "pre",
    tabSize: 2,
    display: "block",
    fontFeatureSettings: '"liga" 1, "calt" 1',
  },

  paperList: { display: "flex", flexDirection: "column", gap: 14 },
  paperCard: {
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    padding: "18px 20px",
    cursor: "pointer",
    textDecoration: "none",
    color: "inherit",
    borderRadius: "var(--radius-lg)",
    border: "1px solid rgba(148,163,184,0.07)",
    boxShadow:
      "0 12px 36px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.04)",
    background: "linear-gradient(145deg, var(--surface) 0%, rgba(26,34,56,0.85) 100%)",
    transition: "transform 160ms ease, box-shadow 160ms ease",
  },
  paperIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: "var(--primary-soft)",
    color: "var(--primary-2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    flexShrink: 0,
    marginTop: 2,
  },
  paperTitle: {
    fontSize: 15,
    color: "var(--text)",
    fontWeight: 600,
    marginBottom: 6,
    lineHeight: 1.45,
    letterSpacing: "-0.02em",
  },
  paperMeta: {
    fontSize: 12.5,
    color: "var(--text-3)",
    marginBottom: 8,
    fontWeight: 500,
    letterSpacing: "0.02em",
  },
  paperAbstract: {
    fontSize: 13.5,
    color: "var(--text-2)",
    lineHeight: 1.75,
    letterSpacing: "-0.01em",
  },
  paperArrow: { fontSize: 16, color: "var(--text-3)", flexShrink: 0, marginTop: 4 },

  empty: {
    fontSize: 14,
    color: "var(--text-3)",
    padding: "16px 20px",
    background: "rgba(255,255,255,0.035)",
    borderRadius: "var(--radius)",
    border: "none",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.12)",
    lineHeight: 1.6,
  },

  actions: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    paddingTop: 28,
    marginTop: 28,
    borderTop: "none",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
    maxWidth: "100%",
  },
  completedBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "linear-gradient(120deg, rgba(16,185,129,0.16), rgba(16,185,129,0.05))",
    border: "none",
    color: "var(--success)",
    fontSize: 13.5,
    fontWeight: 600,
    padding: "10px 16px",
    borderRadius: 999,
    boxShadow:
      "0 8px 24px rgba(16,185,129,0.12), inset 0 1px 0 rgba(255,255,255,0.08)",
  },

  backBtn: {
    background: "none",
    border: "none",
    color: "var(--text-3)",
    fontSize: 13,
    cursor: "pointer",
    marginBottom: 18,
    padding: 0,
    display: "block",
  },
  quizTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 25,
    fontWeight: 800,
    color: "var(--text)",
    letterSpacing: "-0.45px",
    marginBottom: 8,
    lineHeight: 1.15,
  },
  quizSub: {
    fontSize: 15,
    color: "var(--text-2)",
    marginBottom: 28,
    lineHeight: 1.65,
    letterSpacing: "-0.01em",
  },
  questionCard: {
    padding: "26px 28px",
    marginBottom: 18,
    borderRadius: "var(--radius-lg)",
    border: "1px solid rgba(148,163,184,0.08)",
    boxShadow:
      "0 16px 42px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.04)",
    background: "linear-gradient(160deg, var(--surface) 0%, var(--surface-2) 100%)",
  },
  questionNum: {
    fontSize: 11,
    color: "var(--primary-2)",
    fontWeight: 700,
    marginBottom: 8,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  questionText: {
    fontSize: 16,
    color: "var(--text)",
    fontWeight: 500,
    marginBottom: 16,
    lineHeight: 1.72,
    letterSpacing: "-0.02em",
  },
  optionsList: { display: "flex", flexDirection: "column", gap: 10 },
  option: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 16px",
    background: "rgba(255,255,255,0.035)",
    border: "none",
    borderRadius: "var(--radius)",
    cursor: "pointer",
    fontSize: 15,
    color: "var(--text-2)",
    transition: "all 140ms ease",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 16px rgba(0,0,0,0.12)",
    lineHeight: 1.55,
  },
  optSelected: {
    background: "linear-gradient(100deg, rgba(99,102,241,0.16), rgba(99,102,241,0.05))",
    border: "none",
    color: "var(--text)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 22px rgba(99,102,241,0.15)",
  },
  optCorrect: {
    background: "rgba(16,185,129,0.13)",
    border: "none",
    color: "var(--text)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 4px 16px rgba(16,185,129,0.12)",
  },
  optWrong: {
    background: "rgba(239,68,68,0.1)",
    border: "none",
    color: "var(--text)",
    boxShadow: "0 4px 16px rgba(239,68,68,0.12)",
  },
  optLetter: {
    width: 24,
    height: 24,
    borderRadius: 6,
    background: "rgba(255,255,255,0.06)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  },
  explanation: {
    marginTop: 14,
    fontSize: 14,
    color: "var(--text-2)",
    lineHeight: 1.72,
    padding: "14px 17px",
    background: "linear-gradient(95deg, rgba(99,102,241,0.08), rgba(99,102,241,0.02))",
    borderRadius: "var(--radius)",
    border: "none",
    boxShadow: "inset 3px 0 0 rgba(129,140,248,0.35), inset 0 1px 0 rgba(255,255,255,0.03)",
  },
  resultCard: {
    padding: "38px 32px",
    textAlign: "center",
    marginTop: 16,
    borderRadius: "var(--radius-lg)",
    border: "1px solid rgba(148,163,184,0.08)",
    boxShadow:
      "0 20px 50px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.04)",
  },
  scoreNum: {
    fontFamily: "var(--font-display)",
    fontSize: 60,
    fontWeight: 800,
    color: "var(--text)",
    lineHeight: 1,
  },
  scoreLabel: {
    fontSize: 13,
    color: "var(--text-3)",
    marginTop: 8,
    marginBottom: 24,
  },
  resultActions: { display: "flex", gap: 10, justifyContent: "center" },
};

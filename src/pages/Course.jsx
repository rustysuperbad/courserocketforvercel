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
} from "../lib/coursePipeline";
import {
  courseGenerationDraftRef,
  mergeCourseModulesForDisplay,
} from "../lib/courseGenerationDraft";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import AIChat from "../components/AIChat";
import PracticeBento from "../components/PracticeBento";
import {
  SANDBOX_STARTERS,
  courseNeedsSandbox,
  detectSandboxLanguage,
  moduleStarter,
} from "../components/learn/sandboxLanguages";
import GenerateStartOverlay from "../components/GenerateStartOverlay";
import "../styles/learn.css";
import GenerationTheatre from "../components/GenerationTheatre";
import { splitLearnerRequest } from "../lib/lessonContentQuality";

/** Total offset from viewport top where course chrome begins (sticky sub-bar under global nav). */
const COURSE_SCROLL_OFFSET_PX = 118;

const SIDEBAR_W_PX = 300;

export default function Course() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, authLoading } = useAuth();
  const [course, setCourse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeModule, setActiveModule] = useState(0);
  const [progress, setProgress] = useState({});
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
  const [sandboxLang, setSandboxLang] = useState("python");
  const [sandboxBuffers, setSandboxBuffers] = useState(() => ({ ...SANDBOX_STARTERS }));
  const sandboxSeedRef = useRef("");
  const sandboxLangSeedRef = useRef("");

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

  const showSandbox = useMemo(() => courseNeedsSandbox(displayCourse), [displayCourse]);

  useEffect(() => {
    if (!displayCourse || !showSandbox) return;
    const courseKey = id || displayCourse.title || "course";
    if (sandboxLangSeedRef.current === courseKey) return;
    sandboxLangSeedRef.current = courseKey;
    setSandboxLang(detectSandboxLanguage(displayCourse) || "python");
  }, [displayCourse, showSandbox, id]);

  useEffect(() => {
    if (!showSandbox) return;
    const list = displayCourse?.modules || [];
    if (!list.length) return;
    const idx = Math.min(activeModule, list.length - 1);
    const m = list[idx];
    const key = `${m?.id || `mod-${idx}`}:${sandboxLang}`;
    if (sandboxSeedRef.current === key) return;
    sandboxSeedRef.current = key;
    const next = moduleStarter(sandboxLang, m.title || "module");
    setSandboxBuffers((current) => ({ ...current, [sandboxLang]: next }));
  }, [displayCourse, activeModule, sandboxLang, showSandbox]);

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
      <div className="cr-course-root" style={s.root}>
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
      <div className="cr-course-root" style={s.root}>
        <Navbar />
        <div style={s.errorWrap}>
          <div className="cr-card" style={s.errorCard}>
            <div style={s.errorTitle}>Trouble loading this course</div>
            <div style={s.errorBody}>{loadError}</div>
            <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "center" }}>
              <button className="cr-btn cr-btn-ghost" onClick={() => navigate("/dashboard")}>
                Back to courses
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
      <div className="cr-course-root" style={s.root}>
        <Navbar />
        <div style={s.errorWrap}>
          <div className="cr-card" style={s.errorCard}>
            <div style={s.errorTitle}>Course not found</div>
            <div style={s.errorBody}>This course may have been deleted or you don't have access.</div>
            <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "center" }}>
              <button className="cr-btn cr-btn-primary" onClick={() => navigate("/dashboard")}>
                Back to courses
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
    const { goal } = splitLearnerRequest(displayCourse.topic || displayCourse.title || "");
    const genTotal = Number(displayCourse.generationProgressTotal) || 0;
    const genDone = Number(displayCourse.generationProgressDone) || 0;
    const pct = genTotal > 0 ? Math.min(92, Math.round((genDone / genTotal) * 100)) : 12;
    return (
      <div className="cr-course-root" style={s.root}>
        <GenerateStartOverlay
          goal={goal}
          stage={displayCourse.generationMessage || "design"}
          note={displayCourse.generationMessage || "Designing the modules."}
          percent={pct}
          status="running"
        />
      </div>
    );
  }

  if (genFailed && mods.length === 0) {
    return (
      <div className="cr-course-root" style={s.root}>
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
                Back to courses
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
      <div className="cr-course-root" style={s.root}>
        <Navbar />
        <div style={s.errorWrap}>
          <div className="cr-card" style={s.errorCard}>
            <div style={s.errorTitle}>Nothing to display yet</div>
            <div style={s.errorBody}>This course has no modules.</div>
            <button type="button" className="cr-btn cr-btn-primary" onClick={() => navigate("/dashboard")}>
              Back to courses
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
    <div className="cr-course-root" style={s.root}>
      <style>{`
        .cr-mod-crumb {
          transition: background 160ms ease, box-shadow 200ms ease, transform 160ms ease;
          border: 1px solid transparent !important;
        }
        .cr-mod-crumb:hover:not(.cr-mod-crumb-active) {
          background: var(--surface-2) !important;
          box-shadow: inset 2px 0 0 var(--ink);
        }
        .cr-paper-link {
          transition: background 160ms ease;
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
        <div className="cr-course-theatre">
          <GenerationTheatre
            stage={displayCourse.generationMessage || "write"}
            note={displayCourse.generationMessage || "Writing the next module."}
            percent={
              Number(displayCourse.generationProgressTotal) > 0
                ? Math.min(
                    96,
                    Math.round(
                      (Number(displayCourse.generationProgressDone || 0) /
                        Number(displayCourse.generationProgressTotal)) *
                        100
                    )
                  )
                : 28
            }
            status="running"
          />
        </div>
      )}

      <div className="cr-course-subbar" style={s.subBar}>
        <div style={s.subInner}>
          <div style={s.subTopRow} className="cr-sub-top-row">
            <div style={s.subTitleWrap}>
              <div style={s.courseTitleNav}>{displayCourse.title}</div>
            </div>
            <div style={s.subRight} className="cr-sub-right">
              <div style={s.progressPill} className="cr-progress-pill">
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
                Courses
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

      <div style={s.layout} className="cr-course-layout">
        <aside style={s.sidebar} className="cr-course-sidebar">
          <div style={s.sidebarHead} className="cr-sidebar-head">
            <div style={s.sidebarLabel}>Modules</div>
            <div style={s.sidebarMeta}>
              {completedCount}/{mods.length} done
            </div>
          </div>

          <div style={s.progTrack}>
            <div style={{ ...s.progFill, width: `${progressPct}%` }} />
          </div>

          <div style={s.modList} className="cr-course-mod-list">
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
                      background: done || active ? "var(--ink)" : "var(--surface-2)",
                      color: done || active ? "var(--canvas)" : "var(--text-3)",
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

        <main style={s.main} className="cr-course-main">
          <article className="cr-course-lesson cr-fade">
            <p className="cr-kicker">Course</p>
            <div style={s.moduleTag}>Module {ai + 1} of {mods.length}</div>
            <h1 style={s.moduleTitle}>{module.title}</h1>
            <p style={s.moduleSummary}>{module.summary}</p>

            {module.concepts?.length > 0 && (
              <div style={{ ...s.conceptsRow, margin: "18px 0 24px" }}>
                {module.concepts.map((c) => (
                  <span key={c} style={s.conceptTag}>{c}</span>
                ))}
              </div>
            )}

            {module.lessons?.length > 0 ? (
              <div style={s.lessonsContainer}>
                {module.lessons.map((lesson, i) => (
                  <div key={i} className="cr-lesson-card" style={s.lessonBlock}>
                    <h3 style={s.lessonHeading}>{renderLessonInlineMd(lesson.heading, `lh-${i}`)}</h3>
                    <LessonBody text={lesson.text} />
                  </div>
                ))}
              </div>
            ) : isGeneratingCourse ? (
              <div style={s.pendingBlock}>
                <span style={s.miniSpin} />
                <span>Writing this module…</span>
              </div>
            ) : module.generationQuality === "failed" ? (
              <div style={s.empty}>This module did not write cleanly. Open Edit course and regenerate it.</div>
            ) : (
              <div style={s.empty}>No lesson content available for this module.</div>
            )}

            {course?.generationQuality === "template-fallback" ? (
              <p role="status" style={{ marginTop: 18, color: "var(--text-2)", fontSize: 16, lineHeight: 1.5 }}>
                This outline is a starter structure. Try generating the course again.
              </p>
            ) : null}
            {module.generationQuality === "template-fallback" || module.generationQuality === "failed" ? (
              <p role="status" style={{ marginTop: 18, color: "var(--text-2)", fontSize: 16, lineHeight: 1.5 }}>
                This module needs another write. Use Edit course → Regenerate module.
              </p>
            ) : null}
            {module.sources?.length > 0 ? (
              <div style={{ display: "grid", gap: 8, marginTop: 24 }}>
                {module.sources.map((source, index) => (
                  <a
                    key={source.url || index}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "flex", gap: 10, alignItems: "baseline", color: "var(--primary-2)", textDecoration: "none", fontSize: 13, lineHeight: 1.5 }}
                  >
                    <span style={{ flex: "0 0 auto", opacity: 0.75 }}>[{source.id || index + 1}]</span>
                    <span>{source.title || source.url}</span>
                    <span aria-hidden="true" style={{ flex: "0 0 auto", opacity: 0.7 }}>↗</span>
                  </a>
                ))}
              </div>
            ) : null}

            {typeof module.customSectionNotes === "string" && module.customSectionNotes.trim() ? (
              <div style={{ ...s.userNotesText, marginTop: 24 }}>{module.customSectionNotes.trim()}</div>
            ) : null}

            <div style={s.actions}>
              {!isCompleted ? (
                <button className="cr-btn cr-btn-primary" onClick={markComplete}>
                  Mark as complete
                </button>
              ) : (
                <div style={s.completedBadge}>
                  Done
                  {quizScore !== undefined && module.quiz
                    ? ` · Quiz ${quizScore}/${module.quiz.length}`
                    : ""}
                </div>
              )}
              <button className="cr-btn cr-btn-ghost" onClick={() => setChatOpen(true)}>
                Ask about this module
              </button>
              {activeModule < mods.length - 1 && (
                <button className="cr-btn cr-btn-ghost" onClick={() => openModule(activeModule + 1)}>
                  Next module →
                </button>
              )}
            </div>
          </article>

          <PracticeBento
            showSandbox={showSandbox}
            isGenerating={isGeneratingCourse}
            sandboxLang={sandboxLang}
            onSandboxLang={setSandboxLang}
            sandboxCode={sandboxBuffers[sandboxLang] || SANDBOX_STARTERS.python}
            onSandboxCode={(value) => setSandboxBuffers((current) => ({ ...current, [sandboxLang]: value }))}
            videos={module.videos || []}
            videoProgressMap={videoProgressMap}
            courseId={id}
            papers={module.papers || []}
            quiz={module.quiz || []}
            quizAnswers={quizAnswers}
            quizSubmitted={quizSubmitted}
            onQuizPick={(qIndex, optIndex) => {
              if (quizSubmitted) return;
              setQuizAnswers((prev) => ({ ...prev, [qIndex]: optIndex }));
            }}
            onQuizSubmit={submitQuiz}
            onQuizReset={resetQuiz}
            quizCorrect={quizCorrect}
            nextLabel={activeModule < mods.length - 1 ? "Next module →" : "Finish course"}
            onNext={() => {
              resetQuiz();
              if (activeModule < mods.length - 1) openModule(activeModule + 1);
              else navigate("/dashboard");
            }}
            renderText={renderLessonInlineMd}
          />
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

const lessonMd = {
  bold: { fontWeight: 650, color: "var(--text)" },
  inlineCode: {
    background: "var(--surface-2)",
    color: "var(--text-3)",
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
    background: "var(--surface)",
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

const s = {
  root: { minHeight: "100vh" },

  skeletonWrap: {
    display: "grid",
    gridTemplateColumns: `${SIDEBAR_W_PX}px 1fr`,
    minHeight: "calc(100vh - 64px)",
  },
  skeletonSidebar: {
    padding: "22px 14px",
    background: "var(--canvas)",
    borderRight: "var(--hairline)",
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
    background: "var(--surface)",
    borderBottom: "var(--hairline)",
    boxShadow: "none",
    color: "var(--danger)",
    fontSize: 13,
    maxWidth: "100%",
    lineHeight: 1.55,
  },
  subBarGen: {
    borderBottom: "none",
    background: "var(--canvas)",
    padding: "10px 20px",
    boxShadow: "none",
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
    border: "2px solid var(--surface-3)",
    borderTopColor: "var(--ink)",
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
    background: "var(--surface-2)",
    borderRadius: "var(--radius)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
    lineHeight: 1.6,
    letterSpacing: "0.02em",
  },
  miniSpin: {
    width: 13,
    height: 13,
    borderRadius: "50%",
    border: "2px solid var(--surface-3)",
    borderTopColor: "var(--ink)",
    animation: "spin 0.8s linear infinite",
    flexShrink: 0,
  },
  noteCard: {
    padding: "22px 24px",
    borderLeft: "none",
    background: "var(--surface)",
    border: "var(--hairline)",
    borderRadius: "var(--radius)",
    boxShadow: "none",
  },
  userNotesText: {
    fontSize: 15.5,
    color: "var(--text-2)",
    lineHeight: 1.86,
    whiteSpace: "pre-wrap",
    letterSpacing: "-0.01em",
  },

  subBar: {
    borderBottom: "var(--hairline)",
    background: "var(--canvas)",
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
    background: "transparent",
    borderRadius: 0,
    padding: "0 12px 0 0",
    flexShrink: 0,
    border: 0,
    lineHeight: 1.2,
  },
  subRight: { display: "flex", alignItems: "center", gap: 12, flexShrink: 0 },
  progressPill: {
    display: "inline-flex",
    alignItems: "center",
    background: "transparent",
    color: "var(--text-2)",
    fontSize: 13,
    fontWeight: 600,
    padding: 0,
    borderRadius: 0,
    letterSpacing: "0.025em",
    textTransform: "uppercase",
    border: 0,
  },

  layout: {
    display: "grid",
    gridTemplateColumns: `${SIDEBAR_W_PX}px 1fr`,
    gap: 12,
    minHeight: `calc(100vh - ${COURSE_SCROLL_OFFSET_PX}px)`,
  },

  sidebar: {
    borderRight: "none",
    boxShadow: "none",
    padding: "22px 18px",
    overflowY: "auto",
    background: "transparent",
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
    height: 2,
    background: "var(--surface-3)",
    borderRadius: 0,
    overflow: "hidden",
    margin: "0 8px 16px",
    boxShadow: "none",
  },
  progFill: {
    height: "100%",
    background: "var(--ink)",
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
    background: "transparent",
    textAlign: "left",
    color: "inherit",
    outline: "none",
  },
  modItemActive: {
    background: "var(--surface-2)",
    boxShadow: "inset 3px 0 0 var(--ink)",
    borderRadius: 2,
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
    padding: 0,
    overflowY: "auto",
    background: "transparent",
    minWidth: 0,
  },

  enrichingBanner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "transparent",
    border: 0,
    boxShadow: "none",
    color: "var(--text-1)",
    fontSize: 13,
    padding: 0,
    borderRadius: 0,
    marginBottom: 22,
    maxWidth: "100%",
    lineHeight: 1.55,
  },
  enrichingDot: {
    width: 8,
    height: 8,
    borderRadius: 50,
    background: "var(--ink)",
    boxShadow: "none",
    flexShrink: 0,
  },
  moduleHeader: { marginBottom: 24, maxWidth: "100%", paddingBottom: 2 },
  moduleTag: {
    fontSize: 10.5,
    color: "var(--text-3)",
    fontWeight: 700,
    marginBottom: 8,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    opacity: 0.95,
  },
  moduleTitle: {
    fontFamily: "var(--font-display)",
    fontSize: "clamp(28px, 3.2vw, 42px)",
    fontWeight: 400,
    color: "var(--text)",
    letterSpacing: "-0.04em",
    lineHeight: 1.12,
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
    background: "var(--surface)",
    border: "var(--hairline)",
    color: "var(--text-2)",
    fontSize: 12.5,
    padding: "7px 14px",
    borderRadius: "var(--radius-pill)",
    boxShadow: "none",
    letterSpacing: "0.02em",
    fontWeight: 500,
  },

  lessonsContainer: { display: "flex", flexDirection: "column", gap: 32 },
  videoList: { display: "flex", flexDirection: "column", gap: 18 },
  lessonBlock: {
    padding: "0 0 32px",
    borderRadius: 0,
    border: 0,
    borderBottom: "var(--hairline)",
    boxShadow: "none",
    background: "transparent",
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
    borderRadius: "var(--radius-nested)",
    background: "var(--surface-2)",
    border: "var(--hairline)",
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
      background: "var(--accent-soft)",
      borderColor: "var(--border)",
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
    background: "var(--surface-2)",
    borderRadius: "var(--radius-nested)",
    padding: "14px 16px",
    margin: "10px 0 16px",
    fontSize: 15.5,
    lineHeight: 1.72,
    color: "var(--text-2)",
    border: "var(--hairline)",
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
    textTransform: "uppercase",
    fontSize: 11,
    letterSpacing: "0.1em",
  },
  calloutText: {},

  codeBlockWrap: { margin: "22px 0 28px" },
  codeBlockFrame: {
    borderRadius: "var(--radius-lg)",
    overflow: "hidden",
    boxShadow: "none",
    border: "var(--hairline)",
  },
  codeToolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px 9px",
    background: "var(--ink)",
    borderBottom: "1px solid rgba(243, 245, 249, 0.12)",
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
    background: "var(--ink)",
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
    padding: "16px 0",
    cursor: "pointer",
    textDecoration: "none",
    color: "inherit",
    borderRadius: 0,
    border: 0,
    borderBottom: "var(--hairline)",
    boxShadow: "none",
    background: "transparent",
    transition: "opacity 160ms ease",
  },
  paperIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: "var(--primary-soft)",
    color: "var(--text-3)",
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
    background: "var(--surface)",
    borderRadius: "var(--radius)",
    border: "var(--hairline)",
    boxShadow: "none",
    lineHeight: 1.6,
  },

  actions: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    paddingTop: 28,
    marginTop: 28,
    borderTop: "var(--hairline)",
    boxShadow: "none",
    maxWidth: "100%",
  },
  completedBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: "var(--surface-2)",
    border: "var(--hairline)",
    color: "var(--success)",
    fontSize: 13.5,
    fontWeight: 600,
    padding: "10px 16px",
    borderRadius: "var(--radius-pill)",
    boxShadow: "none",
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
    fontWeight: 400,
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
    borderRadius: "var(--radius)",
    border: "var(--hairline)",
    boxShadow: "none",
    background: "var(--surface)",
  },
  questionNum: {
    fontSize: 11,
    color: "var(--text-3)",
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
    background: "var(--surface-2)",
    border: "var(--hairline)",
    borderRadius: "var(--radius-nested)",
    cursor: "pointer",
    fontSize: 15,
    color: "var(--text-2)",
    transition: "background 140ms ease, border-color 140ms ease",
    boxShadow: "none",
    lineHeight: 1.55,
  },
  optSelected: {
    background: "var(--ink)",
    border: "none",
    color: "var(--canvas)",
    boxShadow: "none",
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
    background: "var(--surface-3)",
    color: "var(--text-2)",
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
    background: "var(--surface-2)",
    borderRadius: "var(--radius-nested)",
    border: "var(--hairline)",
    boxShadow: "none",
  },
  resultCard: {
    padding: "38px 32px",
    textAlign: "center",
    marginTop: 16,
    borderRadius: "var(--radius)",
    border: "var(--hairline)",
    background: "var(--surface)",
    boxShadow: "none",
  },
  scoreNum: {
    fontFamily: "var(--font-display)",
    fontSize: 60,
    fontWeight: 400,
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

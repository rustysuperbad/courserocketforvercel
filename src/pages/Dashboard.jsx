import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { db } from "../lib/firebase";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { userCourseListRef } from "../lib/userCourseIndex";
import {
  countGeneratingCoursesForUser,
  startOrResumeGeneratingCourse,
  runOrResumeCourseGeneration,
} from "../lib/coursePipeline";
import { upsertUserProfile } from "../lib/userProgress";
import {
  generatingCoursePlaceholder,
  mergeDisplayedCourses,
  mergeUserCourseIndexWithQuery,
} from "../lib/dashboardCourseList";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";
import CourseGridCard from "../components/CourseGridCard";
import { firestoreSetupHelpFromError } from "../lib/firestoreErrors";

const PROMPT_IDEAS = [
  "Build a stock predictor with Black-Scholes",
  "Master React + TypeScript for production",
  "Crash course on quantum computing",
  "Build a multiplayer game in Unity",
  "Become fluent in Spanish in 90 days",
  "Modern systems design interviews",
];

// Cap on concurrent generations. Each run fans out parallel module enrich calls;
// a small limit avoids hammering Groq and YouTube quotas at once.
const MAX_CONCURRENT = 3;

export default function Dashboard() {
  const { user, authLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [topic, setTopic] = useState(searchParams.get("topic") || "");
  const [mainCourses, setMainCourses] = useState([]);
  const [indexCourses, setIndexCourses] = useState([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  /** Until Firestore lists this id, merge a row so landing + dashboard flows show the same in-grid card immediately. */
  const [bootstrappingCourse, setBootstrappingCourse] = useState(null);
  const [error, setError] = useState("");
  /** GCP: Firestore API off or database not created — fixed in Google Cloud / Firebase Console. */
  const [firestoreSetup, setFirestoreSetup] = useState(null);
  const navigate = useNavigate();

  // Tracks whether the live listener has delivered ≥1 successful snapshot.
  // Once true, listener errors never wipe the UI — we keep last-known data.
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      queueMicrotask(() => {
        setMainCourses([]);
        setIndexCourses([]);
        setFirestoreSetup(null);
        hasLoadedRef.current = false;
      });
      return;
    }
    upsertUserProfile(user).catch(() => {});

    const uid = user.uid;
    const q = query(collection(db, "courses"), where("userId", "==", uid));
    const listCol = userCourseListRef(uid);

    const sortCourses = (docs) =>
      docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = new Date(a.createdAt || 0).getTime();
          const tb = new Date(b.createdAt || 0).getTime();
          return tb - ta;
        });

    const applyMain = (snap) => {
      const data = sortCourses(snap.docs);

      // Only ignore an empty result from the *local cache* — those can be
      // stale during auth token refresh. A server-confirmed empty list is real
      // (e.g. user deleted everything) and must be applied.
      if (data.length === 0 && hasLoadedRef.current && snap.metadata.fromCache) {
        console.warn("[Dashboard] ignoring empty *cached* query snapshot (auth may be resyncing)");
        return;
      }

      hasLoadedRef.current = true;
      setMainCourses(data);
      setFirestoreSetup(null);
      setCoursesLoading(false);
    };

    const unsubMain = onSnapshot(q, applyMain, (err) => {
      console.warn("[Dashboard] courses listener error (will retry):", err?.message);
      const help = firestoreSetupHelpFromError(err);
      if (help) {
        setFirestoreSetup(help);
        setCoursesLoading(false);
        return;
      }
      if (!hasLoadedRef.current) {
        setError("Could not sync courses. Check your connection.");
        setCoursesLoading(false);
      }
    });

    const unsubIndex = onSnapshot(
      listCol,
      (snap) => {
        setFirestoreSetup(null);
        setIndexCourses(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.warn("[Dashboard] course index listener error (will retry):", err?.message);
        const help = firestoreSetupHelpFromError(err);
        if (help) setFirestoreSetup(help);
      }
    );

    return () => {
      unsubMain();
      unsubIndex();
    };
  }, [authLoading, user]);

  const prevUidRef = useRef(null);

  useEffect(() => {
    const uid = user?.uid ?? null;
    const prev = prevUidRef.current;
    if (prev !== null && uid !== prev) {
      queueMicrotask(() => setBootstrappingCourse(null));
    }
    prevUidRef.current = uid;
  }, [user?.uid]);

  const mergedFirestoreCourses = useMemo(
    () => mergeUserCourseIndexWithQuery(mainCourses, indexCourses),
    [mainCourses, indexCourses]
  );

  const stats = useMemo(() => {
    const total = mergedFirestoreCourses.length;
    let totalModules = 0;
    let completedModules = 0;
    mergedFirestoreCourses.forEach((c) => {
      const mods = c.modules?.length || 0;
      totalModules += mods;
      const progress = c.progress || {};
      (c.modules || []).forEach((m) => {
        const p = progress[m.id];
        if (p?.completed || p === true) completedModules += 1;
      });
    });
    const avg = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0;
    return { total, completedModules, totalModules, avg };
  }, [mergedFirestoreCourses]);

  const displayCourses = useMemo(
    () => mergeDisplayedCourses(mergedFirestoreCourses, bootstrappingCourse),
    [mergedFirestoreCourses, bootstrappingCourse]
  );

  useEffect(() => {
    if (!bootstrappingCourse?.id) return;
    if (!mainCourses.some((c) => c.id === bootstrappingCourse.id)) return;
    queueMicrotask(() => setBootstrappingCourse(null));
  }, [mainCourses, bootstrappingCourse?.id]);

  const generatingCount = useMemo(
    () => displayCourses.filter((c) => c.generationStatus === "generating").length,
    [displayCourses]
  );

  const startGeneration = useCallback(
    async (rawTopic) => {
      const myTopic = (rawTopic || "").trim();
      if (!myTopic) {
        setError("Type a topic to generate.");
        return;
      }
      if (!user) {
        navigate("/login?signup=1");
        return;
      }

      setError("");
      setFirestoreSetup(null);

      try {
        const serverGenerating = await countGeneratingCoursesForUser(user.uid);
        if (serverGenerating >= MAX_CONCURRENT) {
          setError(
            `Up to ${MAX_CONCURRENT} courses can generate at once. Wait for one to finish.`
          );
          return;
        }
        const { courseId } = await startOrResumeGeneratingCourse(user.uid, myTopic);
        setBootstrappingCourse(generatingCoursePlaceholder(user.uid, myTopic, courseId));
      } catch (e) {
        const help = firestoreSetupHelpFromError(e);
        if (help) {
          setFirestoreSetup(help);
          console.error("[Dashboard] startGeneration failed (Firestore setup):", e);
          return;
        }
        const msg = String(e?.message || "");
        if (msg.includes("429") || msg.toLowerCase().includes("rate limit")) {
          setError("Rate-limited. Wait ~20s and retry.");
        } else if (
          msg.toLowerCase().includes("timed out") ||
          msg.toLowerCase().includes("aborted")
        ) {
          setError("Timed out. Try again.");
        } else {
          setError(msg || "Could not start generation.");
        }
        console.error("[Dashboard] startGeneration failed:", e);
      }
    },
    [user, navigate]
  );

  const autostartMountLockRef = useRef(false);

  useEffect(() => {
    if (authLoading || !user) return;
    if (searchParams.get("autostart") !== "1") {
      autostartMountLockRef.current = false;
      return;
    }

    const t = searchParams.get("topic")?.trim();
    if (!t) {
      navigate("/dashboard", { replace: true });
      return;
    }

    if (autostartMountLockRef.current) return;
    autostartMountLockRef.current = true;

    const dedupeKey = `cr_dash_autostart_${user.uid}_${t}`;
    const now = Date.now();
    try {
      const prev = sessionStorage.getItem(dedupeKey);
      if (prev && now - Number(prev) < 30_000) {
        navigate("/dashboard", { replace: true });
        autostartMountLockRef.current = false;
        return;
      }
      sessionStorage.setItem(dedupeKey, String(now));
    } catch {
      /* private mode / quota */
    }

    navigate("/dashboard", { replace: true });
    queueMicrotask(() => {
      void startGeneration(t);
    });
  }, [authLoading, user, searchParams, navigate, startGeneration]);

  const handleRetryFailedCourse = useCallback(
    (course) => {
      if (!user?.uid || !course?.id) return;
      void runOrResumeCourseGeneration(course.id, user.uid);
    },
    [user]
  );

  const handleGenerate = () => {
    const t = topic.trim();
    if (!t) {
      setError("Type a topic to generate.");
      return;
    }
    if (!user) {
      navigate("/login?signup=1");
      return;
    }
    setTopic("");
    setFirestoreSetup(null);
    if (searchParams.get("topic")) {
      const p = new URLSearchParams(searchParams);
      p.delete("topic");
      setSearchParams(p, { replace: true });
    }
    void startGeneration(t);
  };

  return (
    <div style={s.root}>
      <Navbar />

      <div className="cr-page" style={s.body}>
        <div style={s.heading} className="cr-fade">
          <div>
            <h1 style={s.h1}>
              Welcome back{user?.displayName ? `, ${user.displayName.split(" ")[0]}` : ""}.
            </h1>
            <p style={s.sub}>Pick up an existing course or generate a new one. Your list stays in sync with the cloud on every Dashboard visit and when you switch back to this tab.</p>
          </div>
          <div style={s.statRow}>
            <Stat label="Courses" value={stats.total} />
            <Stat label="Modules done" value={`${stats.completedModules}/${stats.totalModules}`} />
            <Stat label="Avg progress" value={`${stats.avg}%`} />
          </div>
        </div>

        <div className="cr-card" style={s.generateBox}>
          <div style={s.generateHead}>
            <div>
              <div style={s.generateLabel}>Generate a new course</div>
              <div style={s.generateHint}>One sentence is enough — be specific for best results.</div>
            </div>
          </div>

          <div style={s.inputRow}>
            <input
              className="cr-input"
              style={s.input}
              placeholder="e.g. Build a chess engine in Python"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              disabled={generatingCount >= MAX_CONCURRENT}
            />
            <button
              className="cr-btn cr-btn-primary"
              style={s.generateBtn}
              onClick={handleGenerate}
              disabled={generatingCount >= MAX_CONCURRENT}
              title={
                generatingCount >= MAX_CONCURRENT
                  ? `Limit: ${MAX_CONCURRENT} concurrent generations`
                  : ""
              }
            >
              Generate →
            </button>
          </div>

          <div style={s.chipRow}>
            {PROMPT_IDEAS.map((p) => (
              <button
                key={p}
                style={s.chip}
                onClick={() => setTopic(p)}
              >
                {p}
              </button>
            ))}
          </div>

          {firestoreSetup && (
            <div style={s.firestoreSetup}>
              <div style={s.firestoreSetupTitle}>Firestore is not enabled for this Firebase project</div>
              <p style={s.firestoreSetupP}>
                The app cannot save or load courses until Cloud Firestore is turned on for project{" "}
                <strong>{firestoreSetup.projectId}</strong>. This is configured in Google Cloud / Firebase Console (not in app code).
              </p>
              <ol style={s.firestoreSetupOl}>
                <li>
                  <a href={firestoreSetup.enableApiUrl} target="_blank" rel="noreferrer" style={s.firestoreLink}>
                    Enable the Cloud Firestore API
                  </a>{" "}
                  for this project, then wait 1–3 minutes.
                </li>
                <li>
                  Open{" "}
                  <a href={firestoreSetup.firebaseConsoleUrl} target="_blank" rel="noreferrer" style={s.firestoreLink}>
                    Firebase → Firestore Database
                  </a>{" "}
                  and click <strong>Create database</strong> if you have not created one yet (choose a location, start in production mode for a real app).
                </li>
                <li>Deploy Firestore security rules so authenticated users can read/write their data, then refresh this page.</li>
              </ol>
            </div>
          )}
          {error && <div style={s.error}>{error}</div>}
        </div>

        <div style={s.sectionHead}>
          <h2 style={s.h2}>Your courses</h2>
          {displayCourses.length > 0 && (
            <div style={s.muted}>
              {mainCourses.length} saved
              {generatingCount > 0 && ` · ${generatingCount} generating`}
            </div>
          )}
        </div>

        {coursesLoading && displayCourses.length === 0 ? (
          <div style={s.courseGrid}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="cr-card" style={{ ...s.courseCard, padding: 0 }}>
                <div className="cr-skeleton" style={{ height: 14, width: "40%", margin: "22px 22px 12px" }} />
                <div className="cr-skeleton" style={{ height: 18, width: "75%", margin: "0 22px 8px" }} />
                <div className="cr-skeleton" style={{ height: 12, width: "55%", margin: "0 22px 14px" }} />
                <div className="cr-skeleton" style={{ height: 60, width: "calc(100% - 44px)", margin: "0 22px 22px" }} />
              </div>
            ))}
          </div>
        ) : displayCourses.length === 0 ? (
          <div className="cr-card" style={s.empty}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>◇</div>
            <div style={{ color: "var(--text)", fontWeight: 600, marginBottom: 4 }}>
              No courses yet
            </div>
            <div style={{ color: "var(--text-2)", fontSize: 14 }}>
              Generate your first course using the box above.
            </div>
          </div>
        ) : (
          <div style={s.courseGrid}>
            {displayCourses.map((c) => (
              <CourseGridCard
                key={c.id}
                course={c}
                onClick={() => navigate(`/course/${c.id}`)}
                onRetryGeneration={handleRetryFailedCourse}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={s.stat}>
      <div style={s.statValue}>{value}</div>
      <div style={s.statLabel}>{label}</div>
    </div>
  );
}

const s = {
  root: { minHeight: "100vh" },
  body: { maxWidth: "1120px" },
  heading: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 18,
    marginBottom: 26,
  },
  h1: {
    fontFamily: "var(--font-display)",
    fontSize: 32,
    fontWeight: 800,
    color: "var(--text)",
    letterSpacing: "-0.6px",
    marginBottom: 6,
  },
  sub: { color: "var(--text-2)", fontSize: 16, lineHeight: 1.65 },
  statRow: { display: "flex", gap: 12 },
  stat: {
    background: "rgba(255,255,255,0.03)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: "10px 16px",
    minWidth: 110,
  },
  statValue: {
    fontFamily: "var(--font-display)",
    fontSize: 18,
    fontWeight: 700,
    color: "var(--text)",
  },
  statLabel: { color: "var(--text-3)", fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase" },

  generateBox: { padding: 32, marginBottom: 40 },
  generateHead: { marginBottom: 16 },
  generateLabel: {
    fontFamily: "var(--font-display)",
    fontSize: 18,
    color: "var(--text)",
    fontWeight: 700,
    marginBottom: 4,
  },
  generateHint: { color: "var(--text-2)", fontSize: 15, lineHeight: 1.6 },
  inputRow: { display: "flex", gap: 12, marginBottom: 16 },
  input: { flex: 1, fontSize: 16 },
  generateBtn: { padding: "12px 22px" },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  chip: {
    fontSize: 12,
    color: "var(--text-2)",
    background: "rgba(255,255,255,0.03)",
    border: "1px solid var(--border)",
    padding: "5px 12px",
    borderRadius: 999,
    cursor: "pointer",
  },
  error: {
    marginTop: 14,
    background: "rgba(239,68,68,0.08)",
    border: "1px solid rgba(239,68,68,0.25)",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 13,
    color: "#fca5a5",
  },
  firestoreSetup: {
    marginTop: 14,
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.35)",
    borderRadius: 10,
    padding: "14px 16px",
    fontSize: 13,
    color: "#fecaca",
    lineHeight: 1.55,
  },
  firestoreSetupTitle: {
    fontWeight: 700,
    color: "#fef2f2",
    marginBottom: 8,
    fontSize: 14,
  },
  firestoreSetupP: { margin: "0 0 12px" },
  firestoreSetupOl: { margin: 0, paddingLeft: 20 },
  firestoreLink: { color: "#93c5fd", fontWeight: 600 },

  sectionHead: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  h2: {
    fontFamily: "var(--font-display)",
    fontSize: 22,
    fontWeight: 700,
    color: "var(--text)",
    letterSpacing: "-0.3px",
  },
  muted: { color: "var(--text-3)", fontSize: 13 },

  courseGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: 14,
  },
  courseCard: {
    padding: 20,
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  empty: {
    padding: "50px 24px",
    textAlign: "center",
  },
};

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../lib/firebase";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { mergeUserCourseIndexWithQuery } from "../lib/dashboardCourseList";
import { userCourseListRef } from "../lib/userCourseIndex";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/Navbar";

export default function Profile() {
  const [profile, setProfile] = useState(null);
  const [mainCourses, setMainCourses] = useState([]);
  const [indexCourses, setIndexCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user, authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/login");
      return;
    }

    const profileKey = `profile_cache_${user.uid}`;
    let hasCache = false;

    try {
      const cachedProfile = localStorage.getItem(profileKey);
      if (cachedProfile) {
        setProfile(JSON.parse(cachedProfile));
        hasCache = true;
      }
    } catch {
      // ignore
    }
    if (hasCache) setLoading(false);

    const coursesQ = query(collection(db, "courses"), where("userId", "==", user.uid));
    const listCol = userCourseListRef(user.uid);

    const sortCourses = (docs) =>
      docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        );

    const unsubCourses = onSnapshot(coursesQ, (snap) => {
      setMainCourses(sortCourses(snap.docs));
    });

    const unsubIndex = onSnapshot(listCol, (snap) => {
      setIndexCourses(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    void (async () => {
      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const freshProfile = userDoc.exists() ? userDoc.data() : null;
        setProfile(freshProfile);
        try {
          localStorage.setItem(profileKey, JSON.stringify(freshProfile));
        } catch {
          // quota
        }
      } catch {
        // network failure: keep cached profile
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      unsubCourses();
      unsubIndex();
    };
  }, [authLoading, user, navigate]);

  const courses = useMemo(
    () => mergeUserCourseIndexWithQuery(mainCourses, indexCourses),
    [mainCourses, indexCourses]
  );

  const stats = useMemo(() => {
    const progressMap = profile?.courseProgress || {};
    const totalCourses = courses.length;
    let completedModules = 0;
    let totalModules = 0;
    let percentSum = 0;
    let percentCount = 0;
    courses.forEach((c) => {
      const mods = c.modules?.length || 0;
      totalModules += mods;
      const fromProgress = progressMap[c.id];
      const local = c.progress || {};
      const localCompleted = (c.modules || []).filter((m) => {
        const p = local[m.id];
        return p?.completed || p === true;
      }).length;
      const completed = localCompleted;
      completedModules += completed;
      const pct =
        mods > 0
          ? (fromProgress?.progress?.percent ??
              fromProgress?.percent ??
              Math.round((completed / mods) * 100))
          : 0;
      percentSum += pct;
      percentCount += 1;
    });
    const avgProgress = percentCount > 0 ? Math.round(percentSum / percentCount) : 0;
    return { totalCourses, completedModules, totalModules, avgProgress };
  }, [courses, profile]);

  const initials = (user?.displayName || profile?.name || user?.email || "U")
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

  return (
    <div style={s.root}>
      <Navbar />

      <div style={s.body}>
        <div className="cr-card cr-fade" style={s.header}>
          <div style={s.headerLeft}>
            <div style={s.avatar}>{initials || "U"}</div>
            <div>
              <div style={s.name}>
                {profile?.name || user?.displayName || "Welcome"}
              </div>
              <div style={s.email}>{user?.email}</div>
              <div style={s.uid}>UID: {user?.uid?.slice(0, 12)}…</div>
            </div>
          </div>
          <div style={s.headerActions}>
            <button className="cr-btn cr-btn-ghost" onClick={() => navigate("/")}>
              Home
            </button>
            <button className="cr-btn cr-btn-primary" onClick={() => navigate("/dashboard")}>
              Open Dashboard
            </button>
          </div>
        </div>

        <div style={s.statsGrid}>
          <StatCard label="Courses" value={stats.totalCourses} />
          <StatCard label="Modules completed" value={`${stats.completedModules}/${stats.totalModules}`} />
          <StatCard label="Average progress" value={`${stats.avgProgress}%`} accent />
        </div>

        <div style={s.sectionHead}>
          <h2 style={s.h2}>Your courses</h2>
          {courses.length > 0 && (
            <div style={s.muted}>{courses.length} total</div>
          )}
        </div>

        {loading && courses.length === 0 ? (
          <div style={s.grid}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="cr-card" style={{ padding: 18 }}>
                <div className="cr-skeleton" style={{ height: 16, width: "70%", marginBottom: 8 }} />
                <div className="cr-skeleton" style={{ height: 12, width: "40%", marginBottom: 14 }} />
                <div className="cr-skeleton" style={{ height: 6, width: "100%" }} />
              </div>
            ))}
          </div>
        ) : courses.length === 0 ? (
          <div className="cr-card" style={s.empty}>
            <div style={{ color: "var(--text)", fontWeight: 600, marginBottom: 6 }}>
              No courses yet
            </div>
            <div style={{ color: "var(--text-2)", fontSize: 14, marginBottom: 16 }}>
              Head to the dashboard to create your first course.
            </div>
            <button className="cr-btn cr-btn-primary" onClick={() => navigate("/dashboard")}>
              Create a course
            </button>
          </div>
        ) : (
          <div style={s.grid}>
            {courses.map((c) => {
              const totalModules = c.modules?.length || 0;
              const fromProgress = profile?.courseProgress?.[c.id];
              const localProgress = c.progress || {};
              const localCompleted = (c.modules || []).filter((m) => {
                const p = localProgress[m.id];
                return p?.completed || p === true;
              }).length;
              const completed = localCompleted;
              const pct =
                totalModules > 0
                  ? (fromProgress?.progress?.percent ??
                      fromProgress?.percent ??
                      Math.round((completed / totalModules) * 100))
                  : 0;
              return (
                <div
                  key={c.id}
                  className="cr-card"
                  style={s.courseCard}
                  onClick={() => navigate(`/course/${c.id}`)}
                >
                  <div style={s.cardTopRow}>
                    <span style={s.levelPill}>{c.level || "Course"}</span>
                    <span style={s.metaText}>
                      {totalModules} modules · {c.estimatedHours || "—"}h
                    </span>
                  </div>
                  <div style={s.courseTitle}>{c.title || c.topic}</div>
                  <div style={s.courseDesc}>{c.description}</div>
                  <div style={s.progressBlock}>
                    <div style={s.progressTrack}>
                      <div style={{ ...s.progressFill, width: `${pct}%` }} />
                    </div>
                    <div style={s.progressMeta}>
                      <span>{completed}/{totalModules} done</span>
                      <span style={{ color: "var(--primary-2)", fontWeight: 600 }}>{pct}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className="cr-card" style={s.statCard}>
      <div style={{ ...s.statValue, color: accent ? "var(--primary-2)" : "var(--text)" }}>
        {value}
      </div>
      <div style={s.statLabel}>{label}</div>
    </div>
  );
}

const s = {
  root: { minHeight: "100vh" },
  body: { maxWidth: "1100px", margin: "0 auto", padding: "44px 24px 80px" },

  header: {
    padding: 26,
    marginBottom: 22,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 16,
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 18 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 16,
    background: "linear-gradient(135deg, var(--primary), var(--accent))",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontWeight: 700,
    fontSize: 22,
    fontFamily: "var(--font-display)",
  },
  name: {
    fontFamily: "var(--font-display)",
    fontSize: 22,
    fontWeight: 700,
    color: "var(--text)",
    marginBottom: 2,
  },
  email: { color: "var(--text-2)", fontSize: 14 },
  uid: { color: "var(--text-3)", fontSize: 12, marginTop: 2, fontFamily: "ui-monospace, monospace" },
  headerActions: { display: "flex", gap: 10 },

  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: 12,
    marginBottom: 30,
  },
  statCard: { padding: "18px 20px" },
  statValue: {
    fontFamily: "var(--font-display)",
    fontSize: 26,
    fontWeight: 700,
    marginBottom: 4,
  },
  statLabel: { color: "var(--text-3)", fontSize: 12, letterSpacing: 0.4, textTransform: "uppercase" },

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
  },
  muted: { color: "var(--text-3)", fontSize: 13 },

  grid: {
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
  cardTopRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  levelPill: {
    fontSize: 11,
    color: "var(--primary-2)",
    background: "var(--primary-soft)",
    border: "1px solid rgba(99,102,241,0.25)",
    padding: "3px 10px",
    borderRadius: 999,
  },
  metaText: { fontSize: 12, color: "var(--text-3)" },
  courseTitle: {
    fontFamily: "var(--font-display)",
    fontSize: 16,
    color: "var(--text)",
    fontWeight: 700,
    lineHeight: 1.3,
  },
  courseDesc: {
    fontSize: 13,
    color: "var(--text-2)",
    lineHeight: 1.55,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  },
  progressBlock: { marginTop: "auto" },
  progressTrack: {
    height: 4,
    background: "rgba(255,255,255,0.06)",
    borderRadius: 999,
    overflow: "hidden",
    marginBottom: 6,
  },
  progressFill: {
    height: "100%",
    background: "linear-gradient(90deg, var(--primary), var(--accent))",
    transition: "width 320ms ease",
  },
  progressMeta: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 11.5,
    color: "var(--text-3)",
  },
  empty: {
    padding: "40px 24px",
    textAlign: "center",
  },
};

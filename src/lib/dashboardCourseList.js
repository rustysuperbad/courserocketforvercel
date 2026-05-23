/**
 * Shared helpers for dashboard course list: same shape Firestore uses, so cards
 * render identically whether data came from snapshot or optimistic bootstrap.
 */

/**
 * Merge canonical `courses` query rows with `users/{uid}/courseList/*` index rows.
 * Index-only entries keep the dashboard non-empty when the primary query briefly returns stale empty cache.
 *
 * @param {Array<Record<string, unknown> & { id: string }>} canonicalCourses
 * @param {Array<Record<string, unknown> & { id: string }>} indexRows — doc id === courseId
 */
export function mergeUserCourseIndexWithQuery(canonicalCourses, indexRows) {
  const byId = new Map();
  for (const c of canonicalCourses) {
    byId.set(c.id, { ...c });
  }
  for (const row of indexRows) {
    const cid = String(row.courseId || row.id || "");
    if (!cid || byId.has(cid)) continue;
    byId.set(cid, {
      id: cid,
      userId: row.userId,
      topic: row.topic || "",
      topicKey: row.topicKey || "",
      title: "Syncing…",
      description: "",
      level: "",
      estimatedHours: 0,
      modules: [],
      progress: {},
      videoProgress: {},
      generationStatus: "generating",
      generationMessage: "Syncing your library…",
      generationProgressDone: 0,
      generationProgressTotal: 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
  return [...byId.values()].sort(
    (a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
}

export function generatingCoursePlaceholder(userId, topic, courseId) {
  const trimmed = String(topic || "").trim();
  const now = new Date().toISOString();
  return {
    id: courseId,
    userId,
    topic: trimmed,
    topicKey: trimmed.toLowerCase(),
    title: "Generating…",
    description: "",
    level: "",
    estimatedHours: 0,
    modules: [],
    progress: {},
    videoProgress: {},
    generationStatus: "generating",
    generationMessage: "Designing your course structure…",
    generationProgressDone: 0,
    generationProgressTotal: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** Insert bootstrap row until Firestore includes that doc id (avoids empty grid flash). */
export function mergeDisplayedCourses(firestoreCourses, bootstrapping) {
  if (!bootstrapping?.id) return firestoreCourses;
  if (firestoreCourses.some((c) => c.id === bootstrapping.id)) {
    return firestoreCourses;
  }
  return [...firestoreCourses, bootstrapping].sort(
    (a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
}

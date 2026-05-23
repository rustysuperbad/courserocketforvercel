import { db } from "./firebase";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  where,
} from "firebase/firestore";
import {
  generateCourseStructure,
  enrichOneModule,
  moduleNeedsEnrichment,
} from "./generateCourse";
import {
  courseUpdatedAt,
  transactionalCourseUpdate,
  updateCourseWithRetry,
} from "./courseWrites";
import {
  buildUserCourseListPayload,
  userCourseListDocRef,
} from "./userCourseIndex";
import {
  courseGenerationDraftRef,
  transactionalCommitDraftToCourse,
  transactionalDraftUpdate,
  transactionalGenerationCheckpoint,
  transactionalMarkGenerationFailed,
} from "./courseGenerationDraft";

const runningCourseGenerations = new Set();
const LOCK_MS = 45_000;

/** Count courses currently generating for concurrency caps. */
export async function countGeneratingCoursesForUser(userId) {
  const snap = await getDocs(
    query(collection(db, "courses"), where("userId", "==", userId))
  );
  return snap.docs.filter((d) => d.data()?.generationStatus === "generating").length;
}

function topicMatches(topicKey, data) {
  const key =
    typeof data.topicKey === "string" && data.topicKey
      ? data.topicKey.trim().toLowerCase()
      : String(data.topic || "")
          .trim()
          .toLowerCase();
  return key === topicKey;
}

function pendingCourseSessionKey(userId, topicKey) {
  return `cr_pending_course_${userId}_${topicKey}`;
}

/**
 * Create course doc with fixed id if missing (idempotent with sessionStorage + topic resume).
 */
async function ensureGeneratingCourseDocument(courseId, userId, topicRaw) {
  const topic = String(topicRaw || "").trim();
  if (!topic) throw new Error("Topic is required.");
  const topicKey = topic.toLowerCase();
  const ref = doc(db, "courses", courseId);
  const listRef = userCourseListDocRef(userId, courseId);
  const now = courseUpdatedAt();

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) {
      const d = snap.data();
      if (d.userId !== userId) throw new Error("Not your course.");
      tx.set(
        listRef,
        buildUserCourseListPayload({
          userId,
          courseId,
          topic: String(d.topic || topic).trim(),
          topicKey:
            typeof d.topicKey === "string" && d.topicKey
              ? d.topicKey
              : topicKey,
          createdAt: d.createdAt || now,
        }),
        { merge: true }
      );
      return;
    }
    tx.set(ref, {
      userId,
      topic,
      topicKey,
      createdAt: now,
      updatedAt: now,
      version: 1,
      progress: {},
      videoProgress: {},
      generationStatus: "generating",
      generationMessage: "Designing your course structure…",
      generationProgressDone: 0,
      generationProgressTotal: 0,
      title: "Generating…",
      description: "",
      level: "",
      estimatedHours: 0,
      modules: [],
      isGenerating: true,
      generationId: crypto.randomUUID(),
      generationLockHolder: "",
      generationLockUntil: 0,
      generationHeartbeatAt: Date.now(),
    });
    tx.set(
      listRef,
      buildUserCourseListPayload({
        userId,
        courseId,
        topic,
        topicKey,
        createdAt: now,
      }),
      { merge: true }
    );
  });
}

/**
 * Single-writer lease + generationId for this worker run.
 * @returns {Promise<{ ok: true, generationId: string } | { ok: false, reason: string }>}
 */
async function claimGenerationLease(cref, userId, workerId) {
  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(cref);
    if (!snap.exists()) return { ok: false, reason: "missing" };
    const data = snap.data();
    if (data.userId !== userId) return { ok: false, reason: "forbidden" };

    const draftRef = courseGenerationDraftRef(cref.id);

    const ver = typeof data.version === "number" ? data.version : 0;
    const existingModules = data.modules;

    if (
      Array.isArray(existingModules) &&
      existingModules.length > 0 &&
      !data.generationStatus
    ) {
      transaction.update(cref, {
        generationStatus: "complete",
        isGenerating: false,
        version: ver + 1,
        updatedAt: courseUpdatedAt(),
      });
      return { ok: false, reason: "already_complete" };
    }

    if (data.generationStatus === "complete") {
      return { ok: false, reason: "already_complete" };
    }

    const now = Date.now();
    const lockUntil = data.generationLockUntil || 0;
    const lockHolder = data.generationLockHolder || "";
    const lockActive = lockHolder && lockUntil > now;
    if (lockActive && lockHolder !== workerId) {
      return { ok: false, reason: "locked_other" };
    }

    let genId;
    if (data.generationStatus === "failed") {
      genId = crypto.randomUUID();
    } else if (typeof data.generationId === "string" && data.generationId) {
      genId = data.generationId;
    } else {
      genId = crypto.randomUUID();
    }

    const fromFailed = data.generationStatus === "failed";
    const patch = {
      generationId: genId,
      isGenerating: true,
      generationLockHolder: workerId,
      generationLockUntil: now + LOCK_MS,
      generationHeartbeatAt: now,
      version: ver + 1,
      updatedAt: courseUpdatedAt(),
    };
    if (fromFailed) {
      patch.generationStatus = "generating";
      patch.generationError = deleteField();
      patch.generationMessage = "Resuming generation…";
      const dSnap = await transaction.get(draftRef);
      if (dSnap.exists()) transaction.delete(draftRef);
    }

    transaction.update(cref, patch);
    return { ok: true, generationId: genId };
  });
}

/**
 * Idempotent entry: resumes an in-flight generating course for the same topic,
 * or creates a skeleton with stable session id and starts generation.
 * @returns {{ courseId: string, resumed: boolean }}
 */
export async function startOrResumeGeneratingCourse(userId, topicRaw) {
  const topic = String(topicRaw || "").trim();
  if (!topic) throw new Error("Topic is required.");
  const topicKey = topic.toLowerCase();
  const sessionKey = pendingCourseSessionKey(userId, topicKey);

  const snap = await getDocs(
    query(collection(db, "courses"), where("userId", "==", userId))
  );
  const generatingSameTopic = snap.docs.find((d) => {
    const data = d.data();
    return data.generationStatus === "generating" && topicMatches(topicKey, data);
  });

  if (generatingSameTopic) {
    const courseId = generatingSameTopic.id;
    try {
      sessionStorage.setItem(sessionKey, courseId);
    } catch {
      /* noop */
    }
    void runOrResumeCourseGeneration(courseId, userId);
    return { courseId, resumed: true };
  }

  let courseId = null;
  try {
    courseId = sessionStorage.getItem(sessionKey);
  } catch {
    /* noop */
  }
  if (!courseId) {
    courseId = doc(collection(db, "courses")).id;
    try {
      sessionStorage.setItem(sessionKey, courseId);
    } catch {
      /* noop */
    }
  }

  await ensureGeneratingCourseDocument(courseId, userId, topic);
  void runOrResumeCourseGeneration(courseId, userId);
  return { courseId, resumed: false };
}

async function safeSetGenerationMessage(cref, userId, generationId, msg) {
  const res = await transactionalCourseUpdate(cref, {
    expectedUserId: userId,
    expectedGenerationId: generationId,
    buildPatch: () => ({
      generationMessage: msg ? msg : deleteField(),
      generationLockUntil: Date.now() + LOCK_MS,
      generationHeartbeatAt: Date.now(),
    }),
  });
  if (res === "stale_generation") {
    throw new Error("stale_generation");
  }
  if (res !== "ok" && res !== "noop") {
    console.error("[coursePipeline] safeSetGenerationMessage failed:", res);
  }
}

function countFullyEnrichedModules(modules) {
  if (!Array.isArray(modules)) return 0;
  return modules.filter((m) => !moduleNeedsEnrichment(m)).length;
}

/** Resumable server-backed generation (used when a course doc is generating). */
export async function runOrResumeCourseGeneration(courseId, userId) {
  if (runningCourseGenerations.has(courseId)) return;
  runningCourseGenerations.add(courseId);

  const cref = doc(db, "courses", courseId);
  const draftRef = courseGenerationDraftRef(courseId);
  const workerId = crypto.randomUUID();
  let generationId = "";

  try {
    const claim = await claimGenerationLease(cref, userId, workerId);
    if (!claim.ok) return;
    generationId = claim.generationId;

    const snap = await getDoc(cref);
    if (!snap.exists()) throw new Error("Course not found.");
    let data = snap.data();

    if (data.userId !== userId) throw new Error("Not your course.");

    if (data.generationStatus === "complete") return;

    const topic = String(data.topic || "").trim();

    if (!Array.isArray(data.modules) || data.modules.length === 0) {
      await safeSetGenerationMessage(cref, userId, generationId, "Designing your course…");
      const courseData = await generateCourseStructure(topic, async (m) => {
        if (m) await safeSetGenerationMessage(cref, userId, generationId, m);
      });

      const outlineMods = courseData.modules.map((m) => ({
        ...m,
        lessons: [],
        quiz: [],
        videos: [],
        papers: [],
      }));

      const totalMod = outlineMods.length;
      const outlineRes = await transactionalCourseUpdate(cref, {
        expectedUserId: userId,
        expectedGenerationId: generationId,
        buildPatch: () => ({
          title: courseData.title,
          description: courseData.description,
          level: courseData.level,
          estimatedHours: courseData.estimatedHours,
          courseKeyConcepts: Array.isArray(courseData.courseKeyConcepts)
            ? courseData.courseKeyConcepts
            : [],
          modules: outlineMods,
          generationMessage: "Writing lessons, videos, and papers…",
          generationProgressTotal: totalMod,
          generationProgressDone: 0,
          generationLockUntil: Date.now() + LOCK_MS,
          generationHeartbeatAt: Date.now(),
        }),
      });
      if (outlineRes === "stale_generation") throw new Error("stale_generation");
      if (outlineRes !== "ok" && outlineRes !== "noop") {
        throw new Error("Failed to persist course outline.");
      }

      const draftOutline = await transactionalDraftUpdate(draftRef, cref, {
        expectedUserId: userId,
        expectedGenerationId: generationId,
        buildDraftPatch: () => ({ modules: outlineMods }),
      });
      if (draftOutline === "stale_generation") throw new Error("stale_generation");
      if (draftOutline !== "ok" && draftOutline !== "noop") {
        throw new Error("Failed to init generation draft.");
      }
    }

    const snap1 = await getDoc(cref);
    data = snap1.data();
    const dSnap = await getDoc(draftRef);
    let modules = [...(data.modules || [])];
    const draftMatches =
      dSnap.exists() &&
      dSnap.data().generationId === generationId &&
      Array.isArray(dSnap.data().modules) &&
      dSnap.data().modules.length === modules.length;
    if (draftMatches) {
      modules = [...dSnap.data().modules];
    } else if (modules.length > 0) {
      const seed = await transactionalDraftUpdate(draftRef, cref, {
        expectedUserId: userId,
        expectedGenerationId: generationId,
        buildDraftPatch: () => ({ modules }),
      });
      if (seed === "stale_generation") throw new Error("stale_generation");
      if (seed !== "ok" && seed !== "noop") {
        throw new Error("Failed to seed generation draft.");
      }
    }

    const total = modules.length;
    const level = data.level || "";
    let doneCount = countFullyEnrichedModules(modules);

    const progRes = await transactionalCourseUpdate(cref, {
      expectedUserId: userId,
      expectedGenerationId: generationId,
      buildPatch: () => ({
        generationProgressTotal: total,
        generationProgressDone: doneCount,
        generationLockUntil: Date.now() + LOCK_MS,
        generationHeartbeatAt: Date.now(),
      }),
    });
    if (progRes === "stale_generation") throw new Error("stale_generation");

    for (let i = 0; i < modules.length; i++) {
      if (!moduleNeedsEnrichment(modules[i])) continue;
      await safeSetGenerationMessage(
        cref,
        userId,
        generationId,
        `Module ${i + 1}/${total} — generating…`
      );
      modules[i] = await enrichOneModule(modules[i], topic, level, i, total, undefined, {
        preferredVideoLanguage: data.preferredVideoLanguage,
      });
      doneCount = countFullyEnrichedModules(modules);
      const modRes = await transactionalGenerationCheckpoint(draftRef, cref, {
        expectedUserId: userId,
        expectedGenerationId: generationId,
        modules,
        courseMetaPatch: () => ({
          generationMessage: `Module ${i + 1}/${total} ready…`,
          generationProgressDone: doneCount,
          generationProgressTotal: total,
          generationLockUntil: Date.now() + LOCK_MS,
          generationHeartbeatAt: Date.now(),
        }),
      });
      if (modRes === "stale_generation") throw new Error("stale_generation");
      if (modRes !== "ok" && modRes !== "noop") {
        throw new Error(`Failed to save module ${i + 1} progress.`);
      }
    }

    const finalRes = await transactionalCommitDraftToCourse(cref, draftRef, {
      expectedUserId: userId,
      expectedGenerationId: generationId,
    });
    if (finalRes === "stale_generation") throw new Error("stale_generation");
    if (finalRes !== "ok") {
      throw new Error("Failed to finalize course.");
    }

    try {
      const d = (await getDoc(cref)).data();
      const tk =
        typeof d?.topicKey === "string" && d.topicKey
          ? d.topicKey
          : String(d?.topic || "")
              .trim()
              .toLowerCase();
      if (tk) sessionStorage.removeItem(pendingCourseSessionKey(userId, tk));
    } catch {
      /* noop */
    }
  } catch (e) {
    const msg = String(e?.message || "");
    if (msg.includes("stale_generation")) {
      console.warn("[coursePipeline] generation superseded or lock lost; stopping worker");
      return;
    }
    const errText =
      msg.includes("429") || msg.toLowerCase().includes("rate limit")
        ? "Rate-limited. Wait ~20s and retry."
        : msg || "Generation failed.";
    if (generationId) {
      const failRes = await transactionalMarkGenerationFailed(cref, draftRef, {
        expectedUserId: userId,
        expectedGenerationId: generationId,
        generationError: errText,
      });
      if (failRes === "stale_generation") {
        /* another writer owns the course */
      } else if (failRes !== "ok") {
        console.error("[coursePipeline] could not persist failed generation state");
      }
    }
    console.error("[coursePipeline] generation failed:", e);
  } finally {
    runningCourseGenerations.delete(courseId);
  }
}

export async function mergeCourseModule(courseId, moduleIndex, patch) {
  const cref = doc(db, "courses", courseId);
  const res = await transactionalCourseUpdate(cref, {
    buildPatch: (data) => {
      const mods = data.modules;
      if (!Array.isArray(mods) || moduleIndex < 0 || moduleIndex >= mods.length) {
        return false;
      }
      const prev = mods[moduleIndex];
      const next =
        typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
      const out = {};
      for (const [k, v] of Object.entries(next)) {
        if (v === undefined) continue;
        out[`modules.${moduleIndex}.${k}`] = v;
      }
      return Object.keys(out).length ? out : false;
    },
  });
  if (res !== "ok" && res !== "noop") throw new Error("Failed to save module changes.");
}

export async function replaceCourseModule(courseId, moduleIndex, nextModule) {
  const cref = doc(db, "courses", courseId);
  const res = await transactionalCourseUpdate(cref, {
    buildPatch: (data) => {
      const mods = data.modules;
      if (!Array.isArray(mods) || moduleIndex < 0 || moduleIndex >= mods.length) {
        return false;
      }
      return { [`modules.${moduleIndex}`]: nextModule };
    },
  });
  if (res !== "ok" && res !== "noop") throw new Error("Failed to save module.");
}

export async function setVideoTimestampSeconds(courseId, videoId, seconds) {
  const v = String(videoId || "");
  if (!v) return;
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const cref = doc(db, "courses", courseId);
  const ok = await updateCourseWithRetry(cref, {
    [`videoProgress.${v}`]: s,
  });
  if (!ok) console.error("[coursePipeline] setVideoTimestampSeconds failed after retries");
}

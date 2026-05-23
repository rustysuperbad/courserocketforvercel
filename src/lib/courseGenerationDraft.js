import {
  deleteField,
  doc,
  runTransaction,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  courseUpdatedAt,
  filterDestructiveWrites,
} from "./courseWrites";

const TX_RETRIES = 7;

/** Working copy of modules + enrich progress while generation runs; not shown as "final" until merged into `courses/{id}`. */
export function courseGenerationDraftRef(courseId) {
  return doc(db, "courseGenerationDrafts", courseId);
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/**
 * One transaction: persist enriched `modules` on the draft doc + generation meta on the course (no `modules` on course until commit).
 * @returns {Promise<"ok" | "missing_course" | "forbidden" | "stale_generation" | "noop" | "aborted">}
 */
export async function transactionalGenerationCheckpoint(
  draftRef,
  courseRef,
  opts
) {
  const {
    expectedUserId,
    expectedGenerationId,
    modules,
    courseMetaPatch,
  } = opts;

  let lastErr;
  for (let attempt = 0; attempt < TX_RETRIES; attempt++) {
    try {
      const out = await runTransaction(db, async (tx) => {
        const [courseSnap, draftSnap] = await Promise.all([
          tx.get(courseRef),
          tx.get(draftRef),
        ]);
        if (!courseSnap.exists()) return { result: "missing_course" };
        const courseData = courseSnap.data();
        if (courseData.userId !== expectedUserId) return { result: "forbidden" };
        if (courseData.generationId !== expectedGenerationId) {
          return { result: "stale_generation" };
        }

        const cVer =
          typeof courseData.version === "number" && !Number.isNaN(courseData.version)
            ? courseData.version
            : 0;
        const draftData = draftSnap.exists() ? draftSnap.data() : {};
        const dVer =
          typeof draftData.version === "number" && !Number.isNaN(draftData.version)
            ? draftData.version
            : 0;

        const metaRaw =
          typeof courseMetaPatch === "function"
            ? courseMetaPatch(courseData)
            : courseMetaPatch;
        if (metaRaw === false) return { result: "aborted" };
        if (metaRaw == null) return { result: "aborted" };
        const metaFlat = isPlainObject(metaRaw) ? metaRaw : {};
        const safeMeta = filterDestructiveWrites(courseData, metaFlat);
        if (Object.keys(safeMeta).length === 0 && modules == null) {
          return { result: "noop" };
        }

        if (modules != null) {
          tx.set(
            draftRef,
            {
              modules,
              userId: expectedUserId,
              courseId: courseRef.id,
              generationId: expectedGenerationId,
              version: dVer + 1,
              updatedAt: courseUpdatedAt(),
            },
            { merge: true }
          );
        }

        if (Object.keys(safeMeta).length > 0) {
          tx.update(courseRef, {
            ...safeMeta,
            version: cVer + 1,
            updatedAt: courseUpdatedAt(),
          });
        } else if (modules == null) {
          return { result: "noop" };
        }

        return { result: "ok" };
      });

      if (out.result === "ok" || out.result === "noop") return out.result;
      if (
        out.result === "missing_course" ||
        out.result === "forbidden" ||
        out.result === "stale_generation" ||
        out.result === "aborted"
      ) {
        return out.result;
      }
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 200 + attempt * 350));
    }
  }
  console.error(
    "[courseGenerationDraft] transactionalGenerationCheckpoint exhausted:",
    lastErr?.message || lastErr
  );
  return "aborted";
}

/**
 * Full replace of draft payload during generation (expectedGenerationId must match).
 * @returns {Promise<"ok" | "missing_course" | "forbidden" | "stale_generation" | "noop" | "aborted">}
 */
export async function transactionalDraftUpdate(draftRef, courseRef, opts) {
  const {
    expectedUserId,
    expectedGenerationId,
    buildDraftPatch,
  } = opts;

  let lastErr;
  for (let attempt = 0; attempt < TX_RETRIES; attempt++) {
    try {
      const out = await runTransaction(db, async (tx) => {
        const [courseSnap, draftSnap] = await Promise.all([
          tx.get(courseRef),
          tx.get(draftRef),
        ]);

        if (!courseSnap.exists()) return { result: "missing_course" };
        const courseData = courseSnap.data();
        if (courseData.userId !== expectedUserId) return { result: "forbidden" };
        if (courseData.generationId !== expectedGenerationId) {
          return { result: "stale_generation" };
        }

        const ver =
          draftSnap.exists() &&
          typeof draftSnap.data()?.version === "number" &&
          !Number.isNaN(draftSnap.data().version)
            ? draftSnap.data().version
            : 0;

        const raw = buildDraftPatch(courseData, draftSnap.exists() ? draftSnap.data() : null);
        if (raw === false) return { result: "aborted" };
        if (raw == null) return { result: "aborted" };

        const flat = isPlainObject(raw) ? raw : {};
        const base = draftSnap.exists() ? draftSnap.data() : {};
        const safe = filterDestructiveWrites(base, flat);
        if (Object.keys(safe).length === 0) return { result: "noop" };

        tx.set(
          draftRef,
          {
            ...safe,
            userId: expectedUserId,
            courseId: courseRef.id,
            generationId: expectedGenerationId,
            version: ver + 1,
            updatedAt: courseUpdatedAt(),
          },
          { merge: true }
        );
        return { result: "ok" };
      });

      if (out.result === "ok" || out.result === "noop") return out.result;
      if (
        out.result === "missing_course" ||
        out.result === "forbidden" ||
        out.result === "stale_generation" ||
        out.result === "aborted"
      ) {
        return out.result;
      }
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 200 + attempt * 350));
    }
  }
  console.error(
    "[courseGenerationDraft] transactionalDraftUpdate exhausted:",
    lastErr?.message || lastErr
  );
  return "aborted";
}

/**
 * Atomically promote draft modules onto the course doc and remove generation/draft state.
 */
export async function transactionalCommitDraftToCourse(courseRef, draftRef, opts) {
  const { expectedUserId, expectedGenerationId } = opts;
  let lastErr;
  for (let attempt = 0; attempt < TX_RETRIES; attempt++) {
    try {
      await runTransaction(db, async (tx) => {
        const [courseSnap, draftSnap] = await Promise.all([
          tx.get(courseRef),
          tx.get(draftRef),
        ]);
        if (!courseSnap.exists()) throw new Error("missing_course");

        const c = courseSnap.data();
        if (c.userId !== expectedUserId) throw new Error("forbidden");
        if (c.generationId !== expectedGenerationId) throw new Error("stale_generation");

        const modules = draftSnap.exists() && Array.isArray(draftSnap.data().modules)
          ? draftSnap.data().modules
          : c.modules;

        const ver =
          typeof c.version === "number" && !Number.isNaN(c.version) ? c.version : 0;

        tx.update(courseRef, {
          modules: modules ?? [],
          generationStatus: "complete",
          isGenerating: false,
          generationMessage: deleteField(),
          generationError: deleteField(),
          generationProgressDone: deleteField(),
          generationProgressTotal: deleteField(),
          generationLockHolder: deleteField(),
          generationLockUntil: deleteField(),
          version: ver + 1,
          updatedAt: courseUpdatedAt(),
        });

        if (draftSnap.exists()) tx.delete(draftRef);
      });
      return "ok";
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || "");
      if (msg === "stale_generation" || msg === "forbidden" || msg === "missing_course") {
        return msg === "missing_course" ? "missing_course" : msg;
      }
      await new Promise((r) => setTimeout(r, 200 + attempt * 450));
    }
  }
  console.error(
    "[courseGenerationDraft] transactionalCommitDraftToCourse exhausted:",
    lastErr?.message || lastErr
  );
  return "aborted";
}

/**
 * Persist a terminal failure and drop the draft so incomplete module data never lingers as "truth".
 * @returns {Promise<"ok" | "stale_generation" | "aborted">}
 */
export async function transactionalMarkGenerationFailed(courseRef, draftRef, opts) {
  const { expectedUserId, expectedGenerationId, generationError } = opts;
  let lastErr;
  for (let attempt = 0; attempt < TX_RETRIES; attempt++) {
    try {
      const out = await runTransaction(db, async (tx) => {
        const cSnap = await tx.get(courseRef);
        if (!cSnap.exists()) return { result: "aborted" };
        const c = cSnap.data();
        if (c.userId !== expectedUserId) return { result: "aborted" };
        if (c.generationId !== expectedGenerationId) return { result: "stale_generation" };
        const ver =
          typeof c.version === "number" && !Number.isNaN(c.version) ? c.version : 0;
        const dSnap = await tx.get(draftRef);
        tx.update(courseRef, {
          generationStatus: "failed",
          isGenerating: false,
          generationError: generationError || "Generation failed.",
          generationMessage: deleteField(),
          generationLockHolder: deleteField(),
          generationLockUntil: deleteField(),
          version: ver + 1,
          updatedAt: courseUpdatedAt(),
        });
        if (dSnap.exists()) tx.delete(draftRef);
        return { result: "ok" };
      });
      if (out.result === "ok" || out.result === "stale_generation") return out.result;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 200 + attempt * 400));
    }
  }
  console.error(
    "[courseGenerationDraft] transactionalMarkGenerationFailed exhausted:",
    lastErr?.message || lastErr
  );
  return "aborted";
}

/** Merge canonical course modules with draft (same length); prefer draft when it has real lesson content. */
export function mergeCourseModulesForDisplay(courseModules, draftModules) {
  const main = Array.isArray(courseModules) ? courseModules : [];
  if (!Array.isArray(draftModules) || draftModules.length === 0) return main;
  if (draftModules.length !== main.length) {
    return draftModules.length > main.length ? draftModules : main;
  }
  return main.map((m, i) => {
    const d = draftModules[i];
    if (!d) return m;
    const dLessons = Array.isArray(d.lessons) ? d.lessons.length : 0;
    const mLessons = Array.isArray(m?.lessons) ? m.lessons.length : 0;
    if (dLessons > mLessons) return d;
    if (dLessons === mLessons && dLessons > 0) {
      const dQuiz = Array.isArray(d.quiz) ? d.quiz.length : 0;
      const mQuiz = Array.isArray(m?.quiz) ? m.quiz.length : 0;
      if (dQuiz > mQuiz || (Array.isArray(d.videos) && (d.videos.length > (m?.videos?.length ?? 0)))) return d;
    }
    return m;
  });
}

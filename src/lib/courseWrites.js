import {
  deleteField,
  runTransaction,
} from "firebase/firestore";
import { db } from "./firebase";

/** ISO timestamp for course document writes. */
export function courseUpdatedAt() {
  return new Date().toISOString();
}

/** Firestore FieldValue sentinels (deleteField, increment, etc.). */
function isFirestoreFieldValue(v) {
  return v != null && typeof v === "object" && "_methodName" in v;
}

/**
 * Drop null/undefined and empty-string overwrites when a previous value exists.
 * Always keeps Firestore FieldValue sentinels (e.g. deleteField()).
 */
export function filterDestructiveWrites(prevData, flatPatch) {
  const out = {};
  for (const [key, val] of Object.entries(flatPatch)) {
    if (val === undefined) continue;
    if (isFirestoreFieldValue(val)) {
      out[key] = val;
      continue;
    }
    if (val === null) continue;
    if (val === "") {
      const cur = getDotted(prevData, key);
      if (cur !== undefined && cur !== null && cur !== "") continue;
    }
    out[key] = val;
  }
  return out;
}

function getDotted(obj, path) {
  if (!obj || typeof path !== "string") return undefined;
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    if (cur == null) return undefined;
    const p = parts[i];
    const n = Number(p);
    if (Array.isArray(cur) && Number.isFinite(n) && String(n) === p) {
      cur = cur[n];
    } else {
      cur = cur[p];
    }
  }
  return cur;
}

/**
 * Build a flat Firestore update for progress map changes (progress.<key> paths).
 * Omits unchanged keys. Uses deleteField for keys removed from next.
 */
export function progressDeltaFlatPatch(prevProgress, nextProgress) {
  const prev = prevProgress && typeof prevProgress === "object" ? prevProgress : {};
  const next = nextProgress && typeof nextProgress === "object" ? nextProgress : {};
  const out = {};
  for (const k of Object.keys(next)) {
    if (next[k] === undefined || next[k] === null) continue;
    if (JSON.stringify(next[k]) === JSON.stringify(prev[k])) continue;
    out[`progress.${k}`] = next[k];
  }
  for (const k of Object.keys(prev)) {
    if (!(k in next)) out[`progress.${k}`] = deleteField();
  }
  return out;
}

const TX_RETRIES = 7;

/**
 * Atomic course update: read version → merge-safe patch → version+1.
 * @param {import("firebase/firestore").DocumentReference} docRef
 * @param {{
 *   buildPatch: (data: Record<string, unknown>) => Record<string, unknown> | null | false,
 *   expectedUserId?: string | null,
 *   expectedGenerationId?: string | null,
 * }} opts
 * @returns {Promise<"ok" | "missing" | "forbidden" | "stale_generation" | "noop" | "aborted">}
 */
export async function transactionalCourseUpdate(docRef, opts) {
  const {
    buildPatch,
    expectedUserId = null,
    expectedGenerationId = null,
  } = opts;

  let lastErr;
  for (let attempt = 0; attempt < TX_RETRIES; attempt++) {
    try {
      const out = await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(docRef);
        if (!snap.exists()) return { result: "missing" };

        const data = snap.data();
        const userId = data.userId;
        if (expectedUserId != null && userId !== expectedUserId) {
          return { result: "forbidden" };
        }
        if (
          expectedGenerationId != null &&
          data.generationId !== expectedGenerationId
        ) {
          return { result: "stale_generation" };
        }

        const ver =
          typeof data.version === "number" && !Number.isNaN(data.version)
            ? data.version
            : 0;

        const raw = buildPatch(data);
        if (raw === false) return { result: "aborted" };
        if (raw == null) return { result: "aborted" };

        const flat =
          typeof raw === "object" && !Array.isArray(raw) ? raw : {};
        const safe = filterDestructiveWrites(data, flat);
        if (Object.keys(safe).length === 0) {
          return { result: "noop" };
        }

        transaction.update(docRef, {
          ...safe,
          version: ver + 1,
          updatedAt: courseUpdatedAt(),
        });
        return { result: "ok" };
      });

      if (out.result === "ok" || out.result === "noop") return out.result;
      if (
        out.result === "missing" ||
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
    "[courseWrites] transactionalCourseUpdate exhausted:",
    lastErr?.message || lastErr
  );
  return "aborted";
}

/**
 * Best-effort transactional merge with retries (no generation guard).
 * @returns {Promise<boolean>}
 */
export async function updateCourseWithRetry(docRef, data, opts = {}) {
  const expectedUserId = opts.expectedUserId ?? null;
  const res = await transactionalCourseUpdate(docRef, {
    expectedUserId,
    buildPatch: (prev) => filterDestructiveWrites(prev, data),
  });
  return res === "ok" || res === "noop";
}

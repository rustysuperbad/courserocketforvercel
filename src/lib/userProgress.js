import { db } from "./firebase";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";

export async function upsertUserProfile(user, fullName = "") {
  if (!user?.uid) return;

  const name = fullName || user.displayName || "";
  await setDoc(
    doc(db, "users", user.uid),
    {
      uid: user.uid,
      email: user.email || "",
      name,
      photoURL: user.photoURL || "",
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Lightweight mirror only — never overwrites course content. Course doc remains canonical for modules/progress.
 */
export async function updateUserCourseProgressMirror({ uid, courseId, percent }) {
  if (!uid || !courseId) return;

  const safePct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));

  await setDoc(
    doc(db, "users", uid),
    {
      updatedAt: serverTimestamp(),
      [`courseProgress.${courseId}.progress.percent`]: safePct,
    },
    { merge: true }
  );
}

export async function touchUserCourseOpened({ uid, courseId }) {
  if (!uid || !courseId) return;

  await setDoc(
    doc(db, "users", uid),
    {
      updatedAt: serverTimestamp(),
      [`courseProgress.${courseId}.lastOpenedAt`]: new Date().toISOString(),
    },
    { merge: true }
  );
}

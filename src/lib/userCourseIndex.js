import { collection, doc } from "firebase/firestore";
import { db } from "./firebase";

/** Subcollection path: users/{userId}/courseList/{courseId} — durable pointer so list queries never "lose" a course id. */
export function userCourseListRef(userId) {
  return collection(db, "users", userId, "courseList");
}

export function userCourseListDocRef(userId, courseId) {
  return doc(db, "users", userId, "courseList", courseId);
}

/**
 * Minimal metadata stored next to the canonical `courses/{courseId}` document.
 * Full course bodies live only on `courses/*` to avoid double maintenance.
 */
export function buildUserCourseListPayload({ userId, courseId, topic, topicKey, createdAt }) {
  return {
    courseId,
    userId,
    topic,
    topicKey,
    createdAt,
    updatedAt: createdAt,
  };
}

import { FIREBASE_PROJECT_ID } from "./firebase";

/**
 * Detects "Firestore API not enabled / never used" (GCP) and returns links for the project owner.
 * @param {unknown} err
 * @returns {{ projectId: string, enableApiUrl: string, firebaseConsoleUrl: string } | null}
 */
export function firestoreSetupHelpFromError(err) {
  const msg = String(err?.message ?? err ?? "");
  if (!msg) return null;
  const looksDisabled =
    /Firestore API has not been used/i.test(msg) ||
    (/it is disabled/i.test(msg) && /firestore/i.test(msg)) ||
    /SERVICE_DISABLED/i.test(msg) ||
    /firestore\.googleapis\.com/i.test(msg);
  if (!looksDisabled) return null;

  const fromMsg = msg.match(/project\s+([a-z0-9-]+)/i);
  const projectId = fromMsg?.[1] || FIREBASE_PROJECT_ID;

  return {
    projectId,
    enableApiUrl: `https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=${projectId}`,
    firebaseConsoleUrl: `https://console.firebase.google.com/project/${projectId}/firestore`,
  };
}

import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyAk7DCHGgbUGNYORZTd6ScaOCM2qV-kHJs",
  authDomain: "courserocket26.firebaseapp.com",
  projectId: "courserocket26",
  storageBucket: "courserocket26.firebasestorage.app",
  messagingSenderId: "944746302184",
  appId: "1:944746302184:web:44f0f19c03df47b7db575d"
};

/** Single source of truth for Firestore/GCP project id (used in setup help links). */
export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, "us-central1");
export const googleProvider = new GoogleAuthProvider(); 

setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("Failed to set auth persistence:", err);
});

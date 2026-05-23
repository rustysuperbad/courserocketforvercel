import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCX_rDFgplf0DQWT1c-38BvaSw3-AF81H4",
  authDomain: "courserocket03.firebaseapp.com",
  projectId: "courserocket03",
  storageBucket: "courserocket03.firebasestorage.app",
  messagingSenderId:  "950282294833",
  appId:  "1:950282294833:web:6219475af16e7d052aa710"
};

/** Single source of truth for Firestore/GCP project id (used in setup help links). */
export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider(); 

setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("Failed to set auth persistence:", err);
});
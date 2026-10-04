import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { localWorkspace } from "./local-workspace";
const env = import.meta.env;
const values = [
  env.VITE_FIREBASE_API_KEY,
  env.VITE_FIREBASE_AUTH_DOMAIN,
  env.VITE_FIREBASE_PROJECT_ID,
  env.VITE_FIREBASE_APP_ID,
];
export const configError =
  values.some(Boolean) && values.some((v) => !v)
    ? "Firebase configuration is incomplete."
    : null;
export const configuredProject = env.VITE_FIREBASE_PROJECT_ID || null;
const app = values.every(Boolean)
  ? initializeApp({
      apiKey: values[0],
      authDomain: values[1],
      projectId: values[2],
      appId: values[3],
    })
  : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
if (localWorkspace && auth && db) {
  if (!["localhost", "127.0.0.1", "::1"].includes(location.hostname))
    throw new Error("The local workspace is available only on this computer.");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
} else if (
  import.meta.env.DEV &&
  env.VITE_USE_EMULATORS === "true" &&
  auth &&
  db
) {
  if (configuredProject !== "demo-bazaar-watch")
    throw new Error("Emulator mode requires the isolated demo project.");
  connectAuthEmulator(auth, "http://127.0.0.1:9098");
  connectFirestoreEmulator(db, "127.0.0.1", 8081);
}
export const login = () =>
  auth && signInWithPopup(auth, new GoogleAuthProvider());
export const logout = () => auth && signOut(auth);
export const watchAuth = (callback: (user: User | null) => void) =>
  auth ? onAuthStateChanged(auth, callback) : () => {};

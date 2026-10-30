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
import { localWorkspace } from "./local-workspace";
import { reportSessionError, watchSessionErrors } from './session-token';
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
export const app = values.every(Boolean)
  ? initializeApp({
      apiKey: values[0],
      authDomain: values[1],
      projectId: values[2],
      appId: values[3],
    })
  : null;
export const auth = app ? getAuth(app) : null;
if (localWorkspace && auth) {
  if (!["localhost", "127.0.0.1", "::1"].includes(location.hostname))
    throw new Error("The local workspace is available only on this computer.");
} else if (
  import.meta.env.DEV &&
  env.VITE_USE_EMULATORS === "true" &&
  auth
) {
  if (configuredProject !== "demo-bazaar-watch")
    throw new Error("Emulator mode requires the isolated demo project.");
  connectAuthEmulator(auth, "http://127.0.0.1:9098");
}
export const login = () =>
  auth && signInWithPopup(auth, new GoogleAuthProvider());
export const logout = () => auth && signOut(auth);
export function watchAuth(callback: (user: User | null, reason?: string) => void) {
  if (!auth) return () => {};
  const instance = auth;
  let closed = false, expired = false, checking = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reason = () => expired ? 'Your session expired. Sign in again to continue.' : undefined;
  const stopErrors = watchSessionErrors((user) => {
    if (closed || instance.currentUser !== user) return;
    expired = true;
    clearTimeout(timer);
    callback(null, reason());
    void signOut(instance).catch(() => {});
  });
  // Inspect the cached expiry, refreshing only near its deadline. Offline
  // failures keep the session and back off; confirmed invalid tokens clear it.
  const check = async () => {
    clearTimeout(timer);
    const user = instance.currentUser;
    if (closed || checking || !user || document.visibilityState === 'hidden') return;
    checking = true;
    let next = 60_000;
    try {
      const token = await user.getIdTokenResult();
      next = Math.max(60_000, Date.parse(token.expirationTime) - Date.now() - 240_000);
    } catch (error) { reportSessionError(user, error); }
    finally {
      checking = false;
      if (!closed && instance.currentUser === user && !expired)
        timer = setTimeout(check, Number.isFinite(next) ? Math.min(next, 3_600_000) : 60_000);
      else if (!closed && instance.currentUser && instance.currentUser !== user) void check();
    }
  };
  const visible = () => { if (document.visibilityState !== 'hidden') void check(); };
  const stopAuth = onAuthStateChanged(instance, user => {
    if (user) expired = false;
    callback(user, reason());
    void check();
  });
  document.addEventListener('visibilitychange', visible);
  return () => { closed = true; clearTimeout(timer); stopErrors(); stopAuth(); document.removeEventListener('visibilitychange', visible); };
}

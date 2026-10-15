import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { app, configuredProject } from "./data";
import { localWorkspace } from "./local-workspace";

// Loaded with the authenticated workspace, never by public search/item pages.
export const db = app ? getFirestore(app) : null;
if (localWorkspace && db) {
  if (!["localhost", "127.0.0.1", "::1"].includes(location.hostname))
    throw new Error("The local workspace is available only on this computer.");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
} else if (
  import.meta.env.DEV &&
  import.meta.env.VITE_USE_EMULATORS === "true" &&
  db
) {
  if (configuredProject !== "demo-bazaar-watch")
    throw new Error("Emulator mode requires the isolated demo project.");
  connectFirestoreEmulator(db, "127.0.0.1", 8081);
}

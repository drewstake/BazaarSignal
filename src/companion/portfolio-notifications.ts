import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import type {
  HoldingNotification,
  NotificationInput,
} from "../../shared/companion/notifications";
import { requestBackend } from "../backend";
import { auth } from "../data";
import { portfolioSession } from "./portfolio-store";

export async function loadNotifications(uid: string) {
  const { database, check } = portfolioSession(uid);
  const result = await getDocs(
    collection(database, "users", uid, "portfolioNotifications"),
  );
  check();
  // Retain tombstone revisions for explicit recreation; the UI hides deleted settings.
  return result.docs.map((d) => d.data() as HoldingNotification);
}
export async function changeNotification(
  uid: string,
  portfolioId: string,
  holdingId: string,
  operation: "save" | "pause" | "resume" | "delete",
  input?: NotificationInput,
  expected?: HoldingNotification,
) {
  const { check } = portfolioSession(uid),
    user = auth!.currentUser!;
  const token = await user.getIdToken();
  check();
  const result = await requestBackend<HoldingNotification>(
    {
      action: "portfolio-notification",
      portfolioId,
      holdingId,
      operation,
      input,
      revision: expected?.revision ?? 0,
    },
    token,
  );
  check();
  return result;
}
export async function emailPreference(uid: string, enabled?: boolean) {
  const { database, check } = portfolioSession(uid),
    ref = doc(database, "users", uid, "portfolioPreferences", "main");
  if (enabled !== undefined) {
    await setDoc(ref, { emailEnabled: enabled });
    check();
    return enabled;
  }
  const snap = await getDoc(ref);
  check();
  return snap.exists() && snap.data().emailEnabled === true;
}

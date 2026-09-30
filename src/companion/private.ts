import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "../data";
export interface SavedItem {
  key: string;
  kind: "bazaar" | "auction";
  itemId: string;
  name: string;
  savedAt: number;
}
function identity(uid: string) {
  if (!db || auth?.currentUser?.uid !== uid)
    throw new Error("Sign in to access your private saved items.");
  return db;
}
export async function loadWatchlist(uid: string) {
  const results = await getDocs(
    query(
      collection(identity(uid), "users", uid, "watchlist"),
      orderBy("savedAt", "desc"),
      limit(100),
    ),
  );
  if (auth?.currentUser?.uid !== uid) return [];
  return results.docs.map((d) => d.data() as SavedItem);
}
export async function saveItem(uid: string, item: SavedItem) {
  await setDoc(doc(identity(uid), "users", uid, "watchlist", item.key), item);
}
export async function removeItem(uid: string, key: string) {
  await deleteDoc(doc(identity(uid), "users", uid, "watchlist", key));
}
export async function loadPreferences(uid: string, market: string) {
  const result = await getDoc(
    doc(identity(uid), "users", uid, "filters", market),
  );
  if (auth?.currentUser?.uid !== uid) return null;
  return result.exists() ? JSON.parse(result.data().json) : null;
}
export async function savePreferences(
  uid: string,
  market: string,
  values: unknown,
) {
  await setDoc(doc(identity(uid), "users", uid, "filters", market), {
    json: JSON.stringify(values),
    updatedAt: Date.now(),
  });
}

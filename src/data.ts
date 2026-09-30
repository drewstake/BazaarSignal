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
import {
  connectFirestoreEmulator,
  getFirestore,
  onSnapshot,
  doc,
} from "firebase/firestore";
import { backendUrl, requestBackend, validBackendUrl } from './backend';
import {
  DEFAULT_SETTINGS,
  type AppData,
  type Action,
  type Book,
  type Workflow,
  type AlertEvent,
  type ProductPrice,
} from "../shared/model";
import {
  updateWorkflow,
  validateSettings,
  validateTargets,
} from "../shared/workflow";
import { trigger } from "../functions/src/engine";

const env = import.meta.env;
const values = [
  env.VITE_FIREBASE_API_KEY,
  env.VITE_FIREBASE_AUTH_DOMAIN,
  env.VITE_FIREBASE_PROJECT_ID,
  env.VITE_FIREBASE_APP_ID,
];
const noFirebase = values.every((v) => !v);
// Keep the local app usable while a newly connected project's backend is staged.
// This override never bypasses Firebase authentication in production builds.
const localPreview = import.meta.env.DEV && env.VITE_APP_MODE === "local";
const useLocal = noFirebase || localPreview;
export const configuredProject = env.VITE_FIREBASE_PROJECT_ID || null;
export const backendReady = env.VITE_BACKEND_READY === "true" && validBackendUrl(backendUrl);
export const isLocalLive =
  useLocal &&
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("demo") !== "1";
export const isDemo = useLocal && !isLocalLive;
export const isLocal = isDemo || isLocalLive;
export const configError =
  !noFirebase && values.some((v) => !v)
    ? "Firebase configuration is incomplete. Fill in all four VITE_FIREBASE values and rebuild."
    : null;
const app =
  !noFirebase && !configError
    ? initializeApp({
        apiKey: values[0],
        authDomain: values[1],
        projectId: values[2],
        appId: values[3],
      })
    : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
if (env.VITE_USE_EMULATORS === "true" && auth && db) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
export const login = () =>
  auth && signInWithPopup(auth, new GoogleAuthProvider());
export const logout = () => auth && signOut(auth);
export function watchAuth(callback: (user: User | null) => void) {
  return auth ? onAuthStateChanged(auth, callback) : () => {};
}
export const emptyData: AppData = {
  workflows: [],
  prices: [],
  books: {},
  status: { lastUpdated: 0, lastSuccess: 0, lastAttempt: 0, error: null },
  settings: DEFAULT_SETTINGS,
  events: [],
};
const seed = [
  ["SUMMONING_EYE", "Summoning Eye", 1_145_000, 1_123_000, 38_420],
  [
    "ENCHANTED_DIAMOND_BLOCK",
    "Enchanted Diamond Block",
    205_400,
    202_900,
    185_240,
  ],
  ["BOOSTER_COOKIE", "Booster Cookie", 13_420_000, 13_180_000, 52_180],
  ["ENCHANTED_BLAZE_ROD", "Enchanted Blaze Rod", 413_800, 408_200, 18_750],
  ["ENCHANTED_SUGAR_CANE", "Enchanted Sugar Cane", 128_600, 125_900, 210_410],
  ["ENCHANTED_GOLD_BLOCK", "Enchanted Gold Block", 110_400, 108_300, 145_620],
  ["ENCHANTED_IRON_BLOCK", "Enchanted Iron Block", 236_700, 232_200, 75_350],
  [
    "ENCHANTED_REDSTONE_BLOCK",
    "Enchanted Redstone Block",
    51_300,
    49_800,
    411_870,
  ],
  [
    "ENCHANTED_EMERALD_BLOCK",
    "Enchanted Emerald Block",
    163_700,
    160_800,
    68_920,
  ],
  ["RECOMBOBULATOR_3000", "Recombobulator 3000", 8_210_000, 8_050_000, 10_420],
  [
    "ENCHANTED_LAPIS_LAZULI_BLOCK",
    "Enchanted Lapis Block",
    94_200,
    91_700,
    108_370,
  ],
  ["ENCHANTED_ENDER_PEARL", "Enchanted Ender Pearl", 790, 752, 1_410_550],
] as const;
export function freshDemo(): AppData {
  const prices: ProductPrice[] = seed.map(([id, name, buy, sell, volume]) => ({
    id,
    name,
    buy,
    sell,
    volume,
  }));
  const books: Record<string, Book> = {};
  prices.forEach(
    (p) =>
      (books[p.id] = {
        buy: [
          { amount: 500, pricePerUnit: p.buy!, orders: 8 },
          { amount: 2500, pricePerUnit: p.buy! * 1.005, orders: 23 },
        ],
        sell: [
          { amount: 500, pricePerUnit: p.sell!, orders: 6 },
          { amount: 2500, pricePerUnit: p.sell! * 0.995, orders: 18 },
        ],
      }),
  );
  const now = Date.now();
  const workflows: Workflow[] = prices.slice(0, 4).map((p, i) => ({
    id: `demo-${i}`,
    itemId: p.id,
    itemName: p.name,
    quantity: [100, 64, 10, 128][i],
    buyTarget: [1_100_000, 200_000, 13_000_000, 400_000][i],
    sellTarget: [1_200_000, 215_000, 14_000_000, 430_000][i],
    stage:
      i === 1
        ? "watching_sell"
        : i === 3
          ? "awaiting_purchase"
          : "watching_buy",
    paused: false,
    channels: ["email", "discord"],
    generation: 0,
    revision: 0,
    purchaseCost: i === 1 ? 12_800_000 : null,
    createdAt: now - 86_400_000,
    updatedAt: now,
  }));
  return {
    workflows,
    prices,
    books,
    settings: {
      ...DEFAULT_SETTINGS,
      discordEnabled: true,
      discordTested: true,
    },
    events: [],
    status: {
      lastUpdated: now,
      lastSuccess: now,
      lastAttempt: now,
      error: null,
    },
  };
}
const KEY = "bazaar-watch-demo-v1";
export function readDemo(): AppData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.workflows) && data.books && data.settings)
        return data;
    }
  } catch {}
  return freshDemo();
}
export function saveDemo(data: AppData) {
  localStorage.setItem(KEY, JSON.stringify(data));
}
export function demoAction(data: AppData, a: Action): AppData {
  if (a.type === "test")
    return {
      ...data,
      settings: {
        ...data.settings,
        discordTested: a.channel === "discord" || data.settings.discordTested,
      },
    };
  if (a.type === "settings")
    return { ...data, settings: validateSettings(a, data.settings) };
  if (a.type === "create") {
    if (data.workflows.filter((w) => w.stage !== "completed").length >= 20)
      throw new Error("You can have at most 20 active workflows.");
    const p = data.prices.find((p) => p.id === a.itemId);
    if (!p) throw new Error("Item unavailable.");
    const w: Workflow = {
      id: crypto.randomUUID(),
      itemId: p.id,
      itemName: p.name,
      ...validateTargets(a),
      stage: "watching_buy",
      paused: false,
      generation: 0,
      revision: 0,
      purchaseCost: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    return { ...data, workflows: [...data.workflows, w] };
  }
  if (a.type === "delete")
    return { ...data, workflows: data.workflows.filter((w) => w.id !== a.id) };
  return {
    ...data,
    workflows: data.workflows.map((w) =>
      w.id === a.id ? updateWorkflow(w, a, Date.now()) : w,
    ),
  };
}
export function simulate(
  data: AppData,
  itemId: string,
  side: "buy" | "sell",
): AppData {
  const now = Date.now();
  const workflow = data.workflows.find(
    (w) =>
      w.itemId === itemId &&
      w.stage === (side === "buy" ? "watching_buy" : "watching_sell"),
  );
  if (!workflow)
    throw new Error(`Create an active ${side} alert for this item first.`);
  const price =
    side === "buy"
      ? workflow.buyTarget * 0.999
      : (workflow.sellTarget / (1 - data.settings.taxRate / 100)) * 1.001;
  const books = {
    ...data.books,
    [itemId]: {
      ...data.books[itemId],
      [side]: [
        {
          amount: Math.max(workflow.quantity * 2, 3000),
          pricePerUnit: price,
          orders: 12,
        },
      ],
    },
  };
  const generated: AlertEvent[] = [];
  const workflows = data.workflows.map((w) => {
    const result = trigger(
      w,
      books[w.itemId],
      now,
      data.settings,
      window.location.origin,
      now,
    );
    if (!result) return w;
    generated.push({
      ...result.event,
      message: "DEMO — no message was sent.\n" + result.event.message,
      deliveries: {},
    });
    return result.workflow;
  });
  return {
    ...data,
    books,
    workflows,
    events: [...generated, ...data.events],
    prices: data.prices.map((p) =>
      p.id === itemId ? { ...p, [side]: price } : p,
    ),
    status: {
      lastUpdated: now,
      lastSuccess: now,
      lastAttempt: now,
      error: null,
    },
  };
}
export async function remoteAction(a: Action) {
  void a;
  throw new Error("Legacy workflows are unavailable. Create a single price alert.");
}
export function subscribe(
  uid: string | null,
  onData: (patch: Partial<AppData>) => void,
  onError: (message: string, market?: boolean) => void,
) {
  if (!db) return () => {};
  let closed = false, pending = false;
  const current = auth?.currentUser;
  async function refresh() {
    if (pending || closed) return;
    pending = true;
    try {
      const patch = await requestBackend<Partial<AppData>>({action:'snapshot'});
      if (uid) delete patch.monitoring; // Signed-in users need their own worker progress.
      if (!closed) onData(patch);
    } catch (e) {
      if (!closed) onError(e instanceof Error ? e.message : 'Prices unavailable.', true);
    }
    if (!closed && current && uid && auth?.currentUser?.uid === uid) {
      try {
        const patch=await requestBackend<Partial<AppData>>({action:'account'},await current.getIdToken());
        if (!closed && auth?.currentUser?.uid === uid) onData(patch);
      } catch(e) { if (!closed) onError(e instanceof Error ? e.message : 'Your alert status is unavailable.', false); }
    }
    pending = false;
  }
  void refresh();
  const stop = uid ? onSnapshot(doc(db, 'users', uid, 'status', 'main'), s => {
    if (!closed && auth?.currentUser?.uid === uid && s.exists()) {
      try { onData(JSON.parse(s.data().json)); } catch { onError('Invalid monitoring status.', false); }
    }
  }, () => { if (!closed) onError('Sign in with a verified Google account to view your alert status.', false); }) : () => {};
  const timer = setInterval(refresh, 60000);
  return () => { closed = true; clearInterval(timer); stop(); };
}

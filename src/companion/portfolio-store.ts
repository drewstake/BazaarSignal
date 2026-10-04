import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  increment,
} from "firebase/firestore";
import { auth, db } from "../data";
import { addPurchase, validPosition } from "../../shared/companion/positions";
import {
  assetId,
  legacyHolding,
  validId,
  validPortfolio,
  validPortfolioHolding,
  type Portfolio,
  type Holding,
  type Asset,
} from "../../shared/companion/portfolio";

export function portfolioSession(uid: string) {
  const user = auth?.currentUser;
  if (
    !db ||
    !user ||
    user.uid !== uid ||
    !user.emailVerified ||
    !user.providerData.some((p) => p.providerId === "google.com")
  )
    throw new Error(
      "Sign in with a verified Google account to use portfolios.",
    );
  return {
    database: db,
    check: () => {
      if (auth?.currentUser !== user)
        throw new Error("Your account changed. Reopen Portfolios to continue.");
    },
  };
}
function pathId(id: string) {
  if (!validId(id)) throw new Error("Invalid portfolio or holding ID.");
  return id;
}
/** Per-position atomic copy + durable marker. Originals are retained, never added twice. */
const migrations = new WeakMap<object, Promise<void>>();
export async function migratePositions(uid: string) {
  const { check } = portfolioSession(uid),
    user = auth!.currentUser!;
  let pending = migrations.get(user);
  if (!pending) {
    pending = copyPositions(uid);
    migrations.set(user, pending);
    pending.catch(() => migrations.delete(user));
  }
  await pending;
  check();
}
async function copyPositions(uid: string) {
  const { database, check } = portfolioSession(uid);
  const old = await getDocs(collection(database, "users", uid, "positions"));
  check();
  for (const row of old.docs) {
    const p = row.data();
    if (!validPosition(p) || p.itemId !== row.id)
      throw new Error(
        "A legacy position is invalid. Migration stopped safely; no records were deleted.",
      );
    try {
      await runTransaction(database, async (tx) => {
        check();
        const marker = doc(
            database,
            "users",
            uid,
            "positionMigrations",
            p.itemId,
          ),
          parent = doc(database, "users", uid, "portfolios", "default"),
          target = doc(parent, "holdings", `bz_${p.itemId}`);
        const [done, portfolio, existing, source] = await Promise.all([
          tx.get(marker),
          tx.get(parent),
          tx.get(target),
          tx.get(row.ref),
        ]);
        check();
        if (done.exists() || (portfolio.exists() && portfolio.data().deleted))
          return;
        if (!source.exists()) return;
        const current = source.data();
        if (!validPosition(current))
          throw new Error("Legacy position changed to invalid data.");
        if (existing.exists())
          throw new Error(
            "A default-portfolio holding conflicts with an unmigrated position. Originals are preserved.",
          );
        const now = Date.now();
        if (!portfolio.exists())
          tx.set(parent, {
            id: "default",
            name: "My portfolio",
            createdAt: now,
            updatedAt: now,
            revision: 1,
            deleted: false,
          });
        tx.set(target, { ...legacyHolding(current), revision: 1 });
        tx.set(marker, {
          itemId: p.itemId,
          sourceRevision: current.revision,
          migratedAt: now,
        });
      });
    } catch (error) {
      check();
      // Firestore rules can reject a competing create before the SDK sees its
      // optimistic conflict. Accept only a durable, validated winning marker.
      if ((error as { code?: string }).code !== "permission-denied")
        throw error;
      const winner = await getDoc(
        doc(database, "users", uid, "positionMigrations", p.itemId),
      );
      check();
      if (!winner.exists() || winner.data().itemId !== p.itemId) throw error;
    }
    check();
  }
}
export async function loadPortfolios(uid: string) {
  const { database, check } = portfolioSession(uid);
  await migratePositions(uid);
  check();
  const result = await getDocs(
    collection(database, "users", uid, "portfolios"),
  );
  check();
  return result.docs
    .map((d) => {
      const p = d.data();
      if (!validPortfolio(p) || p.id !== d.id)
        throw new Error("Invalid saved portfolio.");
      return p;
    })
    .filter((p) => !p.deleted)
    .sort((a, b) => a.createdAt - b.createdAt);
}
export async function savePortfolio(
  uid: string,
  name: string,
  expected?: Portfolio,
  deleted = false,
) {
  const { database, check } = portfolioSession(uid),
    id = expected?.id ?? crypto.randomUUID();
  const ref = doc(database, "users", uid, "portfolios", pathId(id));
  const result = await runTransaction(database, async (tx) => {
    check();
    const snap = await tx.get(ref);
    check();
    if (
      expected &&
      (!snap.exists() ||
        snap.data().revision !== expected.revision ||
        snap.data().deleted)
    )
      throw new Error("This portfolio changed. Reload before trying again.");
    if (!expected && snap.exists())
      throw new Error("Portfolio already exists.");
    const now = Date.now(),
      p: Portfolio = {
        id,
        name: name.trim(),
        createdAt: expected?.createdAt ?? now,
        updatedAt: Math.max(now, expected?.updatedAt ?? 0),
        revision: (expected?.revision ?? 0) + 1,
        deleted,
      };
    if (!validPortfolio(p))
      throw new Error("Use a portfolio name from 1 to 80 characters.");
    tx.set(ref, p);
    return p;
  });
  check();
  return result;
}
export async function loadHoldings(uid: string, portfolioId: string) {
  const { database, check } = portfolioSession(uid);
  const result = await getDocs(
    collection(
      database,
      "users",
      uid,
      "portfolios",
      pathId(portfolioId),
      "holdings",
    ),
  );
  check();
  return result.docs
    .map((d) => {
      const h = d.data();
      if (!validPortfolioHolding(h) || h.id !== d.id)
        throw new Error("Invalid saved holding.");
      return h;
    })
    .filter((h) => !h.deleted);
}
export type HoldingChange = Asset & {
  mode: "create" | "edit" | "purchase" | "delete";
  itemId: string;
  name: string;
  quantity: number;
  costBasis: number;
  expected?: Holding;
};
export async function saveHolding(
  uid: string,
  portfolioId: string,
  change: HoldingChange,
) {
  if (change.kind !== 'bazaar' && change.mode !== 'delete')
    throw new Error('Only Bazaar holdings are supported. Saved unsupported holdings can be removed.');
  const { database, check } = portfolioSession(uid),
    id = assetId(change.itemId, change),
    parent = doc(database, "users", uid, "portfolios", pathId(portfolioId)),
    ref = doc(parent, "holdings", id);
  const result = await runTransaction(database, async (tx) => {
    check();
    const notificationRef = doc(
      database,
      "users",
      uid,
      "portfolioNotifications",
      `${portfolioId}__${id}`,
    );
    const [ps, snap, notification] = await Promise.all([
      tx.get(parent),
      tx.get(ref),
      ...(change.mode === "delete" ? [tx.get(notificationRef)] : []),
    ]);
    check();
    if (!ps.exists() || ps.data().deleted)
      throw new Error("Portfolio was deleted. Reload Portfolios.");
    const current = snap.exists() ? (snap.data() as Holding) : null;
    if (current && !validPortfolioHolding(current))
      throw new Error("Invalid saved holding.");
    if (change.mode === "create" && current && !current.deleted)
      throw new Error("You already track this asset. Use Add purchase.");
    if (change.mode !== "create" && (!current || current.deleted))
      throw new Error("Holding was deleted. Reload Portfolios.");
    if (
      ["edit", "delete"].includes(change.mode) &&
      current?.revision !== change.expected?.revision
    )
      throw new Error(
        "This holding changed in another tab. Reload before editing.",
      );
    const amount =
      change.mode === "purchase"
        ? addPurchase(current!, change)
        : change.mode === "delete"
          ? current!
          : { quantity: change.quantity, costBasis: change.costBasis };
    const now = Date.now();
    const next: Holding = {
      id,
      itemId: change.itemId,
      name: current?.name ?? change.name,
      kind: change.kind,
      configuration: change.configuration,
      stackSize: change.stackSize,
      quantity: amount.quantity,
      costBasis: amount.costBasis,
      createdAt: current?.createdAt ?? now,
      updatedAt: Math.max(now, current?.updatedAt ?? 0),
      revision: (current?.revision ?? 0) + 1,
      deleted: change.mode === "delete",
    };
    if (!validPortfolioHolding(next))
      throw new Error("Invalid holding. Check the asset, quantity and cost.");
    tx.set(ref, { ...next, revision: increment(1) }, { merge: true });
    if (change.mode === "delete" && notification?.exists())
      tx.update(notificationRef, {
        enabled: false,
        deleted: true,
        revision: increment(1),
        updatedAt: now,
      });
    return next;
  });
  check();
  return result;
}

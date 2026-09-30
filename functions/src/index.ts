import { randomUUID, randomBytes, createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret, defineString } from "firebase-functions/params";
import { logger } from "firebase-functions";
import {
  DEFAULT_SETTINGS,
  type Action,
  type AlertEvent,
  type Book,
  type ProductPrice,
  type Settings,
  type Workflow,
  type Channel,
  type PriceAlertInput,
} from "../../shared/model.js";
import {
  confirmation,
  newPriceAlert,
  validatePriceAlert,
} from "../../shared/price-alert.js";
import { isFresh, parseBook } from "../../shared/market.js";
import {
  updateWorkflow,
  validateSettings,
  validateTargets,
} from "../../shared/workflow.js";
import { isOwner } from "./security.js";
import { trigger } from "./engine.js";
import {
  due,
  failedAttempt,
  pending,
  ProviderError,
  send,
} from "./delivery.js";

initializeApp();
const db = getFirestore();
setGlobalOptions({
  region: "us-central1",
  minInstances: 0,
  maxInstances: 2,
  timeoutSeconds: 55,
  memory: "256MiB",
  cpu: "gcf_gen1",
  concurrency: 1,
});
const OWNER = defineString("OWNER_UID");
const APP_URL = defineString("APP_URL");
const GMAIL_USER = defineString("GMAIL_USER");
const DISCORD_USER = defineString("DISCORD_USER_ID", { default: "" });
const GMAIL_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");
const secrets = [GMAIL_PASSWORD];
const owner = () => db.collection("owners").doc(OWNER.value());
const settingsRef = () => owner().collection("settings").doc("main");
const workflows = () => owner().collection("workflows");
const events = () => owner().collection("events");
const leaseRef = db.doc("system/pollLease");
const errorText = (e: unknown) =>
  e instanceof Error ? e.message.slice(0, 200) : "Unexpected service error";

// The link is a narrow capability: it can only turn off its own alert.
// Store the token hash outside all client-readable collections.
const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const createPriceAlert = onCall(
  { secrets },
  async (request) => {
    if (!isOwner(request.auth, OWNER.value()))
      throw new HttpsError(
        "permission-denied",
        "This app is private to its verified owner.",
      );
    const input = request.data as PriceAlertInput;
    try {
      validatePriceAlert(input);
    } catch (e) {
      throw new HttpsError("invalid-argument", errorText(e));
    }
    const token = randomBytes(32).toString("hex");
    const id = `alert-${input.requestId}`;
    const ref = workflows().doc(id);
    const eventRef = events().doc(`${id}-created`);
    const fingerprint = tokenHash(
      JSON.stringify([
        input.itemId,
        input.side,
        input.quantity,
        input.target,
        input.taxRate,
      ]),
    );
    try {
      await db.runTransaction(async (tx) => {
        const lockRef = owner().collection("settings").doc("mutationLock");
        const [existing, lock, all, index, settings] = await Promise.all([
          tx.get(ref),
          tx.get(lockRef),
          tx.get(workflows()),
          tx.get(db.doc(`market/prices-${shard(input.itemId)}`)),
          tx.get(settingsRef()),
        ]);
        if (existing.exists) {
          if (existing.data()?.requestFingerprint !== fingerprint)
            throw new Error(
              "This request was already used for a different alert.",
            );
          return;
        }
        if (
          all.docs.filter(
            (d) => d.data().stage !== "completed" && !d.data().paused,
          ).length >= 20
        )
          throw new Error("You can have at most 20 active alerts.");
        if (all.size >= 100)
          throw new Error("The saved-alert limit has been reached.");
        if (
          settings.data()?.monitoringPaused ||
          settings.data()?.emailEnabled === false
        )
          throw new Error(
            "Email monitoring is paused. Enable it before creating an alert.",
          );
        const product = (
          index.data()?.products as ProductPrice[] | undefined
        )?.find((p) => p.id === input.itemId);
        if (!product)
          throw new Error(
            "This item is not available in the current Bazaar catalog.",
          );
        const now = Date.now();
        const w = newPriceAlert(id, product.name, input, now);
        const url = new URL(APP_URL.value());
        url.pathname = "/";
        url.search = "";
        url.hash = `disable=${token}`;
        tx.create(ref, { ...w, requestFingerprint: fingerprint });
        tx.create(db.doc(`alertLinks/${tokenHash(token)}`), {
          workflowId: id,
          ownerUid: OWNER.value(),
          createdAt: now,
        });
        tx.create(eventRef, {
          ...confirmation(w, url.href, now),
          expiresAt: now + 30 * 86_400_000,
        });
        tx.set(lockRef, { version: (lock.data()?.version ?? 0) + 1 });
      });
    } catch (e) {
      throw new HttpsError("invalid-argument", errorText(e));
    }
    // A provider failure cannot undo the saved alert: the scheduler retries its outbox.
    try {
      await deliverQueued(eventRef.id);
    } catch {
      logger.warn("Confirmation remains queued for retry.");
    }
    const event = await eventRef.get();
    return {
      id,
      emailStatus: event.data()?.deliveries?.email?.status ?? "queued",
    };
  },
);

export const disablePriceAlert = onCall(async (request) => {
  const token = request.data?.token;
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    throw new HttpsError("invalid-argument", "This alert link is invalid.");
  const linkRef = db.doc(`alertLinks/${tokenHash(token)}`);
  return db.runTransaction(async (tx) => {
    const link = await tx.get(linkRef);
    if (!link.exists || link.data()?.ownerUid !== OWNER.value())
      throw new HttpsError("not-found", "This alert link is no longer valid.");
    const ref = workflows().doc(link.data()!.workflowId);
    const [workflow, queued] = await Promise.all([
      tx.get(ref),
      tx.get(events().where("workflowId", "==", ref.id)),
    ]);
    if (workflow.exists && !workflow.data()?.paused)
      tx.update(ref, {
        paused: true,
        revision: (workflow.data()?.revision ?? 0) + 1,
        updatedAt: Date.now(),
      });
    // Cancel unclaimed deliveries. A provider request already in flight may finish.
    for (const event of queued.docs) {
      const data = event.data() as AlertEvent;
      if (data.side === "created") continue;
      const deliveries = { ...data.deliveries };
      for (const channel of Object.keys(deliveries) as Channel[]) {
        const d = deliveries[channel]!;
        if (
          d.status === "queued" ||
          (d.status === "sending" && d.leaseUntil <= Date.now())
        )
          deliveries[channel] = {
            ...d,
            status: "cancelled",
            leaseUntil: 0,
            error: null,
          };
      }
      tx.update(event.ref, { deliveries, pending: pending(deliveries) });
    }
    return { disabled: true };
  });
});

let itemMarket: { raw: Record<string, unknown>; fetched: number } | null = null;
let itemFetch: Promise<Record<string, unknown>> | null = null;
export const getItemBook = onCall(async (request) => {
  if (!isOwner(request.auth, OWNER.value()))
    throw new HttpsError(
      "permission-denied",
      "This app is private to its verified owner.",
    );
  const id = request.data?.itemId;
  if (typeof id !== "string" || !/^[A-Za-z0-9_:\-]{1,100}$/.test(id))
    throw new HttpsError("invalid-argument", "Invalid item.");
  if (!itemMarket || Date.now() - itemMarket.fetched >= 60_000) {
    itemFetch ??= getJSON("https://api.hypixel.net/v2/skyblock/bazaar")
      .then((raw) => {
        itemMarket = { raw, fetched: Date.now() };
        return raw;
      })
      .finally(() => {
        itemFetch = null;
      });
    await itemFetch;
  }
  const raw = itemMarket!.raw;
  if (typeof raw.lastUpdated !== "number" || !isFresh(raw.lastUpdated))
    throw new HttpsError(
      "unavailable",
      "Market data is stale. Please try again shortly.",
    );
  const product = (raw.products as Record<string, unknown> | undefined)?.[id];
  if (!product)
    throw new HttpsError("not-found", "This item is not available.");
  return { book: parseBook(product), timestamp: raw.lastUpdated };
});
async function providerConfig() {
  const user = await getAuth().getUser(OWNER.value());
  if (!user.emailVerified || !user.email)
    throw new Error("Owner must have a verified email address.");
  return {
    email: user.email,
    emailProvider: "gmail" as const,
    gmailUser: GMAIL_USER.value(),
    gmailPassword: GMAIL_PASSWORD.value(),
    from: GMAIL_USER.value(),
    resendKey: "",
    discordToken: process.env.DISCORD_BOT_TOKEN ?? "",
    discordUser: DISCORD_USER.value(),
  };
}

export const performAction = onCall({ secrets }, async (request) => {
  if (!isOwner(request.auth, OWNER.value()))
    throw new HttpsError(
      "permission-denied",
      "This app is private to its verified owner.",
    );
  const a = request.data as Action;
  if (!a || typeof a !== "object" || typeof a.type !== "string")
    throw new HttpsError("invalid-argument", "Invalid action.");
  if (a.type === "test") {
    if (a.channel !== "email" && a.channel !== "discord")
      throw new HttpsError("invalid-argument", "Invalid channel.");
    const ref = owner().collection("settings").doc("testLimits");
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (Date.now() - (snap.data()?.lastTest ?? 0) < 60_000)
        throw new HttpsError(
          "resource-exhausted",
          "Wait one minute before sending another test.",
        );
      tx.set(ref, { lastTest: Date.now() });
    });
    try {
      await send(
        a.channel,
        `test-${randomUUID()}`,
        `Bazaar Watch: test notification\nYour ${a.channel === "discord" ? "Discord DMs" : "email alerts"} are connected.\n${APP_URL.value()}`,
        await providerConfig(),
      );
      if (a.channel === "discord")
        await settingsRef().set({ discordTested: true }, { merge: true });
      return { ok: true };
    } catch (e) {
      throw new HttpsError("failed-precondition", errorText(e));
    }
  }
  try {
    return await db.runTransaction(async (tx) => {
      const settingsSnap = await tx.get(settingsRef());
      const settings = {
        ...DEFAULT_SETTINGS,
        ...settingsSnap.data(),
      } as Settings;
      const lockRef = owner().collection("settings").doc("mutationLock");
      const lock = await tx.get(lockRef);
      if (a.type === "settings") {
        tx.set(settingsRef(), validateSettings(a, settings));
        return { ok: true };
      }
      const all = await tx.get(workflows());
      const items = all.docs.map(
        (s) => ({ ...s.data(), id: s.id }) as Workflow,
      );
      const active = items.filter((w) => w.stage !== "completed").length;
      if (a.type === "create") {
        if (active >= 20)
          throw new Error("You can have at most 20 active workflows.");
        if (items.length >= 100)
          throw new Error(
            "Delete older workflows before adding more (100 saved maximum).",
          );
        if (
          typeof a.itemId !== "string" ||
          !/^[A-Za-z0-9_:\-]{1,100}$/.test(a.itemId)
        )
          throw new Error("Invalid item.");
        const index = await tx.get(db.doc(`market/prices-${shard(a.itemId)}`));
        const product = (
          index.data()?.products as ProductPrice[] | undefined
        )?.find((p) => p.id === a.itemId);
        if (!product)
          throw new Error(
            "Item is not available in the current Bazaar catalog.",
          );
        const values = validateTargets(a);
        if (values.channels.includes("discord") && !settings.discordTested)
          throw new Error("Test Discord DMs in Settings first.");
        const ref = workflows().doc();
        const w: Workflow = {
          id: ref.id,
          itemId: a.itemId,
          itemName: product.name,
          ...values,
          stage: "watching_buy",
          paused: false,
          generation: 0,
          revision: 0,
          purchaseCost: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        tx.set(ref, w);
        tx.set(lockRef, { version: (lock.data()?.version ?? 0) + 1 });
        return { ok: true, id: ref.id };
      }
      if (!("id" in a) || typeof a.id !== "string")
        throw new Error("Invalid workflow.");
      const w = items.find((w) => w.id === a.id);
      if (!w) throw new Error("Workflow no longer exists.");
      if (a.type === "delete") tx.delete(workflows().doc(w.id));
      else {
        const updated = updateWorkflow(w, a, Date.now());
        if (
          w.stage === "completed" &&
          updated.stage !== "completed" &&
          active >= 20
        )
          throw new Error("You can have at most 20 active workflows.");
        if (updated.channels.includes("discord") && !settings.discordTested)
          throw new Error("Test Discord DMs in Settings first.");
        tx.set(workflows().doc(w.id), updated);
      }
      tx.set(lockRef, { version: (lock.data()?.version ?? 0) + 1 });
      return { ok: true };
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError("invalid-argument", errorText(e));
  }
});

function shard(id: string) {
  let n = 0;
  for (const c of id) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return n % 8;
}
async function getJSON(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Hypixel returned HTTP ${res.status}.`);
  const data = (await res.json()) as Record<string, unknown>;
  if (data.success !== true)
    throw new Error("Hypixel returned an unsuccessful response.");
  return data;
}

async function refreshMarket(token: string) {
  const now = Date.now();
  const [catalogSnap, raw, currentWorkflows, settingsSnapshot] =
    await Promise.all([
      db.doc("market/catalog").get(),
      getJSON("https://api.hypixel.net/v2/skyblock/bazaar"),
      workflows().where("stage", "!=", "completed").get(),
      settingsRef().get(),
    ]);
  const initialSettings = {
    ...DEFAULT_SETTINGS,
    ...settingsSnapshot.data(),
  } as Settings;
  if (
    typeof raw.lastUpdated !== "number" ||
    !isFresh(raw.lastUpdated, now) ||
    !raw.products ||
    typeof raw.products !== "object" ||
    Array.isArray(raw.products)
  )
    throw new Error("Market data is stale or malformed.");
  const lastUpdated = raw.lastUpdated;
  let names = (catalogSnap.data()?.items ?? {}) as Record<string, string>;
  if (now - (catalogSnap.data()?.updatedAt ?? 0) > 86_400_000) {
    try {
      const resource = await getJSON(
        "https://api.hypixel.net/v2/resources/skyblock/items",
      );
      if (!Array.isArray(resource.items))
        throw new Error("Invalid item catalog.");
      const marketIds = new Set(Object.keys(raw.products));
      names = Object.fromEntries(
        resource.items
          .filter(
            (x: { id?: string; name?: string }) =>
              typeof x.id === "string" &&
              typeof x.name === "string" &&
              marketIds.has(x.id),
          )
          .map((x: { id: string; name: string }) => [x.id, x.name]),
      );
      if (Buffer.byteLength(JSON.stringify(names)) > 700_000)
        throw new Error("Item catalog exceeded its safety size limit.");
      await db.doc("market/catalog").set({ items: names, updatedAt: now });
    } catch (e) {
      logger.warn("Item names could not refresh; retaining cached names.", {
        reason: errorText(e),
      });
    }
  }
  const tracked = new Set(
    currentWorkflows.docs.map((s) => (s.data() as Workflow).itemId),
  );
  const books: Record<string, Book> = {};
  const prices: ProductPrice[][] = Array.from({ length: 8 }, () => []);
  for (const [id, product] of Object.entries(raw.products)) {
    try {
      const book = parseBook(product);
      const quick = (
        product as {
          quick_status?: { buyMovingWeek?: number; sellMovingWeek?: number };
        }
      ).quick_status;
      prices[shard(id)].push({
        id,
        name:
          names[id] ??
          id
            .toLowerCase()
            .replaceAll("_", " ")
            .replace(/\b\w/g, (c) => c.toUpperCase()),
        buy: book.buy[0]?.pricePerUnit ?? null,
        sell: book.sell[0]?.pricePerUnit ?? null,
        volume: Number.isFinite(quick?.buyMovingWeek)
          ? quick!.buyMovingWeek!
          : 0,
      });
      if (tracked.has(id)) books[id] = book;
    } catch {
      /* A malformed product cannot trigger an alert. */
    }
  }
  if (!prices.some((p) => p.length))
    throw new Error("Hypixel returned no valid market products.");
  for (const doc of [...prices, { books }])
    if (Buffer.byteLength(JSON.stringify(doc)) > 700_000)
      throw new Error("Market cache exceeded its safety size limit.");
  await db.runTransaction(async (tx) => {
    const lease = await tx.get(leaseRef);
    if (lease.data()?.token !== token || lease.data()?.until <= Date.now())
      throw new Error("Poll lease expired.");
    for (let i = 0; i < 8; i++)
      tx.set(db.doc(`market/prices-${i}`), {
        products: prices[i],
        lastUpdated,
      });
    tx.set(db.doc("market/depth"), { books, lastUpdated });
    tx.set(db.doc("market/status"), {
      lastUpdated,
      lastSuccess: Date.now(),
      lastAttempt: now,
      error: null,
    });
  });
  for (const snap of currentWorkflows.docs) {
    const candidate = { ...snap.data(), id: snap.id } as Workflow;
    if (
      !trigger(
        candidate,
        books[candidate.itemId],
        lastUpdated,
        initialSettings,
        APP_URL.value(),
        Date.now(),
      )
    )
      continue;
    await db.runTransaction(async (tx) => {
      const [fresh, settingSnap, lease] = await Promise.all([
        tx.get(snap.ref),
        tx.get(settingsRef()),
        tx.get(leaseRef),
      ]);
      if (
        !fresh.exists ||
        lease.data()?.token !== token ||
        lease.data()?.until <= Date.now()
      )
        return;
      const w = { ...fresh.data(), id: fresh.id } as Workflow;
      const settings = {
        ...DEFAULT_SETTINGS,
        ...settingSnap.data(),
      } as Settings;
      const result = trigger(
        w,
        books[w.itemId],
        lastUpdated,
        settings,
        APP_URL.value(),
        Date.now(),
      );
      if (!result) return;
      const eventRef = events().doc(result.event.id);
      const existing = await tx.get(eventRef);
      if (existing.exists) return;
      tx.set(fresh.ref, result.workflow);
      tx.create(eventRef, {
        ...result.event,
        expiresAt: Date.now() + 30 * 86_400_000,
      });
    });
  }
}

async function deliverQueued(eventId?: string) {
  const docs = eventId
    ? [await events().doc(eventId).get()]
    : (await events().where("pending", "==", true).limit(40).get()).docs;
  const candidates = docs
    .filter((doc) => doc.exists)
    .flatMap((doc) =>
      Object.entries((doc.data() as AlertEvent).deliveries)
        .filter(([, d]) => due(d, Date.now()))
        .map(([channel]) => ({ ref: doc.ref, channel: channel as Channel })),
    )
    .slice(0, 6);
  if (!candidates.length) return;
  const config = await providerConfig();
  await Promise.all(
    candidates.map(async ({ ref, channel }) => {
      const attemptId = randomUUID();
      const claim = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const event = snap.data() as AlertEvent;
        const delivery = event?.deliveries[channel];
        if (!delivery || !due(delivery, Date.now())) return null;
        if (event.side !== "created") {
          const w = await tx.get(workflows().doc(event.workflowId));
          if (w.data()?.mode === "single") {
            if (w.data()?.paused) {
              const deliveries = {
                ...event.deliveries,
                [channel]: {
                  ...delivery,
                  status: "cancelled" as const,
                  leaseUntil: 0,
                },
              };
              tx.update(ref, { deliveries, pending: pending(deliveries) });
              return null;
            }
            if (!w.data()?.confirmationSent) return null;
          }
        }
        if (delivery.attempts >= 5) {
          const deliveries = {
            ...event.deliveries,
            [channel]: {
              ...delivery,
              status: "failed" as const,
              leaseUntil: 0,
              error: "Delivery could not be confirmed after five attempts.",
            },
          };
          tx.update(ref, { deliveries, pending: pending(deliveries) });
          return null;
        }
        const next = {
          ...delivery,
          status: "sending" as const,
          attempts: delivery.attempts + 1,
          leaseUntil: Date.now() + 90_000,
          attemptId,
        };
        tx.update(ref, { [`deliveries.${channel}`]: next });
        return { event, delivery: next };
      });
      if (!claim) return;
      let result;
      try {
        await send(
          channel,
          `${ref.id}-${channel}`,
          claim.event.message,
          config,
        );
        result = {
          ...claim.delivery,
          status: "sent" as const,
          leaseUntil: 0,
          error: null,
          sentAt: Date.now(),
        };
      } catch (e) {
        result = failedAttempt(
          claim.delivery,
          errorText(e),
          Date.now(),
          e instanceof ProviderError ? e.retryAfter : 0,
        );
      }
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.data()?.deliveries?.[channel]?.attemptId !== attemptId) return;
        const workflowRef = workflows().doc(claim.event.workflowId);
        const workflow =
          claim.event.side === "created" && result.status === "sent"
            ? await tx.get(workflowRef)
            : null;
        const deliveries = {
          ...(snap.data() as AlertEvent).deliveries,
          [channel]: result,
        };
        tx.update(ref, { deliveries, pending: pending(deliveries) });
        if (workflow?.exists)
          tx.update(workflowRef, { confirmationSent: true });
      });
    }),
  );
}

export const pollBazaar = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "UTC",
    secrets,
    retryCount: 0,
    maxInstances: 1,
  },
  async () => {
    const token = randomUUID(),
      now = Date.now();
    const acquired = await db.runTransaction(async (tx) => {
      const lease = await tx.get(leaseRef);
      if ((lease.data()?.until ?? 0) > now) return false;
      tx.set(leaseRef, { token, until: now + 90_000 });
      return true;
    });
    if (!acquired) return;
    try {
      const settings = {
        ...DEFAULT_SETTINGS,
        ...(await settingsRef().get()).data(),
      };
      if (!settings.monitoringPaused) {
        try {
          await refreshMarket(token);
        } catch (e) {
          await db
            .doc("market/status")
            .set({ lastAttempt: now, error: errorText(e) }, { merge: true });
          logger.warn("Market refresh failed", { reason: errorText(e) });
        }
      }
      await deliverQueued();
      const maintenance = db.doc("system/maintenance");
      const previous = await maintenance.get();
      if (now - (previous.data()?.lastCleanup ?? 0) > 86_400_000) {
        const expired = await events()
          .where("expiresAt", "<", now)
          .limit(400)
          .get();
        const batch = db.batch();
        expired.docs.forEach((d) => batch.delete(d.ref));
        batch.set(maintenance, { lastCleanup: expired.size === 400 ? 0 : now });
        await batch.commit();
      }
    } catch (e) {
      logger.error("Polling or delivery failed", { reason: errorText(e) });
      await db
        .doc("market/status")
        .set({ error: errorText(e) }, { merge: true });
    } finally {
      await db.runTransaction(async (tx) => {
        const lease = await tx.get(leaseRef);
        if (lease.data()?.token === token) tx.delete(leaseRef);
      });
    }
  },
);

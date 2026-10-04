import {
  blankCrossing,
  eligibleSample,
  evaluateNotification,
  validateNotification,
  type CrossingState,
  type HoldingNotification,
  type NotificationInput,
} from "../shared/companion/notifications";
import {
  validId,
  validPortfolio,
  validPortfolioHolding,
  valueHolding,
  type Holding,
  type Portfolio,
} from "../shared/companion/portfolio";
import { PORTFOLIO_EVALUATION_ENABLED } from "../shared/companion/portfolio-policy";
import type { BazaarItem, Listing } from "../shared/companion/types";
import { deliver, emptyState, type Mail, type State } from "./core";
import {
  checkAdmission,
  commit,
  DOCUMENT,
  fetchJson,
  firestore,
  jsonWrite,
  loadControl,
  loadUser,
  readDoc,
} from "./store";
import { sharedMarket } from "./companion";
import { AUCTION_COLLECTION_ENABLED } from '../shared/market-features';
declare const PropertiesService: any, ScriptApp: any, MailApp: any;

export const decodeFields = (fields: Record<string, any>): any =>
  Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [
      k,
      "stringValue" in v
        ? v.stringValue
        : "integerValue" in v
          ? Number(v.integerValue)
          : "doubleValue" in v
            ? v.doubleValue
            : "booleanValue" in v
              ? v.booleanValue
              : "nullValue" in v
                ? null
                : "mapValue" in v
                  ? decodeFields(v.mapValue.fields ?? {})
                  : v.arrayValue?.values?.map(
                      (x: any) => decodeFields({ x }).x,
                    ),
    ]),
  );
const encode = (v: any): any =>
  v === null
    ? { nullValue: null }
    : typeof v === "string"
      ? { stringValue: v }
      : typeof v === "boolean"
        ? { booleanValue: v }
        : typeof v === "number"
          ? Number.isSafeInteger(v)
            ? { integerValue: String(v) }
            : { doubleValue: v }
          : Array.isArray(v)
            ? { arrayValue: { values: v.map(encode) } }
            : {
                mapValue: {
                  fields: Object.fromEntries(
                    Object.entries(v).map(([k, x]) => [k, encode(x)]),
                  ),
                },
              };
const write = (path: string, value: unknown, version: string | null) => ({
  update: {
    name: `${DOCUMENT}/${path}`,
    fields: encode(value).mapValue.fields,
  },
  currentDocument: version ? { updateTime: version } : { exists: false },
});
const verify = (document: any) => ({
  verify: document.name,
  currentDocument: { updateTime: document.updateTime },
});
function read(path: string, readDocument = readDoc) {
  const document = readDocument(path);
  return {
    document,
    data: document ? decodeFields(document.fields ?? {}) : null,
  };
}
function notificationPath(uid: string, id: string) {
  return `users/${uid}/portfolioNotifications/${id}`;
}
function holdingPath(uid: string, pid: string, hid: string) {
  return `users/${uid}/portfolios/${pid}/holdings/${hid}`;
}
export function notificationKey(portfolioId: string, holdingId: string) {
  if (
    !validId(portfolioId) ||
    typeof holdingId !== "string" ||
    !/^(?:bz_[A-Za-z0-9_:-]{1,100}|v1_[a-f0-9]{64})$/.test(holdingId)
  )
    throw new Error("Invalid holding reference.");
  return `${portfolioId}__${holdingId}`;
}
function listNotifications(
  uid: string,
  query = firestore,
): HoldingNotification[] {
  const result = query(
    `/${`users/${uid}/portfolioNotifications`}?pageSize=101`,
  );
  if (result.nextPageToken || (result.documents?.length ?? 0) > 100)
    throw new Error("Notification storage limit reached.");
  return (result.documents ?? []).map((d: any) => decodeFields(d.fields));
}
interface Ledger {
  state: State;
  crossings: Record<string, CrossingState>;
}
function loadLedger(uid: string, readDocument = readDoc) {
  const d = readDocument(`portfolioDelivery/${uid}`);
  return {
    value: d
      ? (JSON.parse(d.fields.json.stringValue) as Ledger)
      : { state: emptyState(uid), crossings: {} },
    version: d?.updateTime ?? null,
  };
}
export interface PriceEvidence {
  bazaar: BazaarItem[];
  listings: Listing[];
  fixture?: boolean;
}
const evidence = (assets: string[] = []): PriceEvidence => {
  if (!PORTFOLIO_EVALUATION_ENABLED)
    throw new Error(
      "Market data: Portfolio evaluation is paused; a fresh sample cannot be captured.",
    );
  const enabledAssets = assets.filter(id => !id.startsWith('v1_') || AUCTION_COLLECTION_ENABLED);
  if (!enabledAssets.length) return { bazaar: [], listings: [] };
  return sharedMarket(
    `portfolio-prices?assets=${encodeURIComponent([...new Set(enabledAssets)].sort().join(","))}`,
  );
};
function cancelPending(ledger: Ledger, id: string) {
  for (const mail of ledger.state.mail)
    if (
      mail.portfolio?.notificationId === id &&
      !["sent", "failed", "cancelled"].includes(mail.status)
    ) {
      mail.status = "cancelled";
      mail.leaseUntil = 0;
    }
}
/** Called only after verifyIdentity and under the existing script-wide lock. */
export interface NotificationPersistence {
  readDoc: typeof readDoc;
  firestore: typeof firestore;
  loadUser: typeof loadUser;
  loadControl: typeof loadControl;
  commit: typeof commit;
}
export function portfolioNotificationRequest(
  identity: { uid: string; email: string },
  request: any,
  now = Date.now(),
  readPrices = evidence,
  persistence: NotificationPersistence = {
    readDoc,
    firestore,
    loadUser,
    loadControl,
    commit,
  },
): HoldingNotification {
  const readSaved = (path: string) => read(path, persistence.readDoc);
  const { uid } = identity,
    id = notificationKey(request.portfolioId, request.holdingId),
    path = notificationPath(uid, id),
    saved = readSaved(path),
    current = saved.data as HoldingNotification | null;
  if (
    !Number.isSafeInteger(request.revision) ||
    request.revision < 0 ||
    !["save", "pause", "resume", "delete"].includes(request.operation)
  )
    throw new Error("Invalid notification operation.");
  if ((current?.revision ?? 0) !== request.revision)
    throw new Error("Notification changed elsewhere. Reload saved data.");
  const p = readSaved(`users/${uid}/portfolios/${request.portfolioId}`),
    h = readSaved(holdingPath(uid, request.portfolioId, request.holdingId));
  const removing =
    request.operation === "delete" || request.operation === "pause";
  if (
    !removing &&
    (!validPortfolio(p.data) ||
      p.data.deleted ||
      !validPortfolioHolding(h.data) ||
      h.data.deleted ||
      h.data.id !== request.holdingId)
  )
    throw new Error("Invalid or deleted portfolio holding.");
  if (request.operation !== "save" && !current)
    throw new Error("Invalid notification.");
  const input: NotificationInput =
    request.operation === "save" ? request.input : current!;
  validateNotification(input);
  const all = listNotifications(uid, persistence.firestore),
    legacy = persistence.loadUser(uid),
    control = persistence.loadControl();
  const enabled =
    request.operation === "save" || request.operation === "resume";
  if (
    enabled &&
    all.filter((n) => !n.deleted && n.enabled && n.id !== id).length +
      legacy.state.alerts.filter(
        (a) => !a.workflow.paused && a.workflow.stage !== "completed",
      ).length >=
      20
  )
    throw new Error(
      "You can have at most 20 active alerts across legacy and portfolio notifications.",
    );
  if (!current && all.length + legacy.state.alerts.length >= 100)
    throw new Error("The 100 stored-alert limit for your account is reached.");
  if (!current) {
    const admission = {
      ...legacy.state,
      alerts: [
        ...legacy.state.alerts,
        ...all.map(
          (n) => ({ test: false, workflow: { createdAt: n.createdAt } }) as any,
        ),
      ],
    };
    checkAdmission(control.state, admission, now);
    control.state.admissions++;
  }
  const source =
    h.data?.kind === "auction"
      ? "auction-exact-lowest-ask-v1"
      : "bazaar-bid-v1";
  let capturedPrice = current?.capturedPrice ?? null,
    capturedAt = current?.capturedAt ?? null;
  if (enabled && input.baseline === "sample") {
    const prices = readPrices([h.data.id]),
      value = valueHolding(h.data, prices.bazaar, prices.listings, now);
    if (!eligibleSample(value, now, prices.fixture))
      throw new Error(
        "Wait for a fresh valid price sample to enable this baseline.",
      );
    // Resume preserves the original fixed baseline, but requires valid same-source evidence.
    if (request.operation === "save") {
      capturedPrice = value.referencePrice;
      capturedAt = value.sampledAt;
    }
    if (request.operation === "resume" && current?.source !== value.source)
      throw new Error(
        "Notification valuation source changed. Edit and enable again.",
      );
  }
  const next: HoldingNotification = {
    id,
    portfolioId: request.portfolioId,
    holdingId: request.holdingId,
    holdingName: h.data?.name ?? current!.holdingName,
    baseline: input.baseline,
    up: input.up,
    down: input.down,
    enabled,
    deleted: request.operation === "delete",
    capturedPrice: input.baseline === "sample" ? capturedPrice : null,
    capturedAt: input.baseline === "sample" ? capturedAt : null,
    source: removing ? current!.source : source,
    revision: (current?.revision ?? 0) + 1,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  const ledger = loadLedger(uid, persistence.readDoc);
  cancelPending(ledger.value, id);
  ledger.value.crossings[id] = {
    ...blankCrossing(),
    sequence: ledger.value.crossings[id]?.sequence ?? 0,
  };
  const subscriber = persistence.readDoc(`portfolioSubscribers/${uid}`);
  persistence.commit([
    write(path, next, saved.document?.updateTime ?? null),
    jsonWrite(`portfolioDelivery/${uid}`, ledger.value, ledger.version),
    write(
      `portfolioSubscribers/${uid}`,
      { active: true },
      subscriber?.updateTime ?? null,
    ),
    ...(p.document ? [verify(p.document)] : []),
    ...(h.document ? [verify(h.document)] : []),
    ...(!current
      ? [jsonWrite("backend/worker", control.state, control.version)]
      : []),
  ]);
  return next;
}
function verifiedRecipient(uid: string): string | null {
  const result = fetchJson(
    "https://identitytoolkit.googleapis.com/v1/projects/bazaarsignal/accounts:lookup",
    {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
      payload: JSON.stringify({ localId: [uid] }),
    },
  );
  const u = result.users?.[0];
  return result.users?.length === 1 &&
    u.localId === uid &&
    !u.disabled &&
    u.emailVerified === true &&
    typeof u.email === "string" &&
    u.providerUserInfo?.some((p: any) => p.providerId === "google.com")
    ? u.email
    : null;
}
export function queueCrossings(
  ledger: Ledger,
  n: HoldingNotification,
  h: Holding,
  p: Portfolio,
  prices: PriceEvidence,
  now: number,
  emailEnabled: boolean,
) {
  // Bound pending and retained deliveries; never advance a crossing without room for its event.
  // Each event includes both delivery and workflow records; leave ample space
  // below Firestore's document limit even with maximum-length names and IDs.
  if (ledger.state.mail.length >= 250) return;
  const value = valueHolding(h, prices.bazaar, prices.listings, now);
  const result = evaluateNotification(
    n,
    h,
    value,
    ledger.crossings[n.id] ?? blankCrossing(),
    now,
    { fixture: prices.fixture, portfolioDeleted: p.deleted, emailEnabled },
  );
  ledger.crossings[n.id] = result.state;
  for (const event of result.events) {
    if (ledger.state.mail.some((m) => m.id === event.id)) continue;
    ledger.state.alerts.push({
      recipient: "",
      tokenHash: "",
      fingerprint: event.id,
      test: false,
      workflow: {
        id: event.id,
        itemId: h.itemId,
        itemName: h.name,
        quantity: h.quantity,
        buyTarget: 0,
        sellTarget: 0,
        stage: "completed",
        paused: false,
        channels: ["email"],
        generation: 0,
        revision: 0,
        purchaseCost: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    ledger.state.mail.push({
      id: event.id,
      alertId: event.id,
      kind: "portfolio",
      status: "queued",
      attempts: 0,
      nextAttempt: now,
      leaseUntil: 0,
      error: null,
      portfolio: {
        notificationId: n.id,
        revision: n.revision,
        holdingRevision: h.revision,
        direction: event.direction,
        percent: event.percent,
        baseline: event.baseline,
        price: event.price,
        sampledAt: event.sampledAt,
        source: event.source,
        portfolioId: n.portfolioId,
        holdingId: n.holdingId,
      },
    });
  }
}
export function portfolioMailText(mail: Mail, name: string) {
  const e = mail.portfolio!;
  return {
    subject: `BazaarSignal: ${name} crossed ${e.direction === "up" ? "an upward" : "a downward"} threshold`,
    body: [
      `${name}: ${e.percent.toFixed(2)}% from your ${e.baseline} coin baseline.`,
      `Reference price: ${e.price} coins per recorded unit.`,
      `Sample: ${new Date(e.sampledAt).toISOString()}. Source: ${e.source}.`,
      "",
      "Bazaar references are before fees and slippage. Auction references are exact-variant asking prices, not completed sales or guaranteed proceeds.",
      "This threshold rearms after a fresh price moves back inside it. Manage or pause it in Notifications.",
      "https://bazaarsignal.web.app/#view=notifications",
      "",
      "Polling can miss brief movements. MailApp acceptance does not guarantee inbox delivery.",
    ].join("\n"),
  };
}
/** Bounded shared worker; disabled before ANY I/O in the portfolio release. */
export function runPortfolioNotifications(
  started: number,
  enabled = PORTFOLIO_EVALUATION_ENABLED,
) {
  if (!enabled) return { paused: true };
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("MARKET_UPDATES_PAUSED") !== "false")
    return { paused: true };
  const cursor = props.getProperty("PORTFOLIO_CURSOR") ?? "";
  const query: any = {
    from: [{ collectionId: "portfolioSubscribers" }],
    where: {
      fieldFilter: {
        field: { fieldPath: "active" },
        op: "EQUAL",
        value: { booleanValue: true },
      },
    },
    orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
    limit: 5,
    ...(cursor
      ? {
          startAt: {
            values: [
              { referenceValue: `${DOCUMENT}/portfolioSubscribers/${cursor}` },
            ],
            before: false,
          },
        }
      : {}),
  };
  const users = firestore(":runQuery", "post", { structuredQuery: query })
    .filter((r: any) => r.document)
    .map((r: any) => r.document.name.split("/").pop());
  if (!users.length) {
    props.setProperty("PORTFOLIO_CURSOR", "");
    return { processed: 0 };
  }
  let prices: PriceEvidence | null = null;
  const configurations = new Map<string, HoldingNotification[]>();
  for (const uid of users) {
    try {
      configurations.set(uid, listNotifications(uid));
    } catch {
      /* Account failure does not block peers. */
    }
  }
  const assets = [
    ...new Set(
      [...configurations.values()]
        .flat()
        .filter((n) => n.enabled && !n.deleted)
        .map((n) => n.holdingId),
    ),
  ];
  // One required shared snapshot bundle per bounded worker tick; never per user/holding.
  try {
    if (assets.length) prices = evidence(assets);
  } catch {
    /* Missing data must prime the next valid observation. */
  }
  let processed = 0;
  for (const uid of users) {
    if (Date.now() - started > 40000) break;
    try {
      const notifications = configurations.get(uid);
      if (!notifications) continue;
      const ledger = loadLedger(uid),
        prefs = read(`users/${uid}/portfolioPreferences/main`),
        emailEnabled = prefs.data?.emailEnabled === true;
      const preconditions: any[] = [];
      for (const n of notifications) {
        const p = read(`users/${uid}/portfolios/${n.portfolioId}`),
          h = read(holdingPath(uid, n.portfolioId, n.holdingId));
        if (p.document) preconditions.push(verify(p.document));
        if (h.document) preconditions.push(verify(h.document));
        if (
          !emailEnabled ||
          !n.enabled ||
          n.deleted ||
          !validPortfolio(p.data) ||
          p.data.deleted ||
          !validPortfolioHolding(h.data) ||
          h.data.deleted
        ) {
          cancelPending(ledger.value, n.id);
          ledger.value.crossings[n.id] = {
            ...(ledger.value.crossings[n.id] ?? blankCrossing()),
            prime: true,
          };
          continue;
        }
        if (prices)
          queueCrossings(
            ledger.value,
            n,
            h.data,
            p.data,
            prices,
            Date.now(),
            emailEnabled,
          );
        else
          ledger.value.crossings[n.id] = {
            ...(ledger.value.crossings[n.id] ?? blankCrossing()),
            prime: true,
          };
        for (const mail of ledger.value.state.mail)
          if (
            mail.portfolio?.notificationId === n.id &&
            (mail.portfolio.revision !== n.revision ||
              (n.baseline === "acquisition" &&
                mail.portfolio.holdingRevision !== h.data.revision))
          ) {
            if (!["sent", "failed", "cancelled"].includes(mail.status))
              mail.status = "cancelled";
          }
      }
      if (prefs.document) preconditions.push(verify(prefs.document));
      const save = () => {
        const result = commit([
          jsonWrite(`portfolioDelivery/${uid}`, ledger.value, ledger.version),
        ]);
        ledger.version = result.writeResults[0].updateTime;
      };
      const result = commit([
        jsonWrite(`portfolioDelivery/${uid}`, ledger.value, ledger.version),
        ...Array.from(
          new Map(preconditions.map((w) => [w.verify, w])).values(),
        ),
      ]);
      ledger.version = result.writeResults[0].updateTime;
      const prefix = `portfolio-sent:${uid}:`;
      deliver(ledger.value.state, {
        now: Date.now,
        quota: () => MailApp.getRemainingDailyQuota(),
        save,
        budgetExpired: () => Date.now() - started > 45000,
        receipt: (id) => Number(props.getProperty(prefix + id)) || null,
        remember: (id, at) => props.setProperty(prefix + id, String(at)),
        forget: (id) => props.deleteProperty(prefix + id),
        send: (mail, alert) => {
          const e = mail.portfolio!,
            n = read(notificationPath(uid, e.notificationId)).data,
            p = read(`users/${uid}/portfolios/${e.portfolioId}`).data,
            h = read(holdingPath(uid, e.portfolioId, e.holdingId)).data;
          // Recheck all cancellation boundaries immediately before the irreversible send.
          if (
            !n ||
            n.deleted ||
            !n.enabled ||
            n.revision !== e.revision ||
            !p ||
            p.deleted ||
            !h ||
            h.deleted ||
            (n.baseline === "acquisition" &&
              h.revision !== e.holdingRevision) ||
            read(`users/${uid}/portfolioPreferences/main`).data
              ?.emailEnabled !== true
          )
            throw new Error("Delivery no longer eligible.");
          const recipient = verifiedRecipient(uid);
          if (!recipient) throw new Error("Verified identity unavailable.");
          MailApp.sendEmail({
            to: recipient,
            ...portfolioMailText(mail, alert.workflow.itemName),
            name: "BazaarSignal",
          });
        },
      });
      // Completed events can expire; monotonically increasing crossing sequences retain deduplication.
      const keep = new Set(
        ledger.value.state.mail
          .filter(
            (m) =>
              !["sent", "failed", "cancelled"].includes(m.status) ||
              (m.sentAt ?? m.nextAttempt) > Date.now() - 30 * 86400000,
          )
          .map((m) => m.alertId),
      );
      ledger.value.state.mail = ledger.value.state.mail.filter((m) =>
        keep.has(m.alertId),
      );
      ledger.value.state.alerts = ledger.value.state.alerts.filter((a) =>
        keep.has(a.workflow.id),
      );
      save();
      processed++;
    } catch {
      /* Isolate account failures; existing CAS versions make retries safe. */
    }
    props.setProperty("PORTFOLIO_CURSOR", uid);
  }
  return { processed };
}

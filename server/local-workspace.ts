import type { IncomingMessage, ServerResponse } from "node:http";
import { createLocalUsageReport } from "./local-usage";
import { emptyState, publicState } from "../apps-script/core";
import { DOCUMENT } from "../apps-script/store";
import {
  notificationKey,
  portfolioNotificationRequest,
  type NotificationPersistence,
} from "../apps-script/portfolio-backend";
import { authorizedOwner } from "../collector/usage-dashboard";
import { verifiedUsageSnapshot } from "../shared/usage-dashboard";

// No configurable host: every storage operation in this adapter is loopback-only.
const emulator = `http://127.0.0.1:8080/v1/${DOCUMENT}`;
type Identity = { uid: string; email: string; claims: any };
export async function verifyLocalIdentity(
  token: unknown,
  apiKey: string,
): Promise<Identity> {
  if (typeof token !== "string" || !/^[A-Za-z0-9._-]{20,12000}$/.test(token))
    throw new Error("Sign in again with Google.");
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) throw new Error("Sign in again with Google.");
  const result = await response.json(),
    u = result.users?.[0];
  const claims = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString(),
  );
  const now = Date.now() / 1000;
  if (
    result.users?.length !== 1 ||
    !u ||
    u.disabled ||
    u.emailVerified !== true ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(u.localId) ||
    claims.sub !== u.localId ||
    claims.aud !== "bazaarsignal" ||
    claims.iss !== "https://securetoken.google.com/bazaarsignal" ||
    claims.email_verified !== true ||
    claims.email?.toLowerCase() !== u.email?.toLowerCase() ||
    claims.firebase?.sign_in_provider !== "google.com" ||
    !u.providerUserInfo?.some((p: any) => p.providerId === "google.com") ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= now ||
    !Number.isFinite(claims.iat) ||
    claims.iat > now + 30 ||
    !Number.isFinite(claims.auth_time) ||
    claims.auth_time > now + 30 ||
    (u.validSince && claims.auth_time < Number(u.validSince))
  )
    throw new Error("Use your verified Google account.");
  return {
    uid: u.localId,
    email: u.email.toLowerCase(),
    claims: { ...claims, uid: u.localId },
  };
}
export async function localFirestore(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<any> {
  if (!path.startsWith("/") && path !== ":commit")
    throw new Error("Invalid local storage request.");
  const response = await fetch(emulator + path, {
    method,
    headers: {
      Authorization: "Bearer owner",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(
      response.status === 409 || response.status === 400
        ? "Saved data changed elsewhere. Reload and try again."
        : "Local storage is unavailable. Start the app with npm run dev:local.",
    );
  return response.json();
}
// Serialize local mutations as Apps Script does, then commit with the same CAS
// preconditions. Browser holding edits still race safely against these reads.
export function localNotificationService(network = localFirestore) {
  let pending = Promise.resolve();
  return (identity: Identity, request: any) => {
    const work = pending.then(async () => {
      const { uid } = identity,
        id = notificationKey(request.portfolioId, request.holdingId);
      const paths = [
        `users/${uid}/portfolioNotifications/${id}`,
        `users/${uid}/portfolios/${request.portfolioId}`,
        `users/${uid}/portfolios/${request.portfolioId}/holdings/${request.holdingId}`,
        `portfolioDelivery/${uid}`,
        `portfolioSubscribers/${uid}`,
        `backendUsers/${uid}`,
        "backend/worker",
      ];
      const docs = new Map(
        await Promise.all(
          paths.map(async (p) => [p, await network(`/${p}`)] as const),
        ),
      );
      const notifications =
        (await network(`/users/${uid}/portfolioNotifications?pageSize=101`)) ??
        {};
      let writes: any[] | null = null;
      const existing = docs.get(`backendUsers/${uid}`),
        control = docs.get("backend/worker"),
        now = Date.now();
      const persistence: NotificationPersistence = {
        readDoc: (path) => {
          if (!docs.has(path))
            throw new Error("Unexpected local document read.");
          return docs.get(path);
        },
        firestore: (path) => {
          if (path !== `/users/${uid}/portfolioNotifications?pageSize=101`)
            throw new Error("Unexpected local query.");
          return notifications;
        },
        loadUser: (owner) => {
          if (owner !== uid) throw new Error("Invalid local owner.");
          const state = existing
            ? JSON.parse(existing.fields.json.stringValue)
            : emptyState(uid);
          if (state.ownerUid !== uid) throw new Error("Invalid saved account.");
          return {
            state,
            version: existing?.updateTime ?? null,
            legacy: false,
          };
        },
        loadControl: () => ({
          state: control
            ? JSON.parse(control.fields.json.stringValue)
            : {
                monitor: emptyState("").monitor,
                cursor: "",
                runtimeWindow: now,
                runtimeMs: 0,
                admissionWindow: now,
                admissions: 0,
              },
          version: control?.updateTime ?? null,
        }),
        commit: (batch) => {
          if (writes) throw new Error("Unexpected second commit.");
          writes = batch;
          return {};
        },
      };
      const result = portfolioNotificationRequest(
        identity,
        request,
        now,
        undefined,
        persistence,
      );
      if (!writes) throw new Error("Missing local mutation.");
      await network(":commit", "POST", { writes });
      return result;
    });
    pending = work.then(
      () => {},
      () => {},
    );
    return work;
  };
}
export function localWorkspaceHandler(
  apiKey: string,
  options: {
    verify?: (token: unknown) => Promise<Identity>;
    storage?: typeof localFirestore;
    report?: () => Promise<any>;
  } = {},
) {
  const verify =
    options.verify ?? ((token) => verifyLocalIdentity(token, apiKey));
  const storage = options.storage ?? localFirestore;
  const mutate = localNotificationService(storage);
  const usageReport = options.report ?? createLocalUsageReport();
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!["/api/local/account", "/api/owner/usage"].includes(path))
      return next();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status: number, value: unknown) => {
      res.writeHead(status);
      res.end(JSON.stringify(value));
    };
    if (
      !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? "") ||
      (req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}`) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return send(403, { ok: false, error: "Local requests only." });
    if (req.method !== (path === "/api/owner/usage" ? "GET" : "POST"))
      return send(405, { ok: false, error: "Method not allowed." });
    let identity: Identity,
      request: any = {};
    try {
      if (req.method === "POST") {
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 20000) throw new Error("Request too large.");
        }
        request = JSON.parse(body);
      }
      identity = await verify(
        path === "/api/owner/usage"
          ? req.headers.authorization?.replace(/^Bearer /, "")
          : request.idToken,
      );
    } catch {
      return send(401, {
        ok: false,
        error: "Sign in again with your verified Google account.",
      });
    }
    try {
      if (path === "/api/owner/usage") {
        if (!authorizedOwner(identity.claims, Date.now()))
          return send(403, { error: "Owner access required." });
        const report = await usageReport();
        return send(200, {
          ...verifiedUsageSnapshot(report),
          stale: !!report.stale || Date.now() >= report.nextMeasurementAt,
        });
      }
      if (request.action === "portfolio-notification")
        return send(200, { ok: true, data: await mutate(identity, request) });
      if (request.action === "account") {
        const saved = await storage(`/backendUsers/${identity.uid}`);
        const state = saved
          ? JSON.parse(saved.fields.json.stringValue)
          : emptyState(identity.uid);
        if (state.ownerUid !== identity.uid)
          throw new Error("Invalid saved account.");
        return send(200, { ok: true, data: publicState(state) });
      }
      return send(400, {
        ok: false,
        error:
          "This action is unavailable in the local workspace. No production alerts are changed here.",
      });
    } catch (e) {
      return send(503, {
        ok: false,
        error:
          path === "/api/owner/usage"
            ? "Cloud measurements are unavailable. Refresh is limited to one measurement attempt every 30 minutes; collection remains paused."
            : e instanceof Error
              ? e.message
              : "Local service unavailable.",
      });
    }
  };
}

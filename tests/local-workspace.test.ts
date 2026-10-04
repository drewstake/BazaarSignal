import { afterEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import {
  localNotificationService,
  localWorkspaceHandler,
  localFirestore,
  verifyLocalIdentity,
} from "../server/local-workspace";
import { ADMIN_UID, DOCUMENT } from "../apps-script/store";
import { legacyHolding } from "../shared/companion/portfolio";
const now = Date.now();
const claims = {
  sub: ADMIN_UID,
  email: "drewstake3@gmail.com",
  email_verified: true,
  aud: "bazaarsignal",
  iss: "https://securetoken.google.com/bazaarsignal",
  firebase: { sign_in_provider: "google.com" },
  iat: now / 1000 - 60,
  auth_time: now / 1000 - 60,
  exp: now / 1000 + 3600,
};
const identity = { uid: ADMIN_UID, email: claims.email, claims };
const token = `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
afterEach(() => vi.unstubAllGlobals());
it("validates the real Google token with Firebase before accepting decoded claims", async () => {
  const lookup = vi.fn(async () =>
    Response.json({
      users: [
        {
          localId: ADMIN_UID,
          email: claims.email,
          emailVerified: true,
          providerUserInfo: [{ providerId: "google.com" }],
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", lookup);
  expect(await verifyLocalIdentity(token, "public-key")).toMatchObject({
    uid: ADMIN_UID,
  });
  expect(lookup.mock.calls[0][0]).toContain(
    "identitytoolkit.googleapis.com/v1/accounts:lookup",
  );
  lookup.mockImplementation(
    async () => new Response("denied", { status: 401 }),
  );
  await expect(verifyLocalIdentity(token, "public-key")).rejects.toThrow(
    "Sign in",
  );
});
it("pins admin storage calls to the loopback emulator and never follows redirects", async () => {
  const network = vi.fn(async () => Response.json({}));
  vi.stubGlobal("fetch", network);
  await localFirestore("/users/test/portfolios");
  expect(network.mock.calls[0][0]).toBe(
    `http://127.0.0.1:8080/v1/${DOCUMENT}/users/test/portfolios`,
  );
  expect(network.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  await expect(
    localFirestore("https://firestore.googleapis.com/anything"),
  ).rejects.toThrow();
});
const encode = (v: any): any =>
  v === null
    ? { nullValue: null }
    : typeof v === "string"
      ? { stringValue: v }
      : typeof v === "number"
        ? { integerValue: String(v) }
        : { booleanValue: v };
it("uses the production notification validator, saves atomically, and rejects stale and foreign holdings", async () => {
  const docs = new Map<string, any>();
  let version = 0;
  const seed = (path: string, data: any) =>
    docs.set(path, {
      name: `${DOCUMENT}/${path}`,
      fields: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, encode(v)]),
      ),
      updateTime: String(++version),
    });
  const uid = "local-test",
    pid = "portfolio",
    hid = "bz_DIAMOND";
  seed(`users/${uid}/portfolios/${pid}`, {
    id: pid,
    name: "Local",
    createdAt: now,
    updatedAt: now,
    revision: 1,
    deleted: false,
  });
  seed(
    `users/${uid}/portfolios/${pid}/holdings/${hid}`,
    legacyHolding({
      itemId: "DIAMOND",
      name: "Diamond",
      quantity: 5,
      costBasis: 100,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    }),
  );
  const network = vi.fn(
    async (path: string, method?: string, payload?: any): Promise<any> => {
      if (path === ":commit") {
        expect(method).toBe("POST");
        for (const w of payload.writes) {
          const key = (w.verify ?? w.update.name).split("/documents/")[1],
            old = docs.get(key);
          if (
            (w.currentDocument.exists === false && old) ||
            (w.currentDocument.updateTime &&
              old?.updateTime !== w.currentDocument.updateTime)
          )
            throw new Error("CAS conflict");
        }
        for (const w of payload.writes)
          if (w.update)
            docs.set(w.update.name.split("/documents/")[1], {
              ...w.update,
              updateTime: String(++version),
            });
        return {};
      }
      if (path.includes("?pageSize"))
        return {
          documents: [...docs]
            .filter(([p]) =>
              p.startsWith(`users/${uid}/portfolioNotifications/`),
            )
            .map(([, d]) => d),
        };
      return docs.get(path.slice(1)) ?? null;
    },
  );
  const mutate = localNotificationService(network),
    request = {
      portfolioId: pid,
      holdingId: hid,
      operation: "save",
      revision: 0,
      input: { baseline: "acquisition", up: 10, down: null },
    };
  const local = { ...identity, uid };
  await expect(
    mutate({ ...local, uid: "someone-else" }, request),
  ).rejects.toThrow("Invalid or deleted");
  expect(await mutate(local, request)).toMatchObject({
    enabled: true,
    revision: 1,
  });
  expect(
    JSON.parse(docs.get(`portfolioDelivery/${uid}`).fields.json.stringValue)
      .state.mail,
  ).toEqual([]);
  await expect(mutate(local, request)).rejects.toThrow("changed elsewhere");
  expect(
    await mutate(local, { ...request, operation: "pause", revision: 1 }),
  ).toMatchObject({ enabled: false, revision: 2 });
  await expect(
    mutate(local, {
      ...request,
      revision: 2,
      input: { ...request.input, baseline: "sample" },
    }),
  ).rejects.toThrow("paused");
});
it("rejects foreign origins and unauthenticated access, and labels owner cached reports as stale", async () => {
  const verify = vi.fn(async (value: unknown) => {
    if (value !== "valid") throw new Error("unauthenticated");
    return identity;
  });
  const handler = localWorkspaceHandler("unused", {
    verify,
    report: async () => ({
      generatedAt: now - 86400000,
      nextMeasurementAt: now - 84000000,
      rows: [],
      collection: {},
      spending: {},
    }),
  });
  const server = createServer((req, res) => {
    void handler(req, res, () => res.writeHead(404).end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as any).port}/api/owner/usage`;
    expect(
      (
        await fetch(url, {
          headers: {
            Origin: "https://foreign.example",
            Authorization: "Bearer valid",
          },
        })
      ).status,
    ).toBe(403);
    expect(verify).not.toHaveBeenCalled();
    expect((await fetch(url)).status).toBe(401);
    const result = await fetch(url, {
      headers: { Authorization: "Bearer valid" },
    });
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.stale).toBe(true);
    expect(body.generatedAt).toBe(now - 86400000);
    expect(body.localReport).toContain("not a live");
    verify.mockResolvedValue({
      ...identity,
      uid: "someone-else",
      claims: { ...claims, sub: "someone-else", email: "other@example.test" },
    });
    expect(
      (await fetch(url, { headers: { Authorization: "Bearer valid" } })).status,
    ).toBe(403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const now = Date.parse("2026-10-15T15:03:00Z");
const usage = {
  mode: "normal",
  pollMs: 3600000,
  trialId: "audit",
  expiresAt: now + 86400000,
};
const url =
  "https://market.example/api/companion/portfolio-prices?assets=bz_BOOSTER_COOKIE";
const item = {
  id: "BOOSTER_COOKIE",
  asks: [],
  bids: [],
  upstreamAt: now,
  observedAt: now,
};
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  vi.stubEnv("VITE_MARKET_OPERATING_MODE", "paid-budget");
  vi.stubEnv("VITE_MARKET_UPDATES_PAUSED", "false");
  vi.stubEnv("VITE_MARKET_TRIAL_ID", "audit");
  vi.stubEnv("VITE_MARKET_TRIAL_END", new Date(usage.expiresAt).toISOString());
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("caches", undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("decodes a saved book once, still observes a newer response from another tab", async () => {
  const stored = new Map<string, Response>();
  const json = vi.fn();
  const cache = {
    keys: async () => [...stored.keys()].map((url) => ({ url })),
    match: async (key: string | { url: string }) => {
      const response = stored
        .get(typeof key === "string" ? key : key.url)
        ?.clone();
      if (response) {
        const decode = response.json.bind(response);
        response.json = async () => {
          json();
          return decode();
        };
      }
      return response;
    },
    put: async (key: string, response: Response) => {
      stored.set(key, response.clone());
    },
    delete: async (key: string) => stored.delete(key),
  };
  vi.stubGlobal("caches", { open: async () => cache });
  vi.stubGlobal("navigator", {
    locks: { request: (_name: string, task: () => Promise<unknown>) => task() },
  });
  // Existing v1 cache entries have no timestamp header. Preserve their at value.
  stored.set(
    url,
    Response.json({ at: now - 1000, body: { bazaar: [item], usage } }),
  );
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  const { savedBazaarBook } = await import("../src/companion/request-cache");
  await savedBazaarBook(url, item.id);
  await savedBazaarBook(url, item.id);
  expect(json).toHaveBeenCalledTimes(1);
  expect(JSON.parse(await stored.get(url)!.clone().text()).at).toBe(now - 1000);
  stored.set(
    url,
    Response.json(
      { at: now, body: { bazaar: [{ ...item, observedAt: now + 1 }], usage } },
      { headers: { "X-Cache-At": String(now) } },
    ),
  );
  expect((await savedBazaarBook(url, item.id))?.item.observedAt).toBe(now + 1);
  expect(json).toHaveBeenCalledTimes(2);
  expect(network).not.toHaveBeenCalled();
});

it("one reader aborting does not cancel a shared request needed by another reader", async () => {
  let finish!: (r: Response) => void;
  let networkSignal!: AbortSignal;
  const network = vi.fn((_url, options) => {
    networkSignal = options.signal;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  vi.stubGlobal("fetch", network);
  const { cachedMarketRequest } =
    await import("../src/companion/request-cache");
  const a = new AbortController(),
    b = new AbortController();
  const first = cachedMarketRequest(url, a.signal);
  const second = cachedMarketRequest(url, b.signal);
  await vi.waitFor(() => expect(network).toHaveBeenCalledOnce());
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  a.abort();
  await rejected;
  expect(networkSignal.aborted).toBe(false);
  finish(Response.json({ bazaar: [item], usage }));
  await expect(second).resolves.toMatchObject({ bazaar: [item] });
  expect(network).toHaveBeenCalledOnce();
});

it("cancels shared network work only when its last reader leaves", async () => {
  let networkSignal!: AbortSignal;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, options) => {
      networkSignal = options.signal;
      return new Promise((_resolve, reject) =>
        networkSignal.addEventListener(
          "abort",
          () => reject(networkSignal.reason),
          { once: true },
        ),
      );
    }),
  );
  const { cachedMarketRequest } =
    await import("../src/companion/request-cache");
  const a = new AbortController(),
    b = new AbortController();
  const first = cachedMarketRequest(url, a.signal),
    second = cachedMarketRequest(url, b.signal);
  await vi.waitFor(() => expect(networkSignal).toBeDefined());
  const settled = Promise.allSettled([first, second]);
  a.abort();
  b.abort();
  expect(networkSignal.aborted).toBe(true);
  expect((await settled).every((result) => result.status === "rejected")).toBe(
    true,
  );
});

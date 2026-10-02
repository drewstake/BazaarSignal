import type { AppData } from "../shared/model";
import { DEFAULT_SETTINGS } from "../shared/model";
import { trigger } from "../functions/src/engine";
import type { LiveSnapshot } from "../server/live-market";
import { visiblePoll } from "./companion/polling";
const KEY = "bazaar-watch-live-v1";
export function readLive(): AppData {
  const base: AppData = {
    workflows: [],
    prices: [],
    books: {},
    events: [],
    settings: { ...DEFAULT_SETTINGS, emailEnabled: false },
    status: { lastAttempt: 0, lastUpdated: 0, lastSuccess: 0, error: null },
  };
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (
      stored &&
      Array.isArray(stored.workflows) &&
      Array.isArray(stored.events)
    )
      return {
        ...base,
        workflows: stored.workflows,
        events: stored.events,
        settings: {
          ...base.settings,
          ...stored.settings,
          emailEnabled: false,
          discordEnabled: false,
          discordTested: false,
        },
      };
  } catch {}
  return base;
}
export function saveLive(data: AppData) {
  // Keep live books in memory; never fill localStorage with the full Bazaar.
  localStorage.setItem(
    KEY,
    JSON.stringify({
      workflows: data.workflows,
      settings: data.settings,
      events: data.events.slice(0, 100),
    }),
  );
}
export function evaluateLocal(data: AppData, now = Date.now()): AppData {
  if (data.status.error || data.settings.monitoringPaused) return data;
  const events = [
    ...data.events.filter((e) => now - e.createdAt <= 30 * 86_400_000),
  ];
  const workflows = data.workflows.map((w) => {
    const result = trigger(
      { ...w, channels: ["email"] },
      data.books[w.itemId],
      data.status.lastUpdated,
      { ...data.settings, emailEnabled: true },
      window.location.origin,
      now,
    );
    if (!result) return w;
    events.unshift({
      ...result.event,
      pending: false,
      deliveries: {},
      message:
        "ON-SCREEN ALERT — no email or Discord message was sent.\n" +
        result.event.message,
    });
    return { ...result.workflow, channels: w.channels };
  });
  return { ...data, workflows, events: events.slice(0, 100) };
}
export function mergeLive(data: AppData, snapshot: LiveSnapshot) {
  return evaluateLocal({ ...data, ...snapshot });
}
export function subscribeLive(
  update: (snapshot: LiveSnapshot) => void,
  onError: (message: string) => void,
) {
  let closed = false,
    inflight = false, version = "";
  async function poll(signal: AbortSignal) {
    if (inflight || closed) return;
    inflight = true;
    try {
      const response = await fetch("/api/market", {
        signal,
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Live market is unavailable.");
      if (!body.status || !Array.isArray(body.prices) || !body.books)
        throw new Error("Invalid market response.");
      const next = JSON.stringify([body.status.lastUpdated, body.status.error]);
      if (!closed && version !== next) { version = next; update(body); }
    } catch (e) {
      version = "";
      if (!closed)
        onError(e instanceof Error ? e.message : "Live market is unavailable.");
    } finally {
      inflight = false;
    }
  }
  const stop = visiblePoll(poll, 60000);
  return () => {
    closed = true;
    stop();
  };
}

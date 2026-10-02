import type { AppData, Book, PriceAlertInput, Workflow } from "../shared/model";
import { confirmation, newPriceAlert } from "../shared/price-alert";
import { auth, isDemo } from "./data";
import { requestBackend } from './backend';
import { marketRequest } from './companion/api';
import type { CacheStatus } from './companion/api';

const linksKey = () => `bazaarsignal-${isDemo ? "demo" : "local"}-links`;
export function createLocalAlert(data: AppData, input: PriceAlertInput) {
  const existing = data.workflows.find((w) => w.id === input.requestId);
  if (existing)
    return {
      data,
      event: data.events.find((e) => e.id === `${existing.id}-created`)!,
    };
  if (
    data.workflows.filter((w) => !w.paused && w.stage !== "completed").length >=
    20
  )
    throw new Error("You can have at most 20 active alerts.");
  const item = data.prices.find((p) => p.id === input.itemId);
  if (!item) throw new Error("Item is unavailable.");
  const now = Date.now();
  const workflow = newPriceAlert(input.requestId, item.name, input, now);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const url = new URL(window.location.origin);
  if (isDemo) url.searchParams.set("demo", "1");
  url.hash = `disable=${token}`;
  const event = {
    ...confirmation(workflow, url.href, now),
    pending: false,
    deliveries: {},
  };
  const links = JSON.parse(localStorage.getItem(linksKey()) ?? "{}");
  links[token] = workflow.id;
  localStorage.setItem(linksKey(), JSON.stringify(links));
  return {
    data: {
      ...data,
      workflows: [...data.workflows, workflow],
      events: [event, ...data.events],
    },
    event,
  };
}
export function disableLocalAlert(data: AppData, token: string): AppData {
  const links = JSON.parse(localStorage.getItem(linksKey()) ?? "{}");
  const id = /^[a-f0-9]{64}$/.test(token) ? links[token] : null;
  if (!id || !data.workflows.some((w) => w.id === id))
    throw new Error(
      "This preview link is only valid in the browser where you created the alert.",
    );
  return {
    ...data,
    workflows: data.workflows.map((w) =>
      w.id === id ? { ...w, paused: true, updatedAt: Date.now() } : w,
    ),
  };
}
export async function createCloudAlert(input: PriceAlertInput) {
  if (!auth?.currentUser) throw new Error('Sign in first.');
  return requestBackend<{id:string;emailStatus:string}>({action:'create',input},await auth.currentUser.getIdToken());
}
export async function fetchCloudAlerts() {
  if (!auth?.currentUser) throw new Error('Sign in first.');
  return requestBackend<{workflows:Workflow[]}>({action:'account'},await auth.currentUser.getIdToken());
}
export async function updateCloudAlert(workflow: Workflow, target: number) {
  if (!auth?.currentUser) throw new Error('Sign in first.');
  return requestBackend<{workflow:Workflow}>({action:'update',id:workflow.id,target,revision:workflow.revision},await auth.currentUser.getIdToken());
}
export async function disableCloudAlert(token: string) {
  await requestBackend({action:'disable',token,confirm:true});
}
export async function fetchItemBook(itemId: string, signal?: AbortSignal) {
  return marketRequest<{book:Book;timestamp:number;observedAt?:number;status?:CacheStatus}>(`book?itemId=${encodeURIComponent(itemId)}`,signal);
}

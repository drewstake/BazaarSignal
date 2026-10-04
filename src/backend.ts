import { localWorkspace } from "./local-workspace";
export interface BackendRequest {
  action:
    | "snapshot"
    | "book"
    | "companion"
    | "playerNames"
    | "account"
    | "create"
    | "update"
    | "disable"
    | "portfolio-notification"
    | "legacy-pause";
  [key: string]: unknown;
}
export const backendUrl = import.meta.env.VITE_APPS_SCRIPT_URL || "";
export function validBackendUrl(value: string) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(
    value,
  );
}
class BackendReadError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
  }
}
function retryDelay(response: Response): number | null {
  if (![429, 500, 502, 503, 504].includes(response.status)) return null;
  const value = response.headers.get("Retry-After");
  if (!value) return 1000;
  const delay = /^\d+$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - Date.now();
  // Do not shorten a server cooldown or leave a long-lived retry running.
  return Number.isFinite(delay) && delay <= 10000
    ? Math.max(1000, delay)
    : null;
}
function waitForRetry(delay: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export async function requestBackend<T>(
  request: BackendRequest,
  idToken?: string,
  signal?: AbortSignal,
): Promise<T> {
  // Only saved-account reads get one bounded retry. Never replay a mutation or
  // a market request here, and never wait for the hourly market schedule.
  try {
    return await attemptBackend<T>(request, idToken, signal);
  } catch (error) {
    if (
      request.action !== "account" ||
      !(error instanceof BackendReadError) ||
      error.retryAfterMs === null ||
      signal?.aborted
    )
      throw error;
    await waitForRetry(error.retryAfterMs, signal);
    return attemptBackend<T>(request, idToken, signal);
  }
}
async function attemptBackend<T>(
  request: BackendRequest,
  idToken?: string,
  signal?: AbortSignal,
): Promise<T> {
  if (!localWorkspace && !validBackendUrl(backendUrl))
    throw new Error("The email backend is not configured yet.");
  // A CORS simple request avoids Apps Script's unsupported OPTIONS preflight.
  // Never use no-cors (opaque success), JSONP, credentials, tokens in URLs, or an Authorization header.
  let response: Response;
  try {
    response = await fetch(localWorkspace ? "/api/local/account" : backendUrl, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      referrerPolicy: "no-referrer",
      body: JSON.stringify({
        ...request,
        version: 1,
        origin: window.location.origin,
        ...(idToken ? { idToken } : {}),
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60000)])
        : AbortSignal.timeout(60000),
    });
  } catch {
    signal?.throwIfAborted();
    throw new BackendReadError(
      request.action === "account"
        ? "Cannot reach the saved-alert service. Check your connection and retry alerts."
        : "Cannot reach the email backend. Check the connection and retry; your request will not be duplicated.",
      1000,
    );
  }
  if (!response.ok)
    throw new BackendReadError(
      request.action === "account"
        ? `Saved alerts could not be loaded (HTTP ${response.status}). Please try again.`
        : `The email backend is unavailable (HTTP ${response.status}).`,
      retryDelay(response),
    );
  let body: any;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "The backend deployment or Google authorization needs attention.",
    );
  }
  if (body.ok !== true)
    throw new Error(
      typeof body.error === "string" ? body.error : "Backend request failed.",
    );
  return body.data as T;
}

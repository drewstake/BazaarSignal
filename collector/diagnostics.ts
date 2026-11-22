/** Deliberately omit provider bodies, URLs, tokens and arbitrary error messages. */
export function errorDiagnostic(error: unknown) {
  const e = error as { code?: unknown; message?: unknown; billingStage?: unknown } | null;
  const message = typeof e?.message === 'string' ? e.message : '';
  const code = typeof e?.code === 'number' && Number.isFinite(e.code) ? e.code : undefined;
  const reason = isFirestoreWriteThrottle(e) ? 'firestore-write-bandwidth'
    : isTransportTimeout(e) ? 'transport-timeout'
    : isTransientFirestoreFailure(e) ? 'firestore-unavailable'
    : /quota/i.test(message) ? 'quota-exhausted'
    : message === 'Invalid Google cost update' ? 'invalid-cost-timestamp-or-value'
    : /Google billing configuration/.test(message) ? 'invalid-billing-configuration'
    : /reservation|deadline/i.test(message) ? 'reservation-or-deadline'
    : /response|JSON/i.test(message) ? 'invalid-response'
    : code === 429 || code === 8 ? 'resource-exhausted'
    : code !== undefined ? 'provider-error' : 'operation-failed';
  const stage = ['pull', 'save', 'acknowledge'].includes(String(e?.billingStage)) ? e!.billingStage : undefined;
  return { reason, ...(code === undefined ? {} : { code }), ...(stage ? { stage } : {}) };
}

export type DiagnosticReporter = (data: Record<string, unknown>) => void;

/** Only an explicit rejected write is transient here. Quota, deadline,
 * authentication and ambiguous failures retain their existing stop behavior. */
export function isFirestoreWriteThrottle(error: unknown) {
  const e = error as { code?: unknown; message?: unknown } | null;
  return (e?.code === 429 || e?.code === 8) &&
    typeof e.message === 'string' && /maximum (?:bandwidth|request_rate\/bandwidth\/document_rate) for writes\b/i.test(e.message) &&
    !/quota/i.test(e.message);
}

/** Unresolved Firestore failures defer the invocation and retain its reservation.
 * Inline Bazaar publications can first reconcile against their control revision. */
export function isTransientFirestoreFailure(error: unknown) {
  return isFirestoreWriteThrottle(error) || isFirestoreUnavailable(error);
}

export function isFirestoreUnavailable(error: unknown) {
  const e = error as { code?: unknown; service?: unknown } | null;
  return e?.service === 'firestore' && (e.code === 503 || e.code === 14);
}

/** A request timeout says nothing about whether a write committed. End this
 * invocation without replay, refunds, or a service-wide stop. Match structured
 * transport identities, never arbitrary messages containing "timeout". */
export function isTransportTimeout(error: unknown) {
  const visited = new Set<unknown>();
  for (let depth = 0; depth < 4 && error && typeof error === 'object' && !visited.has(error); depth++) {
    visited.add(error);
    const current = error as { name?: unknown; code?: unknown; cause?: unknown };
    if (current.name === 'TimeoutError' ||
        ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(String(current.code)))
      return true;
    error = current.cause;
  }
  return false;
}

export const isTransientMarketFailure = (error: unknown) =>
  isTransientFirestoreFailure(error) || isTransportTimeout(error);

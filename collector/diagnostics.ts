/** Deliberately omit provider bodies, URLs, tokens and arbitrary error messages. */
export function errorDiagnostic(error: unknown) {
  const e = error as { code?: unknown; message?: unknown; billingStage?: unknown } | null;
  const message = typeof e?.message === 'string' ? e.message : '';
  const code = typeof e?.code === 'number' && Number.isFinite(e.code) ? e.code : undefined;
  const reason = isFirestoreWriteThrottle(e) ? 'firestore-write-bandwidth'
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

/** An unavailable Firestore operation ends this invocation without replaying a
 * possibly committed write. Keep every reservation; the next scheduled request
 * must read and pass durable admission again. Unrelated 5xx/auth/quota failures
 * and explicit budget stops do not qualify. */
export function isTransientFirestoreFailure(error: unknown) {
  const e = error as { code?: unknown; service?: unknown } | null;
  return isFirestoreWriteThrottle(error) ||
    (e?.service === 'firestore' && (e.code === 503 || e.code === 14));
}

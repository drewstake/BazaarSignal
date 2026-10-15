/** Deliberately omit provider bodies, URLs, tokens and arbitrary error messages. */
export function errorDiagnostic(error: unknown) {
  const e = error as { code?: unknown; message?: unknown; billingStage?: unknown } | null;
  const message = typeof e?.message === 'string' ? e.message : '';
  const code = typeof e?.code === 'number' && Number.isFinite(e.code) ? e.code : undefined;
  const reason = /maximum bandwidth for writes/i.test(message) ? 'firestore-write-bandwidth'
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

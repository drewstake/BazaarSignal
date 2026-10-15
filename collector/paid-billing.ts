import { type PaidBilling, type GoogleSpend, validPaidBilling } from '../shared/paid-spending';

export interface BudgetMessage {
  ackId: string;
  message: { data: string; publishTime: string; attributes: Record<string, string> };
}
/** Reject foreign budgets, forecasts, wrong periods/currencies and future dates. */
export function parseBudgetMessage(item: BudgetMessage, billing: PaidBilling, now: number): GoogleSpend | null {
  try {
    const m = item.message, a = m.attributes;
    if (!validPaidBilling(billing, now) || a.billingAccountId !== billing.accountId ||
        a.budgetId !== billing.budgetId || a.schemaVersion !== '1.0' ||
        typeof m.data !== 'string' || m.data.length > 16384) return null;
    const data = JSON.parse(Buffer.from(m.data, 'base64').toString('utf8'));
    const publishedAt = Date.parse(m.publishTime), intervalStart = Date.parse(data.costIntervalStart);
    if (data.currencyCode !== 'USD' || typeof data.costAmount !== 'number' || !Number.isFinite(data.costAmount) ||
        data.budgetAmount !== 5 || data.budgetAmountType !== 'SPECIFIED_AMOUNT' ||
        intervalStart !== billing.intervalStart || !Number.isFinite(publishedAt) ||
        publishedAt < intervalStart || publishedAt > now) return null;
    return { actualUsd: data.costAmount, publishedAt, receivedAt: now, intervalStart };
  } catch { return null; }
}

/** One bounded pull per hourly collector; no browser request polls billing. */
export function googleBillingFeed(token: () => Promise<string>, network: typeof fetch = fetch, clock = Date.now) {
  async function call(subscription: string, action: 'pull' | 'acknowledge', body: unknown) {
    const r = await network(`https://pubsub.googleapis.com/v1/${subscription}:${action}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw Object.assign(Error(`Google billing feed HTTP ${r.status}`), { code: r.status });
    if (!r.body) throw Error('Empty Google billing response');
    const reader = r.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.length;
        if (size > 256 * 1024) { await reader.cancel(); throw Error('Google billing response exceeds bound'); }
        parts.push(part.value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  }
  return async (billing: PaidBilling, save: (costs: GoogleSpend[]) => Promise<void>, now: number) => {
    let stage = 'pull';
    try {
    if (!validPaidBilling(billing, now)) throw Error('Invalid Google billing configuration');
    const response = await call(billing.subscription, 'pull', { maxMessages: 20, returnImmediately: true });
    const messages: BudgetMessage[] = response.receivedMessages ?? [];
    if (!Array.isArray(messages) || messages.length > 20 || messages.some(m => typeof m.ackId !== 'string' || !m.ackId))
      throw Error('Invalid Google billing messages');
    // A notification can be published while pull is in flight. Validate against
    // receipt time, not the earlier request start, or it would be lost as future.
    const receivedAt = Math.max(now, clock());
    const costs = messages.map(m => parseBudgetMessage(m, billing, receivedAt)).filter((s): s is GoogleSpend => !!s);
    // Persist before acknowledging: a crash/retry cannot lose a cost update.
    stage = 'save';
    await save(costs);
    stage = 'acknowledge';
    if (messages.length) await call(billing.subscription, 'acknowledge', { ackIds: messages.map(m => m.ackId) });
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : Error('Google billing feed failed'), { billingStage: stage });
    }
  };
}

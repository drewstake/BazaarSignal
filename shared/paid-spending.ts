/** Google-reported net cost, separate from the retained reservation ledger. */
export interface GoogleSpend {
  actualUsd: number;
  publishedAt: number;
  receivedAt: number;
  intervalStart: number;
}
export interface PaidBilling {
  accountId: string;
  budgetId: string;
  subscription: string;
  scope: string;
  intervalStart: number;
  latest?: GoogleSpend;
  checkedAt?: number;
  error?: string;
}
export const BILLING_ACCOUNT_ID = '012803-EA91BE-8DCD32';
export const BILLING_SUBSCRIPTION = 'projects/bazaarsignal-510305/subscriptions/bazaar-paid-spend-october';
export const BILLING_INTERVAL_START = Date.parse('2026-10-01T07:00:00Z');
export function validGoogleSpend(value: GoogleSpend | undefined, intervalStart: number, now: number) {
  return !!value && Number.isFinite(value.actualUsd) &&
    value.intervalStart === intervalStart &&
    Number.isFinite(value.publishedAt) && Number.isFinite(value.receivedAt) &&
    value.publishedAt >= intervalStart && value.publishedAt <= now &&
    value.receivedAt >= value.publishedAt && value.receivedAt <= now;
}
export function validPaidBilling(value: PaidBilling, now: number) {
  return value.accountId === BILLING_ACCOUNT_ID &&
    /^[a-zA-Z0-9-]{1,100}$/.test(value.budgetId) &&
    value.subscription === BILLING_SUBSCRIPTION &&
    value.intervalStart === BILLING_INTERVAL_START &&
    typeof value.scope === 'string' && value.scope.length > 0 &&
    (!value.latest || validGoogleSpend(value.latest, value.intervalStart, now));
}

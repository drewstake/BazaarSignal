/** Explicit October paid pilot. No automatic budget renewal. */
export const PAID_PILOT_END = Date.parse('2026-11-01T07:00:00.000Z');
export const PAID_MARKET_ORIGIN = 'https://marketapi-k5a64sgi2q-uc.a.run.app';
export const PAID_PILOT_ID = 'paid-202610';
export const PAID_PILOT_INTERVAL = 15 * 60_000;
export const PAID_COLLECTION_SCHEDULE = '*/15 * * * *';
export const paidPilotActive = (mode: string | null | undefined, now = Date.now()) =>
  mode === 'paid-budget' && now < PAID_PILOT_END;
export const paidPilotAlertWindow = (at: number) =>
  at % PAID_PILOT_INTERVAL >= 90_000 && at % PAID_PILOT_INTERVAL < 150_000;

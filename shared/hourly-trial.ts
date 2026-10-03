// User-authorized hourly comparison test, ending Oct 3 at 8 PM Eastern.
// This window does not renew the live period or alter any resource allowance.
export const HOURLY_TRIAL_START = Date.parse('2026-10-02T23:00:00Z');
export const HOURLY_TRIAL_END = Date.parse('2026-10-04T00:00:00Z');
export const hourlyTrialActive = (now:number) => now >= HOURLY_TRIAL_START && now < HOURLY_TRIAL_END;

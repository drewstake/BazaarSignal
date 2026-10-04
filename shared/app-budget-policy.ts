/** Fraction of each conservative APPLICATION budget, never of a pooled or
 * published provider allowance. Stricter free-tier evidence checks still apply. */
export const APP_BUDGET_PAUSE_FRACTION = 0.9;
export const APP_BUDGET_PAUSE_PERCENT = APP_BUDGET_PAUSE_FRACTION * 100;
export const APP_BUDGET_PAUSE_DESCRIPTION = `Updates pause before a reservation reaches ${APP_BUDGET_PAUSE_PERCENT}% of any individual app budget. Free-tier headroom checks can slow or pause them earlier.`;

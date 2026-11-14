import { continuousMarket } from './continuous-market';
import { paidPilotActive } from './paid-pilot';

export const marketServiceActive = (mode: string | null | undefined, now = Date.now()) =>
  continuousMarket(mode) || paidPilotActive(mode, now);

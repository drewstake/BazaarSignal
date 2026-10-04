import { describe, expect, it, vi } from 'vitest';
import { parseMarket, parseSampledMarket, createAlert, emptyState, poll, deliver } from '../apps-script/core';
import { estimate, evaluate } from '../shared/market';
import { sampleAge } from '../src/SampleTime';

const stamp = Date.parse('2026-10-02T14:00:08Z');
const product = {
  buy_summary: [{ amount: 2, pricePerUnit: 110, orders: 1 }, { amount: 10, pricePerUnit: 120, orders: 1 }],
  sell_summary: [{ amount: 4, pricePerUnit: 90, orders: 1 }, { amount: 10, pricePerUnit: 80, orders: 1 }],
  quick_status: { buyVolume: 100, sellVolume: 200, buyMovingWeek: 100000, sellMovingWeek: 100000 },
};
const raw = { success: true, lastUpdated: stamp, products: { SUMMONING_EYE: product } };

describe('sampled prices versus live eligibility', () => {
  it.each([30_000, 180_001, 59 * 60_000, 3_600_001])('displays an intact %ims-old sample without changing its time', age => {
    const now = stamp + age;
    const market = parseSampledMarket(raw, now);
    expect(market.timestamp).toBe(stamp);
    expect(market.prices[0]).toMatchObject({ buy: 110, sell: 90 });
    expect(estimate(market.books.SUMMONING_EYE, 3, 'buy')?.unit).toBeCloseTo(340 / 3);
    expect(estimate(market.books.SUMMONING_EYE, 3, 'sell', 1.25)?.unit).toBe(88.875);
    if (age > 180_000) expect(() => parseMarket(raw, now)).toThrow(/stale/);
  });
  it('never queues or sends a target email from a displayed stale sample', () => {
    const market = parseSampledMarket(raw, stamp), state = emptyState('owner');
    createAlert(state, {requestId:'12345678-1234-4234-8234-123456789012',itemId:'SUMMONING_EYE',side:'buy',quantity:3,target:120,taxRate:1.25}, market, 'owner@example.test', 'a'.repeat(64), stamp);
    state.mail[0].status = 'sent';
    const send = vi.fn();
    for (const age of [180001, 35*60000, 3600001]) {
      expect(evaluate(state.alerts[0].workflow, market.books.SUMMONING_EYE, stamp, 1.25, stamp+age)).toBeNull();
      expect(() => poll(state, market, stamp+age)).toThrow(/stale/);
      deliver(state, {now:()=>stamp+age,quota:()=>100,save:vi.fn(),send,receipt:()=>undefined,recordReceipt:vi.fn(),clearReceipt:vi.fn()} as any);
      expect(state.mail.filter(m=>m.kind==='target')).toHaveLength(0);
    }
    expect(send).not.toHaveBeenCalled();
    poll(state, market, stamp+30_000);
    expect(state.mail.filter(m=>m.kind==='target')).toHaveLength(1);
  });
  it('reports age without making an hourly sample look live', () => {
    expect(sampleAge(stamp, stamp+35000)).toBe('35s ago');
    expect(sampleAge(stamp, stamp+35*60000)).toBe('35m ago');
    expect(sampleAge(stamp, stamp+3_650_000)).toBe('1h 0m ago');
  });
});

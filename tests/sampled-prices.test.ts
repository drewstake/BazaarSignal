import { describe, expect, it, vi } from 'vitest';
import { parseMarket, parseSampledMarket, createAlert, emptyState, poll, deliver } from '../apps-script/core';
import { estimate, evaluate } from '../shared/market';
import { bazaarTrade, defaultBazaarFilters, filterBazaar, normalizeBazaar, quoteBazaar } from '../shared/companion/bazaar';
import { sampleAge } from '../src/SampleTime';

const stamp = Date.parse('2026-10-02T14:00:08Z');
const product = {
  buy_summary: [{ amount: 2, pricePerUnit: 110, orders: 1 }, { amount: 10, pricePerUnit: 120, orders: 1 }],
  sell_summary: [{ amount: 4, pricePerUnit: 90, orders: 1 }, { amount: 10, pricePerUnit: 80, orders: 1 }],
  quick_status: { buyVolume: 100, sellVolume: 200, buyMovingWeek: 100000, sellMovingWeek: 100000 },
};
const raw = { success: true, lastUpdated: stamp, products: { SUMMONING_EYE: product } };
const item = () => ({ ...normalizeBazaar('SUMMONING_EYE', product, stamp, stamp + 5000),
  feeContext: { mayor: 'Diana', multiplier: 1, checkedAt: stamp + 1000, explanation: 'Sampled fee evidence' } });
const filters = { ...defaultBazaarFilters, quantity: 3, minDepth: 0, executionCost: 2 };

describe('sampled prices versus live eligibility', () => {
  it.each([30_000, 180_001, 59 * 60_000, 3_600_001])('displays an intact %ims-old sample without changing its time', age => {
    const now = stamp + age;
    const market = parseSampledMarket(raw, now);
    expect(market.timestamp).toBe(stamp);
    expect(market.prices[0]).toMatchObject({ buy: 110, sell: 90 });
    expect(estimate(market.books.SUMMONING_EYE, 3, 'buy')?.unit).toBeCloseTo(340 / 3);
    expect(estimate(market.books.SUMMONING_EYE, 3, 'sell', 1.25)?.unit).toBe(88.875);
    const quote = quoteBazaar(item(), filters, now)!;
    expect(quote.profit).toBe(53.875); // 3 * 110 * .9875 - 3 * 90 - 2
    expect(quote.fresh).toBe(age <= 180_000);
    expect(filterBazaar([item()], filters, now, true)).toHaveLength(1);
    expect(filterBazaar([item()], filters, now)).toHaveLength(age <= 180_000 ? 1 : 0);
    if (age > 180_000) expect(() => parseMarket(raw, now)).toThrow(/stale/);
  });
  it('keeps units and directions distinct for all three strategies', () => {
    const order = quoteBazaar(item(), filters, stamp + 10000)!;
    expect(order).toMatchObject({ acquisitionUnit: 90, exitUnit: 110, acquisition: 270, grossSale: 330, tax: 4.125, capital: 272 });
    const instant = quoteBazaar(item(), { ...filters, strategy: 'instant-offer' }, stamp + 10000)!;
    expect(instant.acquisition).toBe(340);
    expect(instant.profit).toBe(-16.125);
    const sell = quoteBazaar(item(), { ...filters, quantity: 5, strategy: 'order-instant' }, stamp + 10000)!;
    expect(sell.grossSale).toBe(440);
    expect(sell.profit).toBe(-17.5);
    expect(order.roi).toBeCloseTo(53.875 / 272 * 100);
  });
  it('withholds profit for missing, unverified, nonfinite and incompatible fee evidence', () => {
    const x = item();
    for (const fee of [undefined, {...x.feeContext, multiplier: null}, {...x.feeContext, multiplier: NaN},
      {...x.feeContext, checkedAt: stamp - 3_600_000}, {...x.feeContext, checkedAt: stamp + 3_600_000}]) {
      const partial = { ...x, feeContext: fee };
      expect(quoteBazaar(partial, filters, stamp + 3_650_000)).toBeNull();
      expect(bazaarTrade(partial, filters, stamp + 3_650_000).sale?.total).toBe(330);
    }
  });
  it('preserves a valid leg of a partial book while withholding incomplete profit', () => {
    const partial = { ...item(), asks: [] };
    expect(bazaarTrade(partial, filters, stamp + 10000)).toMatchObject({ buy: {total:270}, sale:null });
    expect(quoteBazaar(partial, filters, stamp + 10000)).toBeNull();
    const market = parseSampledMarket({...raw, products:{SUMMONING_EYE:{...product, buy_summary:[]}}}, stamp + 10000);
    expect(market.prices[0]).toMatchObject({buy:null, sell:90});
    expect(estimate(market.books.SUMMONING_EYE, 3, 'buy')).toBeNull();
    expect(estimate(market.books.SUMMONING_EYE, 3, 'sell')?.unit).toBe(88.875);
  });
  it('does not salvage invalid books, zero/string prices, invalid times, or insufficient depth', () => {
    for (const price of [0, -1, '110', NaN, Infinity]) {
      expect(() => parseSampledMarket({...raw, products:{BAD:{...product,buy_summary:[{amount:1,orders:1,pricePerUnit:price}]}}}, stamp)).toThrow();
      expect(quoteBazaar({...item(), bids:[{amount:10,orders:1,pricePerUnit:price as number}]}, filters, stamp + 10000)).toBeNull();
    }
    for (const lastUpdated of [0, NaN, stamp + 31_000]) expect(() => parseSampledMarket({...raw,lastUpdated}, stamp)).toThrow();
    expect(() => parseSampledMarket({...raw,products:{}}, stamp)).toThrow();
    expect(quoteBazaar({...item(), observedAt: stamp + 3_600_000}, filters, stamp + 3_650_000)).toBeNull();
    expect(quoteBazaar(item(), {...filters, quantity:13, strategy:'instant-offer'}, stamp+10000)).toBeNull();
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

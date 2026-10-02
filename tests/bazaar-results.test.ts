import { describe, expect, it } from 'vitest';
import { bazaarResults } from '../src/companion/bazaar-results';
import { defaultBazaarFilters, normalizeBazaar, quoteBazaar } from '../shared/companion/bazaar';

const stamp = Date.parse('2026-10-02T15:00:08Z');
const now = stamp + 35 * 60_000;
const item = {
  ...normalizeBazaar('SUMMONING_EYE', {
    buy_summary: [{amount:1000, pricePerUnit:1_482_424, orders:1}],
    sell_summary: [{amount:1000, pricePerUnit:1_455_447, orders:1}],
    quick_status: {buyVolume:10000, sellVolume:10000, buyMovingWeek:103600, sellMovingWeek:67800},
  }, stamp, stamp + 4000),
  feeContext: {mayor:'Diana', multiplier:1, checkedAt:stamp, explanation:'Sampled fee evidence'},
};

describe('Bazaar search discovery', () => {
  it('finds an over-budget item without changing quantity, fees, price or freshness', () => {
    const filters = {...defaultBazaarFilters, query:'Summoning Eye'};
    const original = structuredClone(filters);
    const rows = bazaarResults([item], filters, now);
    expect(rows).toHaveLength(1);
    expect(rows[0].outsideFilters).toBe(true);
    expect(rows[0].quote).toEqual(quoteBazaar(item, filters, now));
    expect(rows[0].quote).toMatchObject({quantity:64, fresh:false});
    expect(rows[0].quote!.capital).toBeGreaterThan(filters.budget);
    expect(filters).toEqual(original);
    expect(bazaarResults([item], {...filters, query:''}, now)).toHaveLength(0);
  });
  it('retains missing prices and fee evidence without fabricating profit', () => {
    for (const partial of [{...item, asks:[]}, {...item, feeContext:undefined}]) {
      const rows = bazaarResults([partial], {...defaultBazaarFilters, query:'SUMMONING_EYE'}, now);
      expect(rows).toHaveLength(1);
      expect(rows[0].quote).toBeNull();
    }
  });
  it('does not duplicate a matching trade and honours filters when browsing', () => {
    const filters = {...defaultBazaarFilters, quantity:1, query:'summoning'};
    expect(bazaarResults([item], filters, now)).toMatchObject([{outsideFilters:false}]);
    expect(bazaarResults([item], {...filters, query:'missing'}, now)).toEqual([]);
    expect(bazaarResults([item], {...filters, category:'mining'}, now)).toMatchObject([{outsideFilters:true}]);
    expect(bazaarResults([item], {...filters, category:'mining', query:''}, now)).toEqual([]);
  });
});

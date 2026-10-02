import { filterBazaar, quoteBazaar } from '../../shared/companion/bazaar';
import type { BazaarFilters, BazaarItem, BazaarQuote } from '../../shared/companion/types';

/** Search is also item lookup. Keep filter exclusions explicit, never change trade inputs. */
export function bazaarResults(items: BazaarItem[], filters: BazaarFilters, now: number) {
  const matches = filterBazaar(items, filters, now, true);
  const included = new Set(matches.map(q => q.item.id));
  const rows: {item: BazaarItem; quote: BazaarQuote | null; outsideFilters: boolean}[] = matches.map(quote => ({ item: quote.item, quote, outsideFilters: false }));
  for (const item of items) {
    if (included.has(item.id)) continue;
    const searching = filters.query.trim().length > 0;
    const nameMatches = `${item.name} ${item.id}`.toLowerCase().includes(filters.query.trim().toLowerCase());
    const quote = quoteBazaar(item, filters, now);
    if (nameMatches && (searching || (filters.category === 'all' || item.category === filters.category) && !quote))
      rows.push({ item, quote, outsideFilters: searching });
  }
  return rows;
}

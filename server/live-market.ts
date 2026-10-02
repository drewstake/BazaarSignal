import type { Book, ProductPrice, MarketStatus } from "../shared/model";
// Compatibility type for the Price Alerts UI. Serving is handled by the shared collector.
export interface LiveSnapshot { prices: ProductPrice[]; books: Record<string, Book>; status: MarketStatus }

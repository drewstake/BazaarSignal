import { activePage } from "../../shared/companion/active-auctions";
// Explicit development fixtures only. Never used after a failed live request.
import { normalizeBazaar } from "../../shared/companion/bazaar";
import type {
  AuctionFilters,
  CollectorHealth,
  ItemVariant,
  Listing,
} from "../../shared/companion/types";
const rows = [
  ["SUMMONING_EYE", "Summoning Eye", "combat", "EPIC", 620000, 695000, 180000],
  [
    "BOOSTER_COOKIE",
    "Booster Cookie",
    "other",
    "LEGENDARY",
    10200000,
    10400000,
    290000,
  ],
  [
    "ENCHANTED_DIAMOND_BLOCK",
    "Enchanted Diamond Block",
    "mining",
    "RARE",
    192000,
    201000,
    900000,
  ],
  [
    "ENCHANTMENT_REJUVENATE_5",
    "Rejuvenate V",
    "enchantments",
    "RARE",
    82000,
    92000,
    380000,
  ],
  [
    "ENCHANTED_BLAZE_ROD",
    "Enchanted Blaze Rod",
    "combat",
    "UNCOMMON",
    280000,
    299000,
    220000,
  ],
  [
    "ENCHANTED_SUGAR_CANE",
    "Enchanted Sugar Cane",
    "farming",
    "UNCOMMON",
    102000,
    109000,
    1800000,
  ],
  [
    "ENCHANTED_GOLD_BLOCK",
    "Enchanted Gold Block",
    "mining",
    "RARE",
    118000,
    127000,
    1200000,
  ],
  [
    "ENCHANTED_EMERALD_BLOCK",
    "Enchanted Emerald Block",
    "mining",
    "RARE",
    162000,
    169000,
    600000,
  ],
  [
    "ENCHANTED_LAPIS_LAZULI_BLOCK",
    "Enchanted Lapis Block",
    "mining",
    "RARE",
    91000,
    95000,
    560000,
  ],
  [
    "ENCHANTED_ENDER_PEARL",
    "Enchanted Ender Pearl",
    "combat",
    "UNCOMMON",
    800,
    920,
    4200000,
  ],
] as const;
export function bazaarFixtures() {
  return rows.map(([id, name, category, tier, bid, ask, activity]) => ({
    ...normalizeBazaar(
      id,
      {
        buy_summary: [
          { amount: 1000, orders: 12, pricePerUnit: ask },
          { amount: 5000, orders: 20, pricePerUnit: ask * 1.02 },
        ],
        sell_summary: [
          { amount: 500, orders: 9, pricePerUnit: bid },
          { amount: 2500, orders: 18, pricePerUnit: bid * 0.98 },
        ],
        quick_status: {
          buyVolume: 15000,
          sellVolume: 12000,
          buyOrders: 120,
          sellOrders: 98,
          buyMovingWeek: activity,
          sellMovingWeek: activity * 0.8,
        },
      },
      Date.now() - 15000,
      Date.now(),
      { name, category, tier },
    ),
    feeContext: {
      mayor: "Fixture",
      multiplier: 1,
      checkedAt: Date.now(),
      explanation: "Explicit fixture standard-tax assumption.",
    },
  }));
}
export function auctionFixtures(f: AuctionFilters, page: number) {
  const now = Date.now();
  const variant: ItemVariant = {
    version: 1,
    fingerprint: "v1_fixture_livid",
    itemId: "LIVID_DAGGER",
    name: "Livid Dagger",
    quantity: 1,
    rarity: "LEGENDARY",
    category: "sword",
    enchantments: { sharpness: 6, critical: 6, ultimate_soul_eater: 3 },
    modifiers: { modifier: "fabled", upgrade_level: 5, hot_potato_count: 10 },
    complete: true,
    issues: [],
  };
  const listing: Listing = {
    id: "0123456789abcdef0123456789abcdef",
    sellerName: "DemoSeller",
    variant,
    price: 2400000,
    start: now - 300000,
    end: now + 3600000,
    upstreamAt: now - 12000,
    observedAt: now,
    status: "active",
  };
  const peers: Listing[] = Array.from({ length: 16 }, (_, i) => ({
    ...listing,
    id: "fixture-" + i,
    seller: "seller-" + i,
    price: 3200000 + i * 5000,
  }));
  const health: CollectorHealth = {
    mode: "local",
    startedAt: now - 86400000,
    lastEndedSuccess: now,
    lastActiveSuccess: now,
    endedUpstreamAt: now,
    activeUpstreamAt: now,
    missedMs: 0,
    gaps: [],
    saleCount: 0,
    variantCount: 1,
    listingCount: 1,
    rejectedCount: 0,
    error: null,
    scope: [],
    writesToday: 0,
    writeLimit: 12000,
  };
  return {
    ...activePage([listing, ...peers], f, page, now, {
      mayor: "Fixture",
      multiplier: 1,
      checkedAt: now,
      explanation: "Explicit fixture standard-tax assumption.",
    }),
    health,
  };
}

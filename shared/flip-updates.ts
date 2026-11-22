import { historyDay } from "./daily-price-history";

// Reviewed source records. Keep proposals distinct from the values observed on main.
export const previewDay = historyDay(Date.UTC(2026, 9, 29, 12));
export const releaseDay = historyDay(Date.UTC(2026, 10, 17, 12));
export const economyUpdate = {
  id: "skyblock-0.27.3",
  preview:
    "https://hypixel.net/threads/october-29-accessory-bag-revamp-economy-changes.6165308/",
  candidate:
    "https://hypixel.net/threads/november-10-0-27-3-release-candidate.6171140/",
  release:
    "https://hypixel.net/threads/hypixel-skyblock-0-27-3-magic-find-rework-accessory-bag-revamp-and-more.6169127/",
  itemApi: "https://api.hypixel.net/v2/resources/skyblock/items",
  snapshotDiff:
    "https://hypixelskyblock.minecraft.wiki/w/Special:Diff/870771/874118",
  previewDay,
  releaseDay,
  candidateDay: historyDay(Date.UTC(2026, 10, 10, 12)),
  // Base crop NPC payouts in the public October 29 proposal. The release diff
  // lives in the collector's item registry, including crafted/compressed forms.
  proposed: {
    WHEAT: 2.5,
    SEEDS: 1,
    CARROT_ITEM: 2,
    POTATO_ITEM: 2,
    PUMPKIN: 4.5,
    MELON: 1,
    SUGAR_CANE: 2.5,
    CACTUS: 2.5,
    "INK_SACK:3": 1.5,
    RED_MUSHROOM: 5,
    BROWN_MUSHROOM: 5,
    NETHER_STALK: 2,
    DOUBLE_PLANT: 3,
    MOONFLOWER: 3,
    WILD_ROSE: 3,
  } as Record<string, number>,
};

export const grassMechanics = {
  source: "https://hypixelskyblock.minecraft.wiki/w/Overgrown_Grass",
  substituteSource: "https://hypixelskyblock.minecraft.wiki/w/SkyMart_Brochure",
  supply: [
    {
      from: "Garden Visitors",
      to: "OVERGROWN_GRASS",
      kind: "reward",
      chance: 0.001,
    },
    {
      from: "Harvest Bounty",
      to: "OVERGROWN_GRASS",
      kind: "drop",
      chance: 0.001,
    },
  ],
  demand: {
    activity: "Crop farming",
    benefit: "Farming Fortune",
    reforge: "Mossy",
    item: "OVERGROWN_GRASS",
  },
  substitute: { item: "SKYMART_BROCHURE", reforge: "Bustling", slot: "Armor" },
  related: ["SKYMART_BROCHURE", "BLESSED_FRUIT"],
  controls: ["ENCHANTED_REDSTONE", "ENCHANTED_COAL"],
};
// These supply and demand links are reviewed with the release. A shared item
// category is never an economic link.
export const automatonSupply = {
  source: "Automaton",
  kind: "drop",
  rate: 0.05,
  direction: "increased supply",
  day: releaseDay,
  notes: economyUpdate.release,
  items: [
    "SYNTHETIC_HEART",
    "CONTROL_SWITCH",
    "SUPERLITE_MOTOR",
    "ROBOTRON_REFLECTOR",
    "FTX_3070",
    "ELECTRON_TRANSMITTER",
  ],
};
export const compressedCrop: Record<string, { base: string; units: number }> = {
  ENCHANTED_MELON: { base: "MELON", units: 160 },
  ENCHANTED_MELON_BLOCK: { base: "MELON", units: 25600 },
  BOX_OF_SEEDS: { base: "SEEDS", units: 25600 },
};
export type PriceComparison = {
  id: string;
  before: number;
  after: number;
  pct: number;
};
export type MarketEffect = {
  kind: "demand" | "unknown";
  onset?: number;
  confirmedOn?: number;
  reference?: number;
  recent?: number;
  observations: number;
  cutoff?: number;
  comparisons?: PriceComparison[];
  beforeCount?: number;
  lastBefore?: number;
  releaseWindow?: { before: number; after: number; pct: number | null };
};

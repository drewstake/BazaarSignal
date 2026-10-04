import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type {
  ItemVariant,
  Json,
  Listing,
} from "../shared/companion/types";
import { decodeNbt } from "./nbt";
import { categoryFor } from "../shared/companion/bazaar";

export type Catalog = Record<
  string,
  { name?: string; tier?: string; category?: string }
>;
export const stable = (v: unknown): string => JSON.stringify(canonical(v));
function canonical(v: unknown): Json {
  if (v === null || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, canonical(x)]),
    );
  throw new Error("Invalid normalized value");
}
const identity = new Set([
  "uuid",
  "timestamp",
  "originTag",
  "spawnedFor",
  "bossId",
]);
const recognized = new Set([
  "id",
  "enchantments",
  "modifier",
  "rarity_upgrades",
  "dungeon_item",
  "dungeon_item_level",
  "upgrade_level",
  "hot_potato_count",
  "gems",
  "attributes",
  "petInfo",
  "art_of_war_count",
  "art_of_peace_count",
  "wood_singularity_count",
  "ethermerge",
  "ability_scroll",
  "talisman_enrichment",
  "drill_part_engine",
  "drill_part_fuel_tank",
  "drill_part_upgrade_module",
  "drill_fuel",
  "skin",
  "color",
  "runes",
  "winning_bid",
  "new_years_cake",
  "edition",
  "party_hat_color",
  "baseStatBoostPercentage",
  "item_tier",
  "donated_museum",
  "soulbound",
]);
const tiers = [
  "COMMON",
  "UNCOMMON",
  "RARE",
  "EPIC",
  "LEGENDARY",
  "MYTHIC",
  "DIVINE",
  "SPECIAL",
  "VERY_SPECIAL",
];
export function normalizeVariant(
  root: Record<string, unknown>,
  catalog: Catalog = {},
): ItemVariant {
  const items = root.i;
  if (!Array.isArray(items) || items.length !== 1)
    throw new Error("Expected exactly one auction stack");
  const item = items[0] as any,
    extra = item?.tag?.ExtraAttributes;
  if (
    !extra ||
    typeof extra.id !== "string" ||
    !/^[A-Z0-9_:\-]{1,100}$/.test(extra.id)
  )
    throw new Error("Missing stable SkyBlock item ID");
  const quantity = item.Count;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 127)
    throw new Error("Invalid item quantity");
  const issues: string[] = [],
    modifiers: Record<string, Json> = Object.create(null),
    enchantments: Record<string, number> = Object.create(null);
  if (
    extra.enchantments !== undefined &&
    (!extra.enchantments ||
      typeof extra.enchantments !== "object" ||
      Array.isArray(extra.enchantments))
  )
    throw new Error("Invalid enchantments");
  for (const [k, v] of Object.entries(extra.enchantments ?? {})) {
    if (!Number.isSafeInteger(v) || (v as number) < 1 || (v as number) > 255)
      throw new Error("Invalid enchantment level");
    enchantments[k] = v as number;
  }
  for (const [k, v] of Object.entries(extra)) {
    if (identity.has(k) || k === "id" || k === "enchantments") continue;
    if (k === "petInfo") {
      const pet = typeof v === "string" ? JSON.parse(v) : v;
      if (
        !pet ||
        typeof pet.type !== "string" ||
        typeof pet.tier !== "string" ||
        !Number.isFinite(pet.exp)
      )
        throw new Error("Incomplete pet configuration");
      modifiers[k] = canonical(
        Object.fromEntries(
          Object.entries(pet).filter(
            ([key]) => !["uuid", "active", "uniqueId"].includes(key),
          ),
        ),
      );
    } else modifiers[k] = canonical(v);
    if (!recognized.has(k))
      issues.push(
        `Unsupported modifier ${k}; retained in fingerprint, valuation withheld.`,
      );
  }
  // Preserve non-ExtraAttributes tags too, except presentation/identity fields.
  if (item.Damage) modifiers.vanillaDamage = canonical(item.Damage);
  if (item.tag?.display?.color !== undefined)
    modifiers.armorDisplayColor = canonical(item.tag.display.color);
  if (item.tag?.SkullOwner?.Properties?.textures) {
    try {
      const textures = item.tag.SkullOwner.Properties.textures.map(
        (x: any) =>
          JSON.parse(
            new TextDecoder().decode(
              Uint8Array.from(atob(x.Value), (c) => c.charCodeAt(0)),
            ),
          ).textures,
      );
      modifiers.headTextures = canonical(textures);
    } catch {
      issues.push("Head texture could not be decoded; valuation withheld.");
    }
  }
  for (const [k, v] of Object.entries(item.tag ?? {}))
    if (
      ![
        "ExtraAttributes",
        "display",
        "SkullOwner",
        "HideFlags",
        "ench",
      ].includes(k)
    ) {
      modifiers[`nbt:${k}`] = canonical(v);
      issues.push(`Unsupported NBT field ${k}; valuation withheld.`);
    }
  const info = catalog[extra.id];
  let rarity = info?.tier ?? "UNKNOWN";
  if (
    extra.rarity_upgrades !== undefined &&
    ![0, 1].includes(extra.rarity_upgrades)
  )
    throw new Error("Unsupported rarity upgrade count");
  if (
    extra.rarity_upgrades &&
    tiers.indexOf(rarity) >= 0 &&
    tiers.indexOf(rarity) < 6
  )
    rarity =
      tiers[Math.min(6, tiers.indexOf(rarity) + Number(extra.rarity_upgrades))];
  if (modifiers.petInfo)
    rarity = (modifiers.petInfo as Record<string, Json>).tier as string;
  if (!tiers.includes(rarity))
    issues.push("Base rarity unavailable from the item catalog.");
  const config = {
    version: 1,
    itemId: extra.id,
    quantity,
    rarity,
    enchantments,
    modifiers,
  };
  return {
    ...config,
    version: 1,
    name: (info?.name ?? item.tag?.display?.Name ?? extra.id).replace(
      /§./g,
      "",
    ),
    category: categoryFor(extra.id, info?.category),
    fingerprint: `v1_${bytesToHex(sha256(new TextEncoder().encode(stable(config))))}`,
    complete: issues.length === 0,
    issues,
  };
}
export function decodeVariant(bytes: unknown, catalog: Catalog = {}) {
  return normalizeVariant(decodeNbt(bytes), catalog);
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{32}$/i.test(v);
export function normalizeListing(
  raw: any,
  upstreamAt: number,
  observedAt: number,
  catalog: Catalog,
): Listing | null {
  if (
    raw.bin !== true ||
    !uuid(raw.uuid) ||
    raw.claimed ||
    raw.highest_bid_amount > 0 ||
    raw.bids?.length ||
    !Number.isFinite(raw.starting_bid) ||
    raw.starting_bid <= 0 ||
    !Number.isFinite(raw.start) ||
    !Number.isFinite(raw.end) ||
    raw.end <= observedAt
  )
    return null;
  return {
    id: raw.uuid,
    ...(uuid(raw.auctioneer) ? { seller: raw.auctioneer.toLowerCase() } : {}),
    variant: decodeVariant(raw.item_bytes, catalog),
    price: raw.starting_bid,
    start: raw.start,
    end: raw.end,
    upstreamAt,
    observedAt,
    status: "active",
  };
}

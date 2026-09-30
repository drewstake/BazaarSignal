import { ArrowRight, Info, Minus, Plus } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* Sky Island Market icon pack (public/assets/sky-island-v1)           */
/* ------------------------------------------------------------------ */
// Web-sized copies from scripts/build-sky-icons.py keep each original canvas,
// transparent padding and aspect ratio; the full-size originals sit beside them.
const SKY = "/assets/sky-island-v1/web";
export type SkyIconName =
  | "emerald"
  | "bazaar-crate"
  | "auction-gavel"
  | "watchlist-chest"
  | "favorite-heart"
  | "gold-coin"
  | "deal-crown"
  | "hot-flame"
  | "favorite-star"
  | "alert-bell";
/**
 * Interface icon from the pack. Decorative by default (empty alt beside a
 * visible label); pass `label` when the icon stands alone.
 */
export function SkyIcon({
  name,
  size = 32,
  className = "",
  label,
}: {
  name: SkyIconName;
  size?: number;
  className?: string;
  label?: string;
}) {
  const base = `${SKY}/ui-${name}`;
  return (
    <img
      className={`sky-icon sky-${name} ${className}`}
      src={`${base}-64.png`}
      srcSet={`${base}-64.png 64w, ${base}-128.png 128w`}
      sizes={`${size}px`}
      width={size}
      height={size}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      decoding="async"
      draggable={false}
    />
  );
}
export const compact = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n);
export const whole = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : Math.abs(n) >= 1e10
      ? compact(n)
      : Math.round(n).toLocaleString("en-US");
export const percent = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
export const exact = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
export const titleCase = (v: string) =>
  v
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
export function Coin({
  value,
  full = false,
  positive = false,
}: {
  value: number | null | undefined;
  full?: boolean;
  positive?: boolean;
}) {
  return (
    <span className="coin-value" title={`${exact(value)} coins`}>
      {positive && value != null && value > 0 ? "+" : ""}
      {full ? exact(value) : whole(value)}
      <img
        className="coin"
        src={`${SKY}/ui-gold-coin-64.png`}
        alt="coins"
        width={16}
        height={16}
        decoding="async"
        draggable={false}
      />
    </span>
  );
}
/**
 * Pack illustrations, each mapped to the one item it was drawn for. Enchanted
 * books share a single in-game look, so every ENCHANTMENT_* product uses the
 * book. These are concept illustrations, not official item textures.
 */
const packItems: Record<string, { file: string; glow: string }> = {
  SUMMONING_EYE: { file: "item-summoning-eye", glow: "#b04dff" },
  ENCHANTED_DIAMOND_BLOCK: { file: "item-diamond-block", glow: "#39d5ff" },
  BOOSTER_COOKIE: { file: "item-golden-cookie", glow: "#ffb62e" },
  DIAMOND_SWORD: { file: "item-enchanted-sword", glow: "#4aa8ff" },
  NECRON_HANDLE: { file: "item-necrons-handle", glow: "#a64dff" },
  ENCHANTED_BOOK: { file: "item-enchanted-book", glow: "#ff3d9a" },
};
const packItem = (id: string) =>
  packItems[id] ??
  (id.startsWith("ENCHANTMENT_") ? packItems.ENCHANTED_BOOK : undefined);
/** Weapons, armour, tools and accessories have no matching stand-in art. */
const gear =
  /(^|_)(SWORD|DAGGER|BLADE|KATANA|BOW|HELMET|CHESTPLATE|LEGGINGS|BOOTS|HOE|SPADE|SHOVEL|PICKAXE|DRILL|AXE|BELT|NECKLACE|CLOAK|GLOVES|BRACELET|GAUNTLET|ARTIFACT|RING|TALISMAN|RELIC|WAND|STAFF|SCYTHE|SHEARS|HAT|MASK|SHIELD)(_|$)/;
/**
 * Atlas cell for items the pack does not cover. Category stand-ins for Bazaar
 * materials; everything else uses the neutral chest. Never official textures.
 */
export function artSlot(id: string) {
  if (id === "CHEST" || gear.test(id)) return 11;
  if (id.startsWith("SHARD_"))
    return [2, 8, 9, 10][
      Array.from(id).reduce((n, c) => n + c.charCodeAt(0), 0) % 4
    ];
  return /COOKIE/.test(id)
    ? 1
    : /^(ENCHANTED_)?DIAMOND(_BLOCK)?$/.test(id)
      ? 2
      : /BLAZE/.test(id)
        ? 4
        : /SUGAR|WHEAT|CARROT|ROOT|CROP|LEAF|FLOWER/.test(id)
          ? 5
          : /GOLD/.test(id)
            ? 6
            : /IRON/.test(id)
              ? 7
              : /EMERALD/.test(id)
                ? 8
                : /LAPIS/.test(id)
                  ? 9
                  : /PEARL|JUICE|POTION/.test(id)
                    ? 10
                    : 11;
}
const glows = [
  "#b04dff", // eye
  "#ffb62e", // cookie
  "#39d5ff", // diamond
  "#ff3d6e", // book
  "#ff7a1f", // blaze
  "#6bdc3c", // sugar cane
  "#ffcf2e", // gold
  "#c9d3e0", // iron
  "#2ee07a", // emerald
  "#3d7bff", // lapis
  "#27d8c4", // pearl
  "#ffae4a", // chest
];
/** Inline style that tints an art panel with the item's glow colour. */
export const artGlow = (id: string) =>
  ({
    "--glow": packItem(id)?.glow ?? glows[artSlot(id)],
  }) as CSSProperties;
const artSizes = { small: "64px", normal: "128px", hero: "260px" };
export function ItemArt({
  id,
  size = "normal",
}: {
  id: string;
  size?: "small" | "normal" | "hero";
}) {
  const pack = packItem(id);
  if (pack) {
    const base = `${SKY}/${pack.file}`;
    return (
      <img
        className={`item-art pack ${size}`}
        src={`${base}-256.png`}
        srcSet={`${base}-256.png 256w, ${base}-512.png 512w`}
        sizes={artSizes[size]}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    );
  }
  const slot = artSlot(id);
  return (
    <span
      className={`item-art ${size}`}
      aria-hidden="true"
      style={{
        backgroundPosition: `${((slot % 4) * 100) / 3}% ${Math.floor(slot / 4) * 50}%`,
      }}
    />
  );
}
export function RarityRibbon({ rarity }: { rarity: string }) {
  return (
    <span className={`rarity rarity-${rarity.toLowerCase()}`}>
      {titleCase(rarity)}
    </span>
  );
}
export function Tip({ text }: { text: string }) {
  return (
    <span className="tip" tabIndex={0} aria-label={text}>
      <Info size={13} />
      <span role="tooltip">{text}</span>
    </span>
  );
}
export function NumberField({
  label,
  value,
  onChange,
  tip,
  min = 0,
  step = "any",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  tip?: string;
  min?: number;
  step?: string;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {tip && <Tip text={tip} />}
      </span>
      <input
        type="number"
        min={min}
        step={step}
        value={Number.isNaN(value) ? "" : value}
        onChange={(e) =>
          onChange(e.target.value === "" ? NaN : Number(e.target.value))
        }
      />
    </label>
  );
}
export function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}
export function Quantity({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="quantity-control">
      <span>Planned quantity</span>
      <span className="stepper">
        <button
          aria-label="Decrease quantity"
          onClick={() => onChange(Math.max(1, value - 1))}
        >
          <Minus size={14} />
        </button>
        <input
          aria-label="Inspector quantity"
          type="number"
          min="1"
          step="1"
          value={Number.isNaN(value) ? "" : value}
          onChange={(e) =>
            onChange(e.target.value === "" ? NaN : Number(e.target.value))
          }
        />
        <button
          aria-label="Increase quantity"
          onClick={() => onChange(value + 1)}
        >
          <Plus size={14} />
        </button>
      </span>
    </label>
  );
}
const comparisonLabels = {
  card: ["Buy", "Sell", "Profit"],
  feature: ["Buy cost", "Resale estimate", "Expected profit"],
  detail: ["Buy cost", "Resale estimate", "Expected profit"],
} as const;
export function PriceComparison({
  buy,
  sell,
  profit,
  roi,
  full = false,
  variant = "detail",
}: {
  buy: number | null;
  sell: number | null;
  profit: number | null;
  roi: number | null;
  full?: boolean;
  variant?: keyof typeof comparisonLabels;
}) {
  const [buyLabel, sellLabel, profitLabel] = comparisonLabels[variant];
  return (
    <div className={`price-comparison ${variant}`}>
      <div>
        <span>{buyLabel}</span>
        <Coin value={buy} full={full} />
      </div>
      <div>
        <span>{sellLabel}</span>
        <Coin value={sell} full={full} />
      </div>
      <div
        className={`profit-line ${profit !== null && profit < 0 ? "negative" : ""}`}
      >
        <span>{profitLabel}</span>
        <strong>
          <Coin value={profit} full={full} positive />
          {roi !== null && (
            <small title="Return on investment">
              {variant === "card" ? percent(roi) : `(${percent(roi)})`}
              <span className="sr-only"> ROI</span>
            </small>
          )}
        </strong>
      </div>
    </div>
  );
}
export function ItemCard({
  id,
  name,
  rarity,
  category,
  buy,
  sell,
  profit,
  roi,
  badge,
  selected,
  saved,
  onOpen,
  onSave,
  subtitle,
  warning,
}: {
  id: string;
  name: string;
  rarity: string;
  category: string;
  buy: number | null;
  sell: number | null;
  profit: number | null;
  roi: number | null;
  badge: string;
  selected: boolean;
  saved: boolean;
  onOpen: () => void;
  onSave: () => void;
  subtitle: ReactNode;
  warning?: string;
}) {
  return (
    <article
      className={`market-card ${selected ? "selected" : ""}`}
      aria-label={`${name} opportunity`}
    >
      <div className="card-art" style={artGlow(id)}>
        <RarityRibbon rarity={rarity} />
        <button
          className={`save-icon ${saved ? "is-saved" : ""}`}
          onClick={onSave}
          aria-label={`${saved ? "Remove" : "Save"} ${name}`}
          aria-pressed={saved}
        >
          <SkyIcon name="favorite-star" size={26} />
        </button>
        <ItemArt id={id} />
        <span className="art-badge">{badge}</span>
        <span className="art-spark one" aria-hidden="true" />
        <span className="art-spark two" aria-hidden="true" />
      </div>
      <div className="card-content">
        <span className="item-category">
          {titleCase(category)} <span>• {badge}</span>
        </span>
        <h3>{name}</h3>
        <p className="card-subtitle">{subtitle}</p>
        {warning && <p className="card-warning">{warning}</p>}
        <PriceComparison
          buy={buy}
          sell={sell}
          profit={profit}
          roi={roi}
          variant="card"
        />
        <button
          className="button blue"
          onClick={onOpen}
          aria-label={`Inspect ${name}`}
        >
          View Deal <ArrowRight size={16} strokeWidth={2.6} />
        </button>
      </div>
    </article>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <SkyIcon name="watchlist-chest" size={88} className="empty-chest" />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function LoadingState() {
  return (
    <div className="loading-grid" role="status" aria-label="Loading market">
      {Array.from({ length: 6 }, (_, i) => (
        <div className="skeleton" key={i} />
      ))}
      <span className="sr-only">Loading market…</span>
    </div>
  );
}
export function EnchantmentList({
  enchants,
}: {
  enchants: Record<string, number>;
}) {
  return (
    <div className="enchantments">
      {Object.entries(enchants)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, level]) => (
          <span
            key={name}
            className={name.startsWith("ultimate_") ? "ultimate" : ""}
          >
            {titleCase(name)} <b>{level}</b>
          </span>
        ))}
      {!Object.keys(enchants).length && (
        <p>No enchantments in structured item data.</p>
      )}
    </div>
  );
}

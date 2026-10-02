import { RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import type {
  AuctionFilters,
  BazaarFilters,
} from "../../shared/companion/types";
import { strategyLabels } from "../../shared/companion/bazaar";
import { NumberField, SelectField, titleCase } from "./components";
export function BazaarFilterBar({
  f,
  set,
  categories,
  reset,
  save,
}: {
  f: BazaarFilters;
  set: (patch: Partial<BazaarFilters>) => void;
  categories: string[];
  reset: () => void;
  save: () => void;
}) {
  return (
    <section className="filter-panel" aria-label="Bazaar filters">
      <div className="quick-filters">
        <SelectField
          label="Category"
          value={f.category}
          onChange={(category) => set({ category })}
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </SelectField>
        <SelectField
          label="Strategy"
          value={f.strategy}
          onChange={(strategy) =>
            set({ strategy: strategy as BazaarFilters["strategy"] })
          }
        >
          {Object.entries(strategyLabels).map(([id, label]) => (
            <option value={id} key={id}>
              {label}
            </option>
          ))}
        </SelectField>
        <NumberField
          label="Budget · coins"
          value={f.budget}
          onChange={(budget) => set({ budget })}
        />
        <NumberField
          label="Quantity"
          value={f.quantity}
          min={1}
          step="1"
          onChange={(quantity) => set({ quantity })}
        />
        <details className="advanced-filters">
          <summary>
            <SlidersHorizontal size={16} /> More filters
          </summary>
          <div className="advanced-grid">
            <NumberField
              label="Minimum net profit"
              value={f.minProfit}
              onChange={(minProfit) => set({ minProfit })}
            />
            <NumberField
              label="Minimum ROI (%)"
              value={f.minRoi}
              onChange={(minRoi) => set({ minRoi })}
            />
            <NumberField
              label="Minimum instant-buy activity"
              value={f.minBuyActivity}
              onChange={(minBuyActivity) => set({ minBuyActivity })}
              tip="Reported buyMovingWeek: 7-day transacted units plus live state, not today's completed trades."
            />
            <NumberField
              label="Minimum instant-sell activity"
              value={f.minSellActivity}
              onChange={(minSellActivity) => set({ minSellActivity })}
              tip="Reported sellMovingWeek: 7-day transacted units plus live state."
            />
            <NumberField
              label="Minimum activity on both sides"
              value={f.minBothActivity}
              onChange={(minBothActivity) => set({ minBothActivity })}
            />
            <NumberField
              label="Maximum activity share (%)"
              value={f.maxActivityShare}
              onChange={(maxActivityShare) => set({ maxActivityShare })}
              tip="Quantity divided by the weaker 7-day activity proxy. This is a sizing check, not a fill-time prediction."
            />
            <NumberField
              label="Minimum visible depth"
              value={f.minDepth}
              onChange={(minDepth) => set({ minDepth })}
              tip="Minimum units across the visible asks and bids. Passive orders still compete with other players."
            />
            <NumberField
              label="Fresh recommendation age (seconds)"
              value={f.maxAgeSeconds}
              onChange={(maxAgeSeconds) => set({ maxAgeSeconds })}
                tip="Fresh recommendations require data at most 180 seconds old. Older samples remain browsable as historical estimates."
            />
            <SelectField
              label="Liquidity"
              value={f.liquidity}
              onChange={(liquidity) =>
                set({ liquidity: liquidity as BazaarFilters["liquidity"] })
              }
            >
              <option value="balanced">Balanced or strong</option>
              <option value="strong">Strong only</option>
              <option value="all">Include thin markets</option>
            </SelectField>
            <SelectField
              label="Bazaar sale tax"
              value={String(f.taxPercent)}
              onChange={(taxPercent) => set({ taxPercent: Number(taxPercent) })}
            >
              <option value="1.25">Standard · 1.25%</option>
              <option value="1.125">Flipper I · 1.125%</option>
              <option value="1">Flipper II · 1%</option>
            </SelectField>
            <NumberField
              label="Additional execution cost"
              value={f.executionCost}
              onChange={(executionCost) => set({ executionCost })}
              tip="Optional total cost, in coins, on top of order-book slippage and sale tax."
            />
          </div>
        </details>
      </div>
      <div className="filter-foot">
        <span className="active-chip">
          {f.minBothActivity.toLocaleString()}+ activity / side
        </span>
        <span className="active-chip">
          ≤ {f.maxActivityShare}% market share
        </span>
        <span className="active-chip">{f.taxPercent}% sale tax</span>
        <div className="filter-actions">
          <button onClick={save}>
            <Save size={13} />
            Save filters
          </button>
          <button onClick={reset}>
            <RotateCcw size={13} />
            Reset
          </button>
        </div>
      </div>
    </section>
  );
}
export function AuctionFilterBar({
  f,
  set,
  reset,
  save,
}: {
  f: AuctionFilters;
  set: (patch: Partial<AuctionFilters>) => void;
  reset: () => void;
  save: () => void;
}) {
  return (
    <section className="filter-panel" aria-label="Auction filters">
      <div className="quick-filters">
        <SelectField
          label="Category"
          value={f.category}
          onChange={(category) => set({ category })}
        >
          <option value="all">All categories</option>
          {[
            "sword",
            "bow",
            "helmet",
            "chestplate",
            "leggings",
            "boots",
            "accessory",
            "pet",
            "other",
          ].map((c) => (
            <option key={c} value={c}>
              {titleCase(c)}
            </option>
          ))}
        </SelectField>
        <NumberField
          label="Maximum purchase price"
          value={f.budget}
          onChange={(budget) => set({ budget })}
        />
        <SelectField
          label="Minimum comparison confidence"
          value={f.confidence}
          onChange={(confidence) =>
            set({ confidence: confidence as AuctionFilters["confidence"] })
          }
        >
          {["high", "medium", "low", "insufficient"].map((c) => (
            <option key={c} value={c}>
              {titleCase(c)}
            </option>
          ))}
        </SelectField>
        <details className="advanced-filters">
          <summary>
            <SlidersHorizontal size={16} /> More filters
          </summary>
          <div className="advanced-grid">
            <NumberField
              label="Minimum after-fee gap"
              value={f.minProfit}
              onChange={(minProfit) => set({ minProfit })}
            />
            <NumberField
              label="Minimum gap / cost (%)"
              value={f.minRoi}
              onChange={(minRoi) => set({ minRoi })}
            />
            <NumberField
              label="Minimum matching listings"
              value={f.minComps}
              step="1"
              onChange={(minComps) => set({ minComps })}
            />
            <SelectField
              label="Rarity"
              value={f.rarity}
              onChange={(rarity) => set({ rarity })}
            >
              <option value="all">All rarities</option>
              {[
                "COMMON",
                "UNCOMMON",
                "RARE",
                "EPIC",
                "LEGENDARY",
                "MYTHIC",
                "DIVINE",
                "SPECIAL",
                "VERY_SPECIAL",
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </SelectField>
            <label className="field">
              <span>Required enchantment</span>
              <input
                value={f.requiredEnchant}
                placeholder="e.g. sharpness"
                onChange={(e) => set({ requiredEnchant: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Excluded enchantment</span>
              <input
                value={f.excludedEnchant}
                placeholder="e.g. ultimate_one_for_all"
                onChange={(e) => set({ excludedEnchant: e.target.value })}
              />
            </label>
            <NumberField
              label="Enchantment minimum level"
              min={1}
              step="1"
              value={f.enchantLevel}
              onChange={(enchantLevel) => set({ enchantLevel })}
            />
            <label className="field">
              <span>Required upgrade or modifier</span>
              <input
                value={f.upgrade}
                placeholder="e.g. fabled"
                onChange={(e) => set({ upgrade: e.target.value })}
              />
            </label>
            <NumberField
              label="Maximum listing age (minutes)"
              value={f.maxAgeMinutes}
              onChange={(maxAgeMinutes) => set({ maxAgeMinutes })}
            />
            <SelectField
              label="Resale listing duration"
              value={String(f.durationHours)}
              onChange={(durationHours) =>
                set({ durationHours: Number(durationHours) })
              }
            >
              {[1, 6, 12, 24, 48].map((h) => (
                <option value={h} key={h}>
                  {h} hours
                </option>
              ))}
            </SelectField>
            <label className="check-field">
              <input
                type="checkbox"
                checked={f.hideFlagged}
                onChange={(e) => set({ hideFlagged: e.target.checked })}
              />
              Hide flagged configurations
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={f.showInsufficient}
                onChange={(e) => set({ showInsufficient: e.target.checked })}
              />
              Show items with insufficient evidence
            </label>
          </div>
        </details>
      </div>
      <div className="filter-foot">
        <span className="active-chip">Buy It Now only</span>
        <span className="active-chip">{f.minComps}+ matching listings</span>
        <span className="active-chip">
          {titleCase(f.confidence)}+ confidence
        </span>
        {f.excludedEnchant && (
          <span className="active-chip">Exclude {f.excludedEnchant}</span>
        )}
        <div className="filter-actions">
          <button onClick={save}>
            <Save size={13} />
            Save filters
          </button>
          <button onClick={reset}>
            <RotateCcw size={13} />
            Reset
          </button>
        </div>
      </div>
    </section>
  );
}

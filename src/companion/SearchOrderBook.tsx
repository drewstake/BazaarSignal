import type { CSSProperties } from "react";
import type { Level } from "../../shared/model";
import { bookSideSummary } from "./bazaar-search-data";
import { exact } from "./components";

/** Render only the selected item's downloaded levels. No requests or polling. */
export default function SearchOrderBook({
  asks,
  bids,
}: {
  asks: Level[];
  bids: Level[];
}) {
  const validAsks = bookSideSummary(asks, "buy") !== null;
  const validBids = bookSideSummary(bids, "sell") !== null;
  // One quantity scale across both sides makes equal volumes equally wide.
  const maxVolume = Math.max(
    0,
    ...(validAsks ? asks.map((level) => level.amount) : []),
    ...(validBids ? bids.map((level) => level.amount) : []),
  );
  return (
    <div className="bazaar-search-book">
      <div className="bazaar-search-book-heading">
        <h2>Order book</h2>
        <p className="bazaar-search-caption">Coins per item · Before fees</p>
      </div>
      <div className="bazaar-search-book-columns">
        <BookSide source={asks} side="buy" maxVolume={maxVolume} />
        <BookSide source={bids} side="sell" maxVolume={maxVolume} />
      </div>
      <details className="bazaar-book-notes">
        <summary>About this data</summary>
        <p>
          Checks cached data hourly while visible; prices may have changed. All returned levels are
          shown, best prices first. The full market may have more depth.
        </p>
        <p>
          Bars show the item quantity at each price, using the same scale for
          both sides.
        </p>
      </details>
    </div>
  );
}

function BookSide({
  source,
  side,
  maxVolume,
}: {
  source: Level[];
  side: "buy" | "sell";
  maxVolume: number;
}) {
  const valid = bookSideSummary(source, side) !== null;
  const levels = valid
    ? [...source].sort((a, b) =>
        side === "buy"
          ? a.pricePerUnit - b.pricePerUnit
          : b.pricePerUnit - a.pricePerUnit,
      )
    : [];
  const name = side === "buy" ? "Sell offers" : "Buy orders";
  return (
    <div className={`bazaar-search-book-side is-${side}`}>
      <h3>{name}</h3>
      {!valid ? (
        <p className="bazaar-search-error">{name} unavailable.</p>
      ) : !levels.length ? (
        <p className="bazaar-search-caption">
          No {name.toLowerCase()} in this snapshot.
        </p>
      ) : (
        <table aria-label={name}>
          <thead>
            <tr>
              <th scope="col">Price</th>
              <th scope="col">Items</th>
              <th scope="col">Orders</th>
            </tr>
          </thead>
          <tbody>
            {levels.map((level, index) => (
              <tr
                key={index}
                style={
                  {
                    "--level-volume": `${maxVolume > 0 ? (level.amount / maxVolume) * 100 : 0}%`,
                  } as CSSProperties
                }
              >
                <td>{exact(level.pricePerUnit)}</td>
                <td>{exact(level.amount)}</td>
                <td>{exact(level.orders)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

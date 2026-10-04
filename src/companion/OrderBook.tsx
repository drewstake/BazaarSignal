import type { BazaarItem } from "../../shared/companion/types";
import { SampleTime } from "../SampleTime";
import { Coin, exact } from "./components";

/** Displays every saved price level without fetching more data. */
export function BazaarOrderBook({ item }: { item: BazaarItem }) {
  const bid = item.bids[0]?.pricePerUnit;
  const ask = item.asks[0]?.pricePerUnit;
  const spread = bid !== undefined && ask !== undefined ? ask - bid : null;
  const largestQuantity = Math.max(
    0,
    ...item.bids.map((level) => level.amount),
    ...item.asks.map((level) => level.amount),
  );

  return (
    <section
      className="inspector-section level-book"
      aria-label="L2 order book"
    >
      <div className="level-book-heading">
        <h4>L2 order book</h4>
        <span>
          Spread:{" "}
          <strong>{spread === null ? "—" : `${exact(spread)} coins`}</strong>
        </span>
      </div>
      <p className="level-book-time">
        <SampleTime timestamp={item.upstreamAt} compact />
      </p>
      <div className="level-book-sides">
        {(
          [
            {
              side: "bids",
              title: "Buy orders",
              hint: "Bids · instant-sell",
              levels: item.bids,
            },
            {
              side: "asks",
              title: "Sell offers",
              hint: "Asks · instant-buy",
              levels: item.asks,
            },
          ] as const
        ).map(({ side, title, hint, levels }) => (
          <div className={`level-book-side ${side}`} key={side}>
            <div className="level-book-side-heading">
              <h5>{title}</h5>
              <span>{hint}</span>
            </div>
            <dl className="level-book-total">
              <div>
                <dt>Total value (shown)</dt>
                <dd>
                  <Coin
                    value={levels.reduce(
                      (total, level) => total + level.amount * level.pricePerUnit,
                      0,
                    )}
                    full
                  />
                </dd>
              </div>
            </dl>
            {levels.length > 0 ? (
              <table aria-label={title}>
                <thead>
                  <tr>
                    <th scope="col">Price / item</th>
                    <th scope="col">Quantity</th>
                    <th scope="col">Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {levels.map((level, index) => (
                    <tr
                      key={`${level.pricePerUnit}-${index}`}
                      title={`${exact(level.amount)} items across ${exact(level.orders)} orders at this price`}
                      style={{
                        backgroundSize: `${largestQuantity ? (level.amount / largestQuantity) * 100 : 0}% 100%`,
                      }}
                    >
                      <td>{exact(level.pricePerUnit)}</td>
                      <td>{exact(level.amount)}</td>
                      <td>{exact(level.orders)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="level-book-empty">
                No sampled {title.toLowerCase()}.
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Book, Level } from "../shared/model";
import { isFresh } from "../shared/market";
const number = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function OrderBook({
  book,
  timestamp,
  error,
}: {
  book: Book | undefined;
  timestamp: number;
  error: string | null;
}) {
  const [side, setSide] = useState<"bids" | "asks">("bids");
  const [page, setPage] = useState(0),
    [size, setSize] = useState(8);
  const columns = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = columns.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize(
        Math.max(
          1,
          Math.min(30, Math.floor((entry.contentRect.height - 112) / 32)),
        ),
      ),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const count = Math.max(book?.sell.length ?? 0, book?.buy.length ?? 0);
  const pages = Math.max(1, Math.ceil(count / size)),
    current = Math.min(page, pages - 1),
    start = current * size;
  const bid = book?.sell[0]?.pricePerUnit,
    ask = book?.buy[0]?.pricePerUnit;
  const spread = bid !== undefined && ask !== undefined ? ask - bid : null;
  return (
    <section className="order-book-wide" aria-label="Order book">
      <div className="wide-book-summary">
        <span>
          Spread{" "}
          <strong>{spread === null ? "—" : `${number(spread)} coins`}</strong>
          {spread !== null && ask ? (
            <small>({number((spread / ask) * 100)}%)</small>
          ) : null}
        </span>
        <span
          className={!error && isFresh(timestamp) ? "book-fresh" : "book-stale"}
        >
          {!error && isFresh(timestamp)
            ? "Current snapshot"
            : timestamp > 0 ? "Saved prices" : "Prices unavailable"}
          {timestamp > 0
            ? ` · ${new Date(timestamp).toLocaleTimeString()}`
            : ""}
        </span>
      </div>
      <div
        className="mobile-book-switch"
        role="group"
        aria-label="Order book side"
      >
        <button aria-pressed={side === "bids"} onClick={() => setSide("bids")}>
          Buy orders
        </button>
        <button aria-pressed={side === "asks"} onClick={() => setSide("asks")}>
          Sell orders
        </button>
      </div>
      <div className="book-columns" ref={columns}>
        <BookSide
          side="bids"
          levels={book?.sell}
          start={start}
          size={size}
          hidden={side !== "bids"}
        />
        <BookSide
          side="asks"
          levels={book?.buy}
          start={start}
          size={size}
          hidden={side !== "asks"}
        />
      </div>
      <div className="book-pagination">
        <button
          className="secondary"
          aria-label="Previous price levels"
          disabled={current === 0}
          onClick={() => setPage(current - 1)}
        >
          <ChevronLeft size={17} /> Previous
        </button>
        <span>
          {count
            ? `Levels ${start + 1}–${Math.min(count, start + size)} of ${count}`
            : "No price levels"}
          <small>
            Page {current + 1} of {pages}
          </small>
        </span>
        <button
          className="secondary"
          aria-label="Next price levels"
          disabled={current >= pages - 1}
          onClick={() => setPage(current + 1)}
        >
          Next <ChevronRight size={17} />
        </button>
      </div>
      <p className="wide-book-note">
        Up to 30 grouped levels per side · Prices before tax · Bars show
        cumulative quantity
      </p>
    </section>
  );
}
function BookSide({
  side,
  levels,
  start,
  size,
  hidden,
}: {
  side: "bids" | "asks";
  levels: Level[] | undefined;
  start: number;
  size: number;
  hidden: boolean;
}) {
  const total = levels?.reduce((sum, l) => sum + l.amount, 0) ?? 0;
  const orders = levels?.reduce((sum, l) => sum + l.orders, 0) ?? 0;
  let cumulative =
    levels?.slice(0, start).reduce((sum, l) => sum + l.amount, 0) ?? 0;
  return (
    <section className={`book-side ${side} ${hidden ? "mobile-hidden" : ""}`}>
      <div className="book-side-heading">
        <h3>{side === "bids" ? "Buy orders" : "Sell orders"}</h3>
        <span>
          {side === "bids"
            ? "Buyers bidding · instant-sell"
            : "Sellers asking · instant-buy"}
        </span>
      </div>
      {!levels ? (
        <p className="wide-book-empty">
          Waiting for the latest order book. Please try again shortly.
        </p>
      ) : !levels.length ? (
        <p className="wide-book-empty">No visible orders.</p>
      ) : (
        <table
          className="wide-book-table"
          aria-label={side === "bids" ? "Buy orders" : "Sell orders"}
        >
          <thead>
            <tr>
              <th scope="col">Price / item</th>
              <th scope="col">Quantity</th>
              <th scope="col">Orders</th>
            </tr>
          </thead>
          <tbody>
            {levels.slice(start, start + size).map((level, i) => {
              cumulative += level.amount;
              return (
                <tr
                  key={`${level.pricePerUnit}-${i}`}
                  title={`${number(cumulative)} items at this price or better`}
                  style={{
                    backgroundSize: `${total ? (cumulative / total) * 100 : 0}% 100%`,
                  }}
                >
                  <td>{number(level.pricePerUnit)}</td>
                  <td>{number(level.amount)}</td>
                  <td>{number(level.orders)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="book-side-total">
        <span>
          {levels?.length ?? 0} levels · {number(orders)} orders
        </span>
        <strong>{number(total)} items</strong>
      </div>
    </section>
  );
}

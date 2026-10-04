import { useState } from "react";
import { X } from "lucide-react";
import { SkyIcon } from "./components";

export type NightMarketFeature = "holdings" | "returns" | "alerts";

/** Small code-native pixel icons, independent of the scene artwork. */
export function PixelFeatureIcon({ kind }: { kind: NightMarketFeature }) {
  return (
    <svg
      className="nm-feature-icon"
      viewBox="0 0 32 32"
      fill="none"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {kind === "holdings" ? (
        <>
          <path
            d="M12 3h9v4h6v3h3v19H3V10h3V7h6V3Zm3 3v1h3V6h-3ZM6 13v13h21V13H6Z"
            fill="#7bffc1"
          />
          <path d="M6 10h21v7H6v-7Zm7 4h7v9h-7v-9Z" fill="#35bd8b" />
          <path
            d="M15 15h3v5h-3v-5ZM8 21h4v3H8v-3Zm13 0h4v3h-4v-3Z"
            fill="#a5ffd6"
          />
          <path d="M4 28h25v3H4v-3M28 11h3v18h-3V11" fill="#1c725d" />
        </>
      ) : kind === "returns" ? (
        <>
          <path
            d="M3 26v-5h4v-5h5v-5h5v5h4V8h-5V4h13v13h-5v-5l-7 10h-5v-5l-5 9H3Z"
            fill="#6dffc0"
          />
          <path
            d="M3 26h5v3H3v-3Zm5-5h4v4H8v-4Zm9 1h5v3h-5v-3Zm9-14h3v9h-3V8Z"
            fill="#259b79"
          />
          <path d="M17 4h12v3H17V4ZM7 16h5v3H7v-3Z" fill="#b1ffdd" />
        </>
      ) : (
        <>
          <path
            d="M14 2h4v3h5v3h3v14h3v4H3v-4h3V8h3V5h5V2Zm-2 7v3H9v10h14V12h-3V9h-8Z"
            fill="#ffd377"
          />
          <path
            d="M12 27h8v3h-8v-3ZM6 22h20v2H6v-2ZM9 8h3v4H9V8Z"
            fill="#b8802b"
          />
          <path d="M14 5h4v3h-4V5ZM6 24h20v2H6v-2Z" fill="#ffebac" />
        </>
      )}
    </svg>
  );
}

export function NightMarketFeatureCard({
  id,
  title,
  description,
}: {
  id: NightMarketFeature;
  title: string;
  description: string;
}) {
  return (
    <article className={`nm-feature nm-feature-${id}`}>
      <PixelFeatureIcon kind={id} />
      <div>
        <h2>{title}</h2>
        <p className="nm-sr-only">{description}</p>
        <div className="nm-feature-lines" aria-hidden="true">
          <span />
          <span />
        </div>
      </div>
    </article>
  );
}

const previewItems = [
  {
    name: "Booster Cookie",
    market: "Bazaar",
    artwork: "booster_cookie",
    trend:
      "2,32 9,39 21,38 30,34 40,26 47,31 55,23 62,16 69,20 77,17 86,12 98,5",
  },
  {
    name: "Diamond Block",
    market: "Bazaar",
    artwork: "enchanted_diamond_block",
    trend:
      "2,38 12,26 23,37 31,31 42,20 49,27 57,24 64,15 72,19 80,16 90,6 98,2",
  },
  {
    name: "Summoning Eye",
    market: "Bazaar",
    artwork: "summoning_eye",
    trend:
      "2,39 11,36 21,39 31,29 41,27 50,22 59,12 65,17 75,23 84,12 92,9 98,2",
  },
] as const;

/** Illustrative signed-out preview; no user data or live price requests. */
export function NightMarketPortfolioPreview() {
  const [visible, setVisible] = useState(true);
  return (
    <div className="nm-portfolio-display">
      {visible ? (
        <section
          className="nm-preview"
          aria-label="Illustrative portfolio preview"
        >
          <header className="nm-preview-header">
            <SkyIcon name="watchlist-chest" size={36} />
            <h2>Portfolio</h2>
            <button
              className="nm-preview-close"
              type="button"
              aria-label="Hide portfolio preview"
              onClick={() => setVisible(false)}
            >
              <X aria-hidden="true" />
            </button>
          </header>
          <ul className="nm-preview-items">
            {previewItems.map((item) => (
              <li className="nm-preview-item" key={item.artwork}>
                <span className="nm-preview-item-art">
                  <img
                    src={`/assets/items/${item.artwork}.webp`}
                    alt=""
                    width={48}
                    height={48}
                  />
                </span>
                <div className="nm-preview-item-copy">
                  <span>{item.name}</span>
                  <small>{item.market}</small>
                </div>
                <svg
                  className="nm-preview-trend"
                  viewBox="0 0 100 44"
                  fill="none"
                  aria-hidden="true"
                >
                  <polyline
                    points={item.trend}
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="miter"
                  />
                </svg>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <button
          className="nm-preview-restore"
          type="button"
          onClick={() => setVisible(true)}
        >
          <SkyIcon name="watchlist-chest" size={28} />
          Show portfolio preview
        </button>
      )}
    </div>
  );
}

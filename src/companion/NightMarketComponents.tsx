import { useState } from "react";
import { X } from "lucide-react";
import { SkyIcon } from "./components";

const previewItems = [
  {
    name: "Booster Cookie",
    artwork: "booster_cookie",
    trend:
      "2,32 9,39 21,38 30,34 40,26 47,31 55,23 62,16 69,20 77,17 86,12 98,5",
  },
  {
    name: "Diamond Block",
    artwork: "enchanted_diamond_block",
    trend:
      "2,38 12,26 23,37 31,31 42,20 49,27 57,24 64,15 72,19 80,16 90,6 98,2",
  },
  {
    name: "Summoning Eye",
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
            <h2>Example portfolio</h2>
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

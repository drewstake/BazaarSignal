import { useState } from "react";
import { requestBackend } from "../../backend";
import { PixelIcon, PixelIsland } from "../ui/Pixel";
import type { PixelGlyph } from "../ui/pixel-glyphs";

const features: [PixelGlyph, string, string][] = [
  [
    "chest",
    "Organize your holdings",
    "Create portfolios for your own goals and record additional purchases.",
  ],
  [
    "check",
    "Understand your returns",
    "Estimated value and unrealized P&L with clear valuation references.",
  ],
  [
    "bell",
    "Choose your thresholds",
    "Holding-based percentage notifications, with an explicit baseline.",
  ],
];

export function Intro({
  busy,
  onSignIn,
}: {
  busy: boolean;
  onSignIn: () => void;
}) {
  return (
    <section className="intro" aria-labelledby="intro-title">
      <div className="intro-copy">
        <p className="eyebrow">Personal SkyBlock portfolios</p>
        <h1 id="intro-title">
          Know what you own.
          <span>See how it’s doing.</span>
        </h1>
        <p>
          Keep your Bazaar items and Auction House assets in one place. Record
          what you paid, follow estimated value, and choose the price changes
          that matter to you.
        </p>
        <button
          className="button primary large"
          onClick={onSignIn}
          disabled={busy}
        >
          <PixelIcon name="key" size={18} />
          Sign in with Google
        </button>
        <p className="muted">
          Private to your account. Manually recorded holdings. No connection to
          your in-game inventory.
        </p>
      </div>
      <div className="intro-art" aria-hidden="true">
        <PixelIsland className="intro-island" />
        <div className="intro-items">
          <img src="/assets/items/booster_cookie.webp" alt="" />
          <img src="/assets/items/enchanted_diamond_block.webp" alt="" />
          <img src="/assets/items/summoning_eye.webp" alt="" />
        </div>
      </div>
      <ul className="intro-features">
        {features.map(([icon, title, text]) => (
          <li className="ledger-card" key={title}>
            <PixelIcon name={icon} size={28} />
            <div>
              <b>{title}</b>
              <p>{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LegacyDisable({ token }: { token: string }) {
  const [done, setDone] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="ledger-card narrow-card">
      <h1 className="card-title">Disable legacy alert</h1>
      <p>
        This link belongs to an existing price-target alert. Opening the link
        does not change it.
      </p>
      {done ? (
        <p role="status" className="inline-success">
          Alert disabled. Any email already in flight may still arrive.
        </p>
      ) : (
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await requestBackend({ action: "disable", token, confirm: true });
              setDone(true);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Disable alert
        </button>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <a className="text-link" href="#view=notifications">
        Go to notifications
      </a>
    </section>
  );
}

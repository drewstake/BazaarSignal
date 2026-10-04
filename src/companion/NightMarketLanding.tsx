import { Settings } from "lucide-react";
import { SkyIcon } from "./components";
import {
  NightMarketFeatureCard,
  NightMarketPortfolioPreview,
} from "./NightMarketComponents";
import "./night-market.css";

const features = [
  {
    id: "holdings",
    title: "Track holdings",
    description:
      "Keep a record of the items you own on the Bazaar.",
  },
  {
    id: "returns",
    title: "See returns",
    description: "View estimated value and returns for your tracked items.",
  },
  {
    id: "alerts",
    title: "Set price alerts",
    description: "Set target prices for the items you track.",
  },
] as const;

export default function NightMarketLanding({
  view,
  busy,
  error,
  onSignIn,
}: {
  view: string;
  busy: boolean;
  error: string;
  onSignIn: () => void;
}) {
  return (
    <div className="portfolio-app night-market">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="nm-stage">
        <header className="nm-header">
          <a
            className="nm-brand"
            href="#view=portfolios"
            aria-label="BazaarSignal home"
          >
            <span className="nm-brand-art" aria-hidden="true" />
          </a>
          <nav className="nm-nav" aria-label="Main navigation">
            <a
              href="#view=portfolios"
              aria-current={view === "portfolios" ? "page" : undefined}
            >
              <SkyIcon name="watchlist-chest" size={34} />
              Portfolio
            </a>
            <a
              href="#view=notifications"
              aria-current={view === "notifications" ? "page" : undefined}
            >
              <SkyIcon name="alert-bell" size={34} />
              Notifications
            </a>
            <a
              href="#view=account"
              aria-current={view === "account" ? "page" : undefined}
            >
              <Settings size={25} aria-hidden="true" />
              Account
            </a>
          </nav>
        </header>
        <main className="nm-main" id="main-content" tabIndex={-1}>
          <section className="nm-hero" aria-labelledby="nm-title">
            <p className="nm-eyebrow">SKYBLOCK BAZAAR</p>
            <h1 id="nm-title">
              Your SkyBlock<span className="nm-headline-line">portfolio.</span>
              <span className="nm-headline-accent">At a glance.</span>
            </h1>
            <p className="nm-description">
              Track your items, estimated value, and returns.
            </p>
            <button
              className="nm-sign-in"
              onClick={onSignIn}
              disabled={busy}
              aria-busy={busy}
            >
              <svg className="nm-google" viewBox="0 0 48 48" aria-hidden="true">
                <path
                  fill="#4285f4"
                  d="M43.6 20.5H24v8h11.2c-1.5 4.6-5.7 7.6-11.2 7.6A12.1 12.1 0 0 1 12 24c0-6.7 5.4-12.1 12-12.1 3 0 5.8 1.1 7.9 3.1l6-5.8A20.5 20.5 0 0 0 24 4 20 20 0 0 0 4 24a20 20 0 0 0 20 20c11.5 0 20-8.1 20-20 0-1.2-.1-2.4-.4-3.5Z"
                />
                <path
                  fill="#34a853"
                  d="m6.3 33.2 6.6-5.1A12.1 12.1 0 0 0 24 36.1c3.1 0 5.8-.8 7.9-2.4l6.3 4.9A20.2 20.2 0 0 1 24 44c-7.7 0-14.4-4.4-17.7-10.8Z"
                />
                <path
                  fill="#fbbc05"
                  d="M4 24c0-3.2.8-6.3 2.3-9.2l6.6 5.1a12.2 12.2 0 0 0 0 8.2l-6.6 5.1A20 20 0 0 1 4 24Z"
                />
                <path
                  fill="#ea4335"
                  d="M24 4c5.4 0 10.2 1.9 13.9 5.2l-6 5.8a11.4 11.4 0 0 0-7.9-3.1c-5.1 0-9.4 3.3-11.1 8l-6.6-5.1A20 20 0 0 1 24 4Z"
                />
              </svg>
              {busy ? "Signing in…" : "Sign in with Google"}
            </button>
            <p className="nm-privacy">
              Private to you. Add items manually; no inventory sync.
            </p>
            {error && (
              <p className="nm-error" role="alert">
                {error}
              </p>
            )}
          </section>
          <div className="nm-scene">
            <div className="nm-mobile-scene" aria-hidden="true" />
            <NightMarketPortfolioPreview />
          </div>
          <section className="nm-features" aria-label="Portfolio features">
            {features.map((feature) => (
              <NightMarketFeatureCard key={feature.id} {...feature} />
            ))}
          </section>
        </main>
      </div>
    </div>
  );
}

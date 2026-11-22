import { ArrowUpRight, Mail } from "lucide-react";
import type { User } from "firebase/auth";
import "./night-market-account.css";

type AccountProps = {
  user: User;
  emailEnabled: boolean;
  disabled: boolean;
  paused: boolean;
  onEmailChange: (enabled: boolean) => void;
};

export default function NightMarketAccount({
  user,
  emailEnabled,
  disabled,
  paused,
  onEmailChange,
}: AccountProps) {
  const name = user.displayName?.trim() || "SkyBlock trader";
  const initial = (user.displayName?.trim() || user.email || "S")
    .charAt(0)
    .toUpperCase();

  return (
    <section
      className="night-account"
      aria-label="Account profile and preferences"
    >
      <div className="account-profile">
        <div className="account-identity">
          <div className="account-avatar" aria-hidden="true">
            {initial}
          </div>
          <h2>{name}</h2>
          <p className="account-email">{user.email}</p>
        </div>
      </div>

      <div
        className="account-preferences"
        aria-labelledby="account-email-title"
      >
        <div className="account-mail-icon" aria-hidden="true">
          <Mail size={25} />
        </div>
        <div className="account-preference-copy">
          <h2 id="account-email-title">Email alerts</h2>
          {paused && <p id="account-email-help">Market checks are paused.</p>}
          <a href="#view=settings&section=notifications">
            Manage alerts <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
        <label className="account-email-control">
          <span className="account-toggle-state">
            {emailEnabled ? "On" : "Off"}
          </span>
          <input
            type="checkbox"
            aria-label="Allow email for my holding notifications"
            aria-describedby={paused ? "account-email-help" : undefined}
            checked={emailEnabled}
            disabled={disabled}
            onChange={(event) => onEmailChange(event.target.checked)}
          />
          <span className="account-toggle-track" aria-hidden="true" />
        </label>
      </div>
    </section>
  );
}

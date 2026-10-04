import { ArrowUpRight, Mail, ShieldCheck } from "lucide-react";
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
          <div className="account-google">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285f4"
                d="M21.6 12.23c0-.71-.06-1.39-.18-2.04H12v3.86h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.23c1.89-1.74 2.98-4.3 2.98-7.35Z"
              />
              <path
                fill="#34a853"
                d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.23-2.51c-.9.6-2.05.96-3.39.96-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A10 10 0 0 0 12 22Z"
              />
              <path
                fill="#fbbc05"
                d="M6.4 13.91a6 6 0 0 1 0-3.82V7.5H3.06a10 10 0 0 0 0 9Z"
              />
              <path
                fill="#ea4335"
                d="M12 5.97c1.47 0 2.79.5 3.83 1.52l2.87-2.87A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.94 5.5l3.34 2.59C7.19 7.73 9.4 5.97 12 5.97Z"
              />
            </svg>
            Signed in with Google
          </div>
          <h2>{name}</h2>
          <p className="account-email">{user.email}</p>
          <span className="account-private">
            <ShieldCheck size={15} aria-hidden="true" /> Private account
          </span>
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
          <p id="account-email-help">
            {paused
              ? "Alerts you choose. Checks are paused."
              : "Only for alerts you choose."}
          </p>
          <a href="#view=notifications">
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
            aria-describedby="account-email-help"
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

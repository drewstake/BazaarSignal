import type { ReactNode } from "react";
import type { User } from "firebase/auth";
import { BlockAvatar, PixelIcon } from "../ui/Pixel";
import { InfoNote, PageHeading } from "./common";

export default function AccountPage({
  user,
  emailEnabled,
  busy,
  loading,
  onEmailChange,
  onSignOut,
  feedback,
}: {
  feedback?: ReactNode;
  user: User;
  emailEnabled: boolean;
  busy: boolean;
  loading: boolean;
  onEmailChange: (enabled: boolean) => void;
  onSignOut: () => void;
}) {
  const name = user.displayName?.trim() || "Player";
  const google = user.providerData.some((p) => p.providerId === "google.com");
  return (
    <>
      <PageHeading title="Account" />
      {feedback}
      <div className="account-grid">
        <section
          className="ledger-card account-card"
          aria-labelledby="profile-title"
        >
          <h2 id="profile-title">Your profile</h2>
          <div className="profile-box">
            <div className="profile-id">
              <BlockAvatar
                seed={user.uid}
                size={112}
                className="profile-avatar"
              />
              <div>
                <p className="profile-name">{name}</p>
                <p className="profile-provider">
                  <PixelIcon name="key" size={18} />
                  {google ? "Signed in with Google" : "Signed in"}
                </p>
                {user.email && <p className="profile-email">{user.email}</p>}
              </div>
            </div>
            <InfoNote tone="safe">
              <p>
                <b>Only you can see your holdings.</b> Your portfolios,
                quantities, acquisition costs and notification settings are
                private to this account.
              </p>
            </InfoNote>
            <button className="button signout-button" onClick={onSignOut}>
              <PixelIcon name="logout" size={18} />
              Sign out
            </button>
          </div>
        </section>
        <section
          className="ledger-card account-card"
          aria-labelledby="prefs-title"
        >
          <h2 id="prefs-title">Notification preferences</h2>
          <div className="preference-box">
            <div className="preference-row">
              <PixelIcon name="mail" size={44} className="preference-icon" />
              <div className="preference-text">
                <label htmlFor="email-preference">
                  Email for holding notifications
                </label>
                <p id="email-preference-help">
                  Send an email to your verified Google address when a holding
                  crosses a price change you chose.
                </p>
              </div>
              <span className="switch">
                <input
                  id="email-preference"
                  type="checkbox"
                  role="switch"
                  aria-describedby="email-preference-help"
                  checked={emailEnabled}
                  disabled={busy || loading}
                  onChange={(e) => onEmailChange(e.target.checked)}
                />
                <span className="switch-track" aria-hidden="true">
                  <span className="switch-knob" />
                </span>
                <span className="switch-state" aria-hidden="true">
                  {emailEnabled ? "On" : "Off"}
                </span>
              </span>
            </div>
            <InfoNote>
              <p>
                <b>Choose notifications on individual holdings.</b> No holding
                notifications are created automatically. Delivery waits for
                fresh eligible samples, verified identity, available quota and
                an authorized service release.
              </p>
              <p>
                Legacy price alerts keep their existing delivery settings until
                you pause them in{" "}
                <a href="#view=notifications">the Notifications page</a>.
              </p>
            </InfoNote>
          </div>
        </section>
      </div>
    </>
  );
}

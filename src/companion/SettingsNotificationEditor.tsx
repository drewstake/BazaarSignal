import { useEffect, useState } from "react";
import type {
  HoldingNotification,
  NotificationInput,
} from "../../shared/companion/notifications";
import { valueHolding, type Holding } from "../../shared/companion/portfolio";
import { loadHolding } from "./portfolio-store";
import { portfolioMarket } from "./portfolio-market";
import NotificationEditor from "./NotificationEditor";
import WorkspaceDialog from "./WorkspaceDialog";

export default function SettingsNotificationEditor({
  uid,
  notification,
  busy,
  emailEnabled,
  saveError,
  save,
  cancel,
}: {
  uid: string;
  notification: HoldingNotification;
  busy: boolean;
  emailEnabled: boolean;
  saveError: string;
  save: (input: NotificationInput) => Promise<void>;
  cancel: () => void;
}) {
  const [holding, setHolding] = useState<Holding | null>(null);
  const [marketPrice, setMarketPrice] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const saved = await loadHolding(
          uid,
          notification.portfolioId,
          notification.holdingId,
        );
        if (controller.signal.aborted) return;
        if (saved.kind !== "bazaar")
          throw new Error(
            "Notifications are unavailable for this saved asset.",
          );
        setHolding(saved);
        // Price previews are optional; unavailable market data must not block editing.
        try {
          const prices = await portfolioMarket([saved.id], controller.signal);
          if (!controller.signal.aborted)
            setMarketPrice(
              valueHolding(saved, prices.bazaar, [], Date.now(), true)
                .referencePrice,
            );
        } catch {
          /* The form displays an unavailable preview until prices return. */
        }
      } catch (error) {
        if (!controller.signal.aborted) setError((error as Error).message);
      }
    }
    void load();
    return () => controller.abort();
  }, [uid, notification.portfolioId, notification.holdingId]);

  return (
    <WorkspaceDialog
      busy={busy}
      cancel={cancel}
      labelledBy="notification-title"
    >
      {holding ? (
        <NotificationEditor
          embedded
          holding={holding}
          current={notification}
          busy={busy}
          emailEnabled={emailEnabled}
          marketPrice={marketPrice}
          saveError={saveError}
          save={save}
          cancel={cancel}
        />
      ) : (
        <>
          <h2 id="notification-title">
            Notify me about {notification.holdingName}
          </h2>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : (
            <p role="status">Loading holding…</p>
          )}
          <button onClick={cancel}>Cancel</button>
        </>
      )}
    </WorkspaceDialog>
  );
}

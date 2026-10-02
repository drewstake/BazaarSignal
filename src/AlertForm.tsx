import {
  useState,
  type Dispatch,
  type SetStateAction,
  type FormEvent,
} from "react";
import type { User } from "firebase/auth";
import { ArrowRight, Check, Mail } from "lucide-react";
import type {
  AlertEvent,
  AppData,
  PriceAlertInput,
  ProductPrice,
} from "../shared/model";
import { estimate } from "../shared/market";
import { auth, isLocal } from "./data";
import { createCloudAlert, createLocalAlert } from "./alerts";
import { evaluateLocal } from "./live";
import { useAlertBook } from "./useAlertBook";
import { SkyIcon } from "./companion/components";
import { SampleTime } from './SampleTime';
const coins = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 6 });
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";
export default function AlertForm({
  item,
  data,
  user,
  signIn,
  signingIn,
  authError,
  update,
  onViewAlerts,
  onCreated,
  compact = false,
  initialQuantity = "1",
}: {
  item: ProductPrice;
  data: AppData;
  user: User | null;
  signIn: () => Promise<void>;
  signingIn: boolean;
  authError: string;
  update: Dispatch<SetStateAction<AppData>>;
  onViewAlerts: () => void;
  onCreated?: () => void;
  compact?: boolean;
  initialQuantity?: string;
}) {
  const [quantity, setQuantity] = useState(initialQuantity),
    [side, setSide] = useState<"buy" | "sell">("buy");
  const [target, setTarget] = useState(String(item.buy ?? "")),
    [tax, setTax] = useState("1.25");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [receipt, setReceipt] = useState<AlertEvent | null>(null),
    [success, setSuccess] = useState("");
  const [showEmail, setShowEmail] = useState(false);
  const {
    book,
    stale,
    timestamp,
    observedAt,
    collectionError,
    error: bookError,
  } = useAlertBook(item.id, data);
  const qty = Number(quantity),
    taxRate = Number(tax);
  const buy = estimate(book, qty, "buy", taxRate),
    sell = estimate(book, qty, "sell", taxRate),
    quote = side === "buy" ? buy : sell;
  const resetRequest = () => {
    setRequestId(crypto.randomUUID());
    setError("");
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const owner = user?.uid;
    const input: PriceAlertInput = {
      requestId,
      itemId: item.id,
      quantity: qty,
      side,
      target: Number(target),
      taxRate,
    };
    try {
      if (isLocal) {
        const result = createLocalAlert(data, input);
        update(evaluateLocal(result.data));
        setReceipt(result.event);
        setSuccess("Preview alert created.");
        onCreated?.();
      } else {
        const result = await createCloudAlert(input);
        if (auth?.currentUser?.uid !== owner) return;
        onCreated?.();
        setSuccess(
          result.emailStatus === "sent"
            ? "Confirmation email sent."
            : "Alert created. Your confirmation email is queued.",
        );
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const disableUrl = receipt?.message
    .split("\n")
    .find((line) => line.includes("#disable="));
  return success ? (
    <section className="success-view">
      <span className="success-icon">
        <Check size={26} />
      </span>
      <h2>{success}</h2>
      <p>
        {isLocal
          ? "No email was sent. Preview the confirmation below."
          : `We’ll email ${user?.email ?? "your Google account"} when your target is reached. Use the link in your confirmation email to disable this alert.`}
      </p>
      {isLocal && (
        <button className="secondary" onClick={() => setShowEmail((v) => !v)}>
          {showEmail ? "Hide email preview" : "Preview confirmation email"}
        </button>
      )}
      {showEmail && receipt && (
        <div className="email-preview">
          <span className="eyebrow">EMAIL PREVIEW · NOT SENT</span>
          <h3>{receipt.message.split("\n")[0]}</h3>
          <p>
            {receipt.message
              .split("\n")
              .find((line) => line.startsWith("Notify me"))}
          </p>
          <p>We’ll email you once when this target is reached.</p>
          <a className="disable-link" href={disableUrl}>
            Disable this alert <ArrowRight size={14} />
          </a>
        </div>
      )}
      <button className="primary" onClick={onViewAlerts}>
        View my alerts
      </button>
      <button
        className="text-button"
        onClick={() => {
          setSuccess("");
          setReceipt(null);
          setShowEmail(false);
          resetRequest();
        }}
      >
        Create another alert <ArrowRight size={15} />
      </button>
    </section>
  ) : !isLocal && !user ? (
    <section className="alert-form">
      <div className="form-intro">
        <h2>Sign in for email alerts.</h2>
        <p>
          Use your Google account. Your alerts stay private and emails go to
          your verified address.
        </p>
      </div>
      <button
        className="primary google-button"
        onClick={signIn}
        disabled={signingIn}
      >
        {signingIn ? "Connecting…" : "Continue with Google"}
      </button>
      <p className="delivery-note">
        Browsing prices is free and needs no sign-in.
      </p>
      {authError && (
        <p className="error" role="alert">
          {authError}
        </p>
      )}
    </section>
  ) : (
    <form className="alert-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        {!compact && (
          <div className="form-intro">
            <h2>Set your price.</h2>
            <p>One email when your target is reached.</p>
          </div>
        )}
        <div
          className="direction-switch"
          role="group"
          aria-label="Alert direction"
        >
          <button
            type="button"
            aria-pressed={side === "buy"}
            onClick={() => {
              setSide("buy");
              setTarget(String(buy?.unit ?? item.buy ?? ""));
              resetRequest();
            }}
          >
            Buy below
          </button>
          <button
            type="button"
            aria-pressed={side === "sell"}
            onClick={() => {
              setSide("sell");
              setTarget(String(sell?.unit ?? ""));
              resetRequest();
            }}
          >
            Sell above
          </button>
        </div>
        <div className="form-fields">
          <label>
            Target price{" "}
            <span>coins / item{side === "sell" ? ", after tax" : ""}</span>
            <div className="target-input">
              <input
                aria-label="Target price"
                type="number"
                required
                min="0.000001"
                max="1000000000000000"
                step="any"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  resetRequest();
                }}
              />
              {compact && <SkyIcon name="gold-coin" size={26} />}
            </div>
          </label>
          <label>
            Quantity
            <input
              aria-label="Quantity"
              type="number"
              required
              min="1"
              max="1000000000000000"
              step="1"
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                resetRequest();
              }}
            />
          </label>
        </div>
        {side === "sell" && (
          <label className="tax-field">
            Sale tax (%)
            <input
              type="number"
              required
              min="0"
              max="99.99"
              step="0.01"
              value={tax}
              onChange={(e) => {
                setTax(e.target.value);
                resetRequest();
              }}
            />
          </label>
        )}
        <div className="trigger-preview">
          <strong>When it happens</strong>
          <p>
            <Mail size={24} />
            <span>
              Email me when the estimated instant-{side}{" "}
              {side === "buy" ? "cost" : "proceeds"} for{" "}
              <b>
                {coins(qty)} × {item.name}
              </b>{" "}
              is {side === "buy" ? "at or below" : "at or above"}{" "}
              <b>{coins(Number(target))} coins each</b>
              {side === "sell" ? ` after ${taxRate}% tax` : ""}.
            </span>
          </p>
        </div>
        {bookError && (
          <p className="error" role="alert">
            {collectionError ? 'Collection failed.' : 'Cached price read failed.'} {bookError}
            {hourlyMarketMode ? ' Prices update at the scheduled hourly check.' : ' Prices update automatically.'}
          </p>
        )}
        <p className="quote-note">
          {quote
              ? `${stale ? 'Last sampled' : 'Sampled'} ${side === 'buy' ? 'instant-buy cost' : `instant-sell proceeds after ${taxRate}% tax`}: ${coins(quote.unit)} coins / item for ${coins(qty)} items.`
              : "Insufficient visible liquidity. The alert waits until your full quantity is available."}
          {' '}<SampleTime timestamp={timestamp} observedAt={observedAt} />
          {stale && ' Alerts only trigger on fresh prices.'}
        </p>
        {compact && (
          <div className="email-delivery">
            <Mail size={22} />
            <span>
              Email notification
              <small>
                {isLocal ? "Preview only · No email sent" : user?.email}
              </small>
            </span>
          </div>
        )}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create alert"}
          <SkyIcon name="alert-bell" size={30} />
        </button>
        <p className="delivery-note">
          {isLocal
            ? "Preview only. No email will be sent."
            : `Confirmation goes to ${user?.email}.`}
          {(!compact || !isLocal) && (
            <>
              <br />
              Disable your alert using the link in that email.
            </>
          )}
          {!isLocal && (
            <>
              <br />
              {hourlyMarketMode ? 'Hourly price checks can miss changes between collections.' : 'Checks about every five minutes can miss brief price movements.'}
              <br />
              20 active alerts per account · Free service shares 40 new alerts
              per day. Delivery may queue.
            </>
          )}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </fieldset>
    </form>
  );
}
import { hourlyMarketMode } from './companion/polling';

import type { ReactNode } from "react";
import { exact } from "../components";
import { PixelIcon } from "../ui/Pixel";
import type { PixelGlyph } from "../ui/pixel-glyphs";

const SKY = "/assets/sky-island-v1/web";

/** Page title in the pixel display face, with an optional right-hand slot. */
export function PageHeading({
  title,
  subtitle,
  id,
  badge,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  id?: string;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div className="page-heading-text">
        <div className="page-title-row">
          <h1 id={id}>{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {children && <div className="page-heading-side">{children}</div>}
    </div>
  );
}

/** Compact state pill, e.g. "Market updates paused · Holdings remain editable". */
export function StatusPill({
  icon,
  tone = "neutral",
  children,
}: {
  icon: PixelGlyph;
  tone?: "neutral" | "warn" | "ok";
  children: ReactNode;
}) {
  return (
    <p className={`status-pill ${tone}`}>
      <span className="status-pill-icon">
        <PixelIcon name={icon} size={16} />
      </span>
      <span>{children}</span>
    </p>
  );
}

export function CoinIcon({ size = 20 }: { size?: number }) {
  return (
    <img
      className="coin-icon"
      src={`${SKY}/ui-gold-coin-64.png`}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      decoding="async"
      draggable={false}
    />
  );
}

/** A coin amount: icon, exact figure, and an accessible "coins" unit. */
export function Coins({
  value,
  size = 20,
  signed = false,
}: {
  value: number | null;
  size?: number;
  signed?: boolean;
}) {
  if (value === null || !Number.isFinite(value))
    return <span className="coins unavailable">Unavailable</span>;
  return (
    <span className="coins">
      <CoinIcon size={size} />
      <span>
        {signed && value > 0 ? "+" : ""}
        {exact(value)}
      </span>
      <span className="sr-only"> coins</span>
    </span>
  );
}

/** Informational callout with the blue pixel "i". */
export function InfoNote({
  children,
  tone = "info",
  icon,
}: {
  children: ReactNode;
  tone?: "info" | "safe" | "warn";
  icon?: PixelGlyph;
}) {
  return (
    <div className={`info-note ${tone}`}>
      <PixelIcon
        name={
          icon ??
          (tone === "safe" ? "lock" : tone === "warn" ? "warning" : "info")
        }
        size={20}
      />
      <div>{children}</div>
    </div>
  );
}

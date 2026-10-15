import { isValidSample } from "../shared/market";
import { formatEstFullDateTime, formatEstTime } from "./time";

export function sampleAge(timestamp: number, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  return seconds < 60
    ? `${seconds}s ago`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ago`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ago`
        : `${Math.floor(seconds / 86400)}d ago`;
}
export function SampleTime({
  timestamp,
  observedAt,
  now = Date.now(),
  compact = false,
}: {
  timestamp: number;
  observedAt?: number;
  now?: number;
  compact?: boolean;
}) {
  if (!isValidSample(timestamp, now))
    return <span>Sample time unavailable</span>;
  return (
    <span className="sample-time">
      Updated{" "}
      <time
        dateTime={new Date(timestamp).toISOString()}
        title={formatEstFullDateTime(timestamp)}
      >
        {compact ? formatEstTime(timestamp) : formatEstFullDateTime(timestamp)}
      </time>
      {" · "}
      {sampleAge(timestamp, now)}
      {!compact && isValidSample(observedAt ?? 0, now) && (
        <> · collected {formatEstTime(observedAt!)}</>
      )}
    </span>
  );
}

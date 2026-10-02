import { isFresh, isValidSample } from '../shared/market';

export function sampleAge(timestamp: number, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` :
    seconds < 86400 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ago` : `${Math.floor(seconds / 86400)}d ago`;
}
export function SampleTime({ timestamp, observedAt, now = Date.now(), compact = false }: { timestamp: number; observedAt?: number; now?: number; compact?: boolean }) {
  if (!isValidSample(timestamp, now)) return <span>Sample time unavailable</span>;
  return <span className="sample-time">
    {isFresh(timestamp, now) ? 'Sampled' : 'Last sampled · Stale'}{' '}
    <time dateTime={new Date(timestamp).toISOString()} title={new Date(timestamp).toLocaleString()}>{compact ? new Date(timestamp).toLocaleTimeString([], {hour:'numeric', minute:'2-digit', timeZoneName:'short'}) : new Date(timestamp).toLocaleString()}</time>
    {' · '}{sampleAge(timestamp, now)}
    {!compact && isValidSample(observedAt ?? 0, now) && <> · collected {new Date(observedAt!).toLocaleTimeString()}</>}
  </span>;
}

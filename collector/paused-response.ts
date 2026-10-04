import type { ServerResponse } from 'node:http';

/** A disabled release does no ledger, credential, shutdown or upstream work. */
export function pausedMarketResponse(enabled: boolean, res: ServerResponse): boolean {
  if (enabled) return false;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Retry-After', '3600');
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(503).end(JSON.stringify({ error: 'Market collection remains paused.', paused: true }));
  return true;
}

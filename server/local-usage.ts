import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { SqliteCache } from '../collector/cache-store';
import { cachedDashboard, measureDashboard, OWNER_EMAIL } from '../collector/usage-dashboard';
import { verifiedUsageSnapshot, type UsageDashboard } from '../shared/usage-dashboard';

// This transport cannot start a collector, mail worker, scheduler, or cloud write.
export function readOnlyUsageNetwork(network: typeof fetch = fetch): typeof fetch {
  let attempts = 0;
  const hosts = new Set(['firestore.googleapis.com', 'monitoring.googleapis.com',
    'cloudscheduler.googleapis.com', 'cloudbuild.googleapis.com', 'artifactregistry.googleapis.com']);
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url.protocol !== 'https:' || !hosts.has(url.hostname) || method !== 'GET' || ++attempts > 32)
      throw new Error('Read-only usage measurement limit reached.');
    return network(input, {...init, redirect: 'error'});
  };
}

export async function measureLocalCloudUsage(): Promise<UsageDashboard> {
  // Credentials remain server-side; use the already signed-in local owner account.
  const require = createRequire(resolve('package.json'));
  const auth = require('firebase-tools/lib/auth');
  const account = auth.getAllAccounts().find((a: any) => a.user.email === OWNER_EMAIL);
  if (!account) throw new Error('Local reporting credentials unavailable.');
  const credential = await auth.getAccessToken(account.tokens.refresh_token, []);
  return measureReadOnlyUsage(credential.access_token);
}

export async function measureReadOnlyUsage(access: string, transport: typeof fetch = fetch): Promise<UsageDashboard> {
  const network = readOnlyUsageNetwork(transport);
  return measureDashboard({token: async () => access, network, store: {
      // Use GET document reads: the collector's CAS adapter uses POST batchGet.
      // Reporting needs neither that adapter's clock synchronization nor writes.
      read: async key => {
        if (!['live-allowance', 'control'].includes(key)) throw new Error('Unsupported reporting read.');
        const response = await network(`https://firestore.googleapis.com/v1/projects/bazaarsignal-510305/databases/(default)/documents/marketCache/${key}`, {
          headers: {Authorization: `Bearer ${access}`}, signal: AbortSignal.timeout(5000),
        });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error('Reporting document unavailable.');
        const text = await response.text();
        if (text.length > 128 * 1024) throw new Error('Reporting document exceeds measurement limit.');
        const value = JSON.parse(text).fields?.value?.stringValue;
        if (typeof value !== 'string') throw new Error('Reporting document missing value.');
        return value;
      },
      commit: async () => { throw new Error('Cloud reporting writes are disabled.'); },
      close: async () => {},
  }});
}

/** Only owner page loads/manual refreshes call this; there is no background timer.
 * A local SQLite CAS reserves the existing 30-minute measurement slot before I/O.
 * Tabs, server restarts, and the diagnostic CLI share it. Failed slots are not refunded.
 */
export function createLocalUsageReport(options: {
  path?: string; legacyPath?: string; now?: () => number; measure?: () => Promise<UsageDashboard>;
} = {}) {
  const now = options.now ?? Date.now;
  let pending: Promise<UsageDashboard> | undefined;
  return (): Promise<UsageDashboard> => {
    if (pending) return pending;
    pending = (async () => {
      const store = new SqliteCache(options.path ?? '.local/usage-report.sqlite');
      try {
        if (!await store.read('usage-dashboard')) {
          let saved: UsageDashboard | null = null;
          try {
            saved = JSON.parse(await readFile(options.legacyPath ?? '.local/usage-dashboard-measured.json', 'utf8'));
            if (!saved || !Number.isFinite(saved.generatedAt) || !Number.isFinite(saved.nextMeasurementAt) || !Array.isArray(saved.rows)) saved = null;
          } catch { /* No legacy report; the first measurement still needs a durable slot. */ }
          if (saved) await store.commit('usage-dashboard', null, JSON.stringify({nextAttemptAt: saved.nextMeasurementAt, snapshot: saved}));
        }
        let snapshot: UsageDashboard;
        try {
          snapshot = await cachedDashboard(store, options.measure ?? measureLocalCloudUsage, now)();
        } catch {
          const saved = JSON.parse(await store.read('usage-dashboard') ?? 'null');
          if (!saved?.snapshot) throw new Error('Cloud measurements are unavailable; the reserved refresh slot remains in place.');
          snapshot = saved.snapshot;
        }
        const state = JSON.parse(await store.read('usage-dashboard') ?? 'null');
        const stale = !!snapshot.stale || now() >= snapshot.nextMeasurementAt;
        return {
          ...verifiedUsageSnapshot(snapshot), stale,
          localNextAttemptAt: state?.nextAttemptAt ?? snapshot.nextMeasurementAt,
          localReport: 'Read-only cloud measurements cached on this computer. Refresh checks for new measurements at most once every 30 minutes, shared across tabs and restarts. Individual sources may be delayed or unavailable. Price collection, email and scheduled jobs are never started.' +
            (stale ? ' The latest refresh is unavailable or still in progress; the previous report and its original timestamps are retained.' : ''),
        };
      } finally { await store.close(); }
    })().finally(() => { pending = undefined; });
    return pending;
  };
}

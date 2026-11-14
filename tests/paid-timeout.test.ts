import { describe, expect, it } from 'vitest';
import { PAID_BUDGET_KEY, createPaidRuntime } from '../collector/paid-budget';
import { trialGoogleStore } from '../collector/trial-google';
import { paidRuntimeFixture, snapshotFixture, fixtureTime } from './support/paid-runtime-fixture';

import { CONTINUOUS_LEDGER_KEY, CONTINUOUS_MARKET_ID } from '../shared/continuous-market';
import { isTransportTimeout } from '../collector/diagnostics';

const timeout = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

describe.each([false, true])('timeout recovery (continuous=%s)', continuous => {
const key = continuous ? CONTINUOUS_LEDGER_KEY : PAID_BUDGET_KEY;
const fixture = (blob = false) => paidRuntimeFixture(snapshotFixture('one', fixtureTime, 30), blob, continuous);

it.each(['read', 'admission', 'ambiguous-admission', 'finish', 'ambiguous-finish'] as const)(
  'a %s timeout preserves service availability and does not replay an uncertain write', async phase => {
    const f = fixture();
    const network = f.f.config.network;
    const before = JSON.parse(f.f.read(key)!);
    let commits = 0, failures = 0;
    f.f.config.network = async (url, init) => {
      const commit = String(url).endsWith(':commit');
      if (commit) commits++;
      const fail = phase === 'read' ? String(url).endsWith(':batchGet')
        : commit && (phase.includes('finish') ? commits === 2 : commits === 1);
      if (fail) {
        failures++;
        if (phase.startsWith('ambiguous')) await network(url, init);
        throw timeout();
      }
      return network(url, init);
    };
    const response = await f.request();
    expect(failures).toBe(1);
    expect(f.metrics.shutdowns).toBe(0);
    expect(f.metrics.upstreamCalls).toBe(0);
    expect(commits).toBe(phase === 'read' ? 0 : phase.includes('finish') ? 2 : 1);
    const after = JSON.parse(f.f.read(key)!);
    expect(after.stoppedAt).toBeUndefined();
    expect(after.limitUsd).toBe(before.limitUsd);
    expect(after.stopUsd).toBe(before.stopUsd);
    if (phase.includes('finish') || phase === 'ambiguous-admission') {
      expect(after.reservedUsd).toBeGreaterThan(before.reservedUsd);
      expect(f.receipts()).toHaveLength(1);
      expect(!!f.receipts()[0].finished).toBe(phase === 'ambiguous-finish');
    } else expect(after).toEqual(before);
    if (phase.includes('finish')) expect(response.status).toBe(200);
    else {
      expect(response.status).toBe(503);
      expect(response.headers['retry-after']).toBe('60');
      expect(response.body.usage).toMatchObject({ mode: 'slow', retryAt: fixtureTime + 60_000 });
      if (continuous) {
        expect(response.body.usage.trialId).toBe(CONTINUOUS_MARKET_ID);
        expect(response.body.usage.expiresAt).toBeUndefined();
      }
    }
    f.f.config.network = network;
    expect((await f.request()).status).toBe(200);
    expect(JSON.parse(f.f.read(key)!).stoppedAt).toBeUndefined();
  },
);

it.each(['collector', 'history'] as const)('a %s admission timeout does not disable either schedule', async kind => {
  const f = fixture();
  const network = f.f.config.network;
  let commits = 0;
  f.f.config.network = async (url, init) => {
    if (String(url).endsWith(':commit')) { commits++; throw timeout(); }
    return network(url, init);
  };
  const before = f.f.read(key);
  await expect(kind === 'collector' ? f.runtime.collect('timeout') : f.runtime.collectDaily())
    .rejects.toMatchObject({ name: 'TimeoutError' });
  expect(commits).toBe(1);
  expect(f.f.read(key)).toBe(before);
  expect(f.metrics).toMatchObject({ upstreamCalls: 0, shutdowns: 0 });
});

it('does not collect twice when the first admission committed before the timeout', async () => {
  const f = fixture();
  const network = f.f.config.network;
  let commits = 0;
  f.f.config.network = async (url, init) => {
    const result = await network(url, init);
    if (String(url).endsWith(':commit')) { commits++; throw timeout(); }
    return result;
  };
  await expect(f.runtime.collect('uncertain-slot')).rejects.toMatchObject({ name: 'TimeoutError' });
  expect(commits).toBe(1);
  const held = f.f.read(key);
  f.f.config.network = network;
  await f.runtime.collect('uncertain-slot');
  expect(f.f.read(key)).toBe(held);
  expect(f.receipts()).toHaveLength(1);
  expect(f.receipts()[0].finished).toBeUndefined();
  expect(f.metrics).toMatchObject({ upstreamCalls: 0, shutdowns: 0 });
});

it('an elapsed invocation deadline produces a retry instead of an operating-period stop', async () => {
  const f = fixture(), network = f.f.config.network;
  let delayed = false;
  f.f.config.network = async (url, init) => {
    const response = await network(url, init);
    if (!delayed && String(url).endsWith(':batchGet') && String(init?.body).includes('/control')) {
      delayed = true;
      f.setNow(fixtureTime + 20_000);
    }
    return response;
  };
  const response = await f.request();
  expect(delayed).toBe(true);
  expect(response.status).toBe(503);
  expect(response.body.usage.mode).toBe('slow');
  expect(f.metrics.shutdowns).toBe(0);
  expect(JSON.parse(f.f.read(key)!).stoppedAt).toBeUndefined();
  expect((await f.request()).status).toBe(200);
});

it('a timeout after response headers while streaming the cached book remains recoverable', async () => {
  const f = fixture(true), network = f.f.config.network;
  f.f.config.network = async (url, init) => {
    if (String(url).includes('alt=media')) return new Response(new ReadableStream({
      start(controller) { controller.error(timeout()); },
    }));
    return network(url, init);
  };
  const response = await f.request();
  expect(response.status).toBe(503);
  // The existing route-level error handler already isolates snapshot failures.
  expect(response.body.usage.mode).not.toBe('paused');
  expect(f.metrics.shutdowns).toBe(0);
  expect(JSON.parse(f.f.read(key)!).stoppedAt).toBeUndefined();
  f.f.config.network = network;
  expect((await f.request()).status).toBe(200);
});

it('an ambiguous response-size reservation timeout keeps its identity through TrialSession.extend', async () => {
  const f = paidRuntimeFixture(snapshotFixture('large', fixtureTime, 1000), false, continuous);
  const network = f.f.config.network;
  let commits = 0;
  f.f.config.network = async (url, init) => {
    const response = await network(url, init);
    if (String(url).endsWith(':commit') && ++commits === 2) throw timeout();
    return response;
  };
  const response = await f.request('/api/companion/bazaar');
  expect(commits).toBe(2);
  expect(response.status).toBe(503);
  expect(response.body.usage.mode).toBe('slow');
  expect(f.metrics.shutdowns).toBe(0);
  expect(JSON.parse(f.f.read(key)!).stoppedAt).toBeUndefined();
  expect(f.receipts()[0].finished).toBeUndefined();
  f.f.config.network = network;
  expect((await f.request('/api/companion/bazaar')).status).toBe(200);
});

it('a history timeout includes a retry directive so the browser does not pause all market reads', async () => {
  const f = fixture();
  const runtime = createPaidRuntime({ continuous, expiresAt: fixtureTime + 86400000, now: () => fixtureTime,
    store: session => trialGoogleStore(f.f.config, session),
    shutdown: async () => { f.metrics.shutdowns++; },
    history: { capture: async () => { throw timeout(); }, item: async () => { throw timeout(); } },
  });
  const response = await f.request('/api/price-history?item=ITEM_0', 'GET', runtime);
  expect(response.status).toBe(503);
  expect(response.headers['retry-after']).toBe('60');
  expect(response.body.usage.mode).toBe('slow');
  expect(f.metrics.shutdowns).toBe(0);
  expect(JSON.parse(f.f.read(key)!).stoppedAt).toBeUndefined();
});

});

it('recognizes structured transport timeouts without treating ordinary stops or aborts as timeouts', () => {
  expect(isTransportTimeout(timeout())).toBe(true);
  expect(isTransportTimeout(new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }))).toBe(true);
  const cycle: { cause?: unknown } = {}; cycle.cause = cycle;
  for (const error of [Error('Timeout'), Error('Paid release expired'), new DOMException('Cancelled', 'AbortError'),
    { code: 429 }, { code: 403 }, cycle, null]) expect(isTransportTimeout(error)).toBe(false);
});

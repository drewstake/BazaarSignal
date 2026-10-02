import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_APPS_SCRIPT_URL', 'https://script.google.com/macros/s/test/exec');
  vi.stubGlobal('window', { location: { origin: 'https://bazaarsignal.web.app' } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
const success = () => new Response(JSON.stringify({ ok: true, data: { workflows: [] } }));

it.each([429, 500, 502, 503, 504])('retries an account HTTP %s once, preserving the private POST contract', async status => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status })).mockResolvedValueOnce(success());
  vi.stubGlobal('fetch', fetch);
  const { requestBackend } = await import('../src/backend');
  const result = requestBackend({ action: 'account' }, 'private-token');
  await vi.advanceTimersByTimeAsync(999);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toEqual({ workflows: [] });
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [url, init] of fetch.mock.calls) {
    expect(url).not.toContain('private-token');
    expect(init).toMatchObject({ method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });
    expect(JSON.parse(init.body)).toEqual({ action: 'account', version: 1, origin: 'https://bazaarsignal.web.app', idToken: 'private-token' });
  }
});
it('bounds persistent failures and reports their HTTP status', async () => {
  const fetch = vi.fn(async () => new Response('', { status: 503 })); vi.stubGlobal('fetch', fetch);
  const { requestBackend } = await import('../src/backend');
  const result = expect(requestBackend({ action: 'account' })).rejects.toThrow('Saved alerts could not be loaded (HTTP 503)');
  await vi.advanceTimersByTimeAsync(100000); await result;
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('retries connection failures once for account reads', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(success()); vi.stubGlobal('fetch', fetch);
  const { requestBackend } = await import('../src/backend');
  const result = requestBackend({ action: 'account' });
  await vi.advanceTimersByTimeAsync(1000); await expect(result).resolves.toEqual({ workflows: [] });
});
it.each(['create', 'update', 'disable', 'snapshot', 'book'] as const)('never automatically retries %s', async action => {
  const fetch = vi.fn(async () => new Response('', { status: 503 })); vi.stubGlobal('fetch', fetch);
  const { requestBackend } = await import('../src/backend');
  await expect(requestBackend({ action })).rejects.toThrow('HTTP 503');
  await vi.advanceTimersByTimeAsync(100000); expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([400, 401, 403, 404])('does not retry HTTP %s authorization or configuration failures', async status => {
  const fetch = vi.fn(async () => new Response('', { status })); vi.stubGlobal('fetch', fetch);
  const { requestBackend } = await import('../src/backend');
  await expect(requestBackend({ action: 'account' })).rejects.toThrow(`HTTP ${status}`);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('does not retry application errors or malformed responses', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ok:false,error:'Sign in with the verified Google account.'}))).mockResolvedValueOnce(new Response('<html>Authorization needed</html>'));
  vi.stubGlobal('fetch', fetch);
  const { requestBackend } = await import('../src/backend');
  await expect(requestBackend({ action: 'account' })).rejects.toThrow('verified Google account');
  await expect(requestBackend({ action: 'account' })).rejects.toThrow('authorization needs attention');
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('honors short Retry-After and does not shorten a long server cooldown', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', {status:429,headers:{'Retry-After':'3'}})).mockResolvedValueOnce(success()).mockResolvedValueOnce(new Response('', {status:429,headers:{'Retry-After':'120'}})); vi.stubGlobal('fetch', fetch);
  const { requestBackend } = await import('../src/backend');
  const result = requestBackend({action:'account'});
  await vi.advanceTimersByTimeAsync(2999); expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); await result;
  await expect(requestBackend({action:'account'})).rejects.toThrow('HTTP 429');
  expect(fetch).toHaveBeenCalledTimes(3);
});
it('cancels a queued retry when its caller leaves', async () => {
  const fetch = vi.fn(async () => new Response('', {status:503})); vi.stubGlobal('fetch', fetch);
  const { requestBackend } = await import('../src/backend');
  const controller = new AbortController();
  const result = expect(requestBackend({action:'account'},undefined,controller.signal)).rejects.toThrow('aborted');
  await vi.advanceTimersByTimeAsync(100); controller.abort();
  await result; await vi.advanceTimersByTimeAsync(100000); expect(fetch).toHaveBeenCalledTimes(1);
});

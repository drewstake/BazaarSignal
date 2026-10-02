import { afterEach, expect, it, vi } from 'vitest';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../src/backend', () => ({ requestBackend: request }));
afterEach(() => { vi.resetModules(); request.mockReset(); });
const user = (uid: string) => ({ uid, getIdToken: vi.fn(async () => `token-${uid}`) });

it('coalesces concurrent same-owner reads without retaining settled private data', async () => {
  let release!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValueOnce({ workflows: [] });
  const { readAccount } = await import('../src/account');
  const owner = user('one'), first = readAccount(owner), second = readAccount(owner);
  await Promise.resolve(); expect(request).toHaveBeenCalledTimes(1);
  release({workflows:[{id:'saved'}]});
  expect(await first).toEqual(await second);
  expect(await readAccount(owner)).toEqual({workflows:[]});
  expect(request).toHaveBeenCalledTimes(2);
});
it('keeps owners isolated and does not cancel the remaining reader on one unmount', async () => {
  const signals: AbortSignal[] = [], releases: Array<(value: unknown) => void> = [];
  request.mockImplementation((_request, _token, signal) => { signals.push(signal); return new Promise(resolve => releases.push(resolve)); });
  const { readAccount } = await import('../src/account');
  const owner = user('one'), other = user('two'), abort = new AbortController();
  const cancelled = expect(readAccount(owner,abort.signal)).rejects.toThrow('aborted');
  const remaining = readAccount(owner), separate = readAccount(other);
  await Promise.resolve(); expect(request).toHaveBeenCalledTimes(2);
  abort.abort(); await cancelled; expect(signals[0].aborted).toBe(false);
  releases[0]({workflows:[{id:'owner'}]}); releases[1]({workflows:[{id:'other'}]});
  expect(await remaining).toEqual({workflows:[{id:'owner'}]});
  expect(await separate).toEqual({workflows:[{id:'other'}]});
});
it('aborts when every reader leaves and lets a new reader start cleanly', async () => {
  let signal!: AbortSignal;
  request.mockImplementationOnce((_request, _token, current) => { signal = current; return new Promise((_resolve,reject) => current.addEventListener('abort', () => reject(current.reason))); }).mockResolvedValueOnce({workflows:[]});
  const { readAccount } = await import('../src/account');
  const owner = user('one'), controller = new AbortController();
  const result = expect(readAccount(owner,controller.signal)).rejects.toThrow('aborted');
  await Promise.resolve(); controller.abort(); await result; expect(signal.aborted).toBe(true);
  expect(await readAccount(owner)).toEqual({workflows:[]});
  expect(request).toHaveBeenCalledTimes(2);
});

it('reports background failures and recovery only to the current owner observers', async () => {
  request.mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValueOnce({workflows:[]}).mockResolvedValueOnce({workflows:[]});
  const { readAccount, watchAccountReads } = await import('../src/account');
  const owner = user('one'), onOwner = vi.fn(), onOther = vi.fn();
  const stop = watchAccountReads(owner,onOwner);
  watchAccountReads(user('two'),onOther);
  await expect(readAccount(owner)).rejects.toThrow('HTTP 503');
  expect(onOwner).toHaveBeenLastCalledWith(expect.objectContaining({message:'HTTP 503'}));
  await readAccount(owner); expect(onOwner).toHaveBeenLastCalledWith(null);
  stop(); await readAccount(owner); expect(onOwner).toHaveBeenCalledTimes(2);
  expect(onOther).not.toHaveBeenCalled();
});

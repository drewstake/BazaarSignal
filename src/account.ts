import type { User } from 'firebase/auth';
import type { AppData, Workflow } from '../shared/model';
import { requestBackend } from './backend';

type Account = Partial<AppData> & { workflows: Workflow[] };
type Reader = Pick<User, 'uid' | 'getIdToken'>;
type Pending = { promise: Promise<Account>; controller: AbortController; readers: number };
const pending = new WeakMap<Reader, Pending>();
const listeners = new WeakMap<Reader, Set<(error: unknown | null) => void>>();

/** Report background read recovery/failure to the mounted owner's alert board. */
export function watchAccountReads(user: Reader, listener: (error: unknown | null) => void) {
  const observers = listeners.get(user) ?? new Set();
  observers.add(listener);
  listeners.set(user, observers);
  return () => { observers.delete(listener); if (!observers.size) listeners.delete(user); };
}

/** Share only in-flight reads for the same authenticated user; never cache account data. */
export function readAccount(user: Reader, signal?: AbortSignal): Promise<Account> {
  signal?.throwIfAborted();
  let entry = pending.get(user);
  if (!entry) {
    const controller = new AbortController();
    entry = {
      controller, readers: 0,
      promise: user.getIdToken().then(token => {
        controller.signal.throwIfAborted();
        return requestBackend<Account>({ action: 'account' }, token, controller.signal);
      }),
    };
    pending.set(user, entry);
    const current = entry;
    const settled = (error: unknown | null) => {
      if (pending.get(user) === current) pending.delete(user);
      if (!controller.signal.aborted) listeners.get(user)?.forEach(listener => listener(error));
    };
    entry.promise.then(() => settled(null), settled);
  }
  const current = entry;
  current.readers++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = () => {
      if (finished) return false;
      finished = true;
      signal?.removeEventListener('abort', abort);
      if (--current.readers === 0) {
        if (pending.get(user) === current) pending.delete(user);
        current.controller.abort();
      }
      return true;
    };
    const abort = () => { if (finish()) reject(signal?.reason); };
    signal?.addEventListener('abort', abort, { once: true });
    current.promise.then(value => { if (finish()) resolve(value); }, error => { if (finish()) reject(error); });
  });
}

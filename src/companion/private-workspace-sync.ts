const key = 'bazaarsignal-private-invalidation-v1';

/** A same-origin invalidation hint contains no portfolios, tokens or preferences.
 * It is removed immediately; unavailable storage falls back to focus refresh. */
export function publishPrivateChange(uid: string) {
  try {
    localStorage.setItem(key, JSON.stringify({ uid, nonce: crypto.randomUUID() }));
    localStorage.removeItem(key);
  } catch { /* Storage is optional. */ }
}
export function watchPrivateChanges(uid: string, changed: () => void) {
  let pending: ReturnType<typeof setTimeout> | undefined;
  const receive = (event: StorageEvent) => {
    if (event.key !== key || !event.newValue || event.newValue.length > 1024) return;
    try {
      if (JSON.parse(event.newValue).uid === uid) {
        clearTimeout(pending);
        pending = setTimeout(changed, 100);
      }
    } catch { /* Ignore corrupt hints. */ }
  };
  window.addEventListener('storage', receive);
  return () => { clearTimeout(pending); window.removeEventListener('storage', receive); };
}

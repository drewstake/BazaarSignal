import type { User } from 'firebase/auth';
type TokenUser = Pick<User, 'getIdToken'>;
const listeners = new Set<(user: TokenUser, error: unknown) => void>();
export const terminalSessionError = (error: unknown) => [
  'auth/invalid-refresh-token', 'auth/user-token-expired', 'auth/user-disabled',
  'auth/user-not-found', 'auth/invalid-user-token',
].includes((error as { code?: string } | null)?.code ?? '');
export function reportSessionError(user: TokenUser, error: unknown) {
  if (terminalSessionError(error)) for (const listener of listeners) listener(user, error);
}
export function watchSessionErrors(listener: (user: TokenUser, error: unknown) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function sessionToken(user: TokenUser, forceRefresh = false) {
  const result = user.getIdToken(forceRefresh);
  void result.catch(error => reportSessionError(user, error));
  return result;
}

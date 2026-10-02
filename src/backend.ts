export interface BackendRequest { action: 'snapshot'|'book'|'companion'|'playerNames'|'account'|'create'|'update'|'disable'; [key:string]:unknown }
export const backendUrl = import.meta.env.VITE_APPS_SCRIPT_URL || '';
export function validBackendUrl(value:string) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value);
}
export async function requestBackend<T>(request:BackendRequest, idToken?:string, signal?:AbortSignal):Promise<T> {
  if (!validBackendUrl(backendUrl)) throw new Error('The email backend is not configured yet.');
  // A CORS simple request avoids Apps Script's unsupported OPTIONS preflight.
  // Never use no-cors (opaque success), JSONP, credentials, tokens in URLs, or an Authorization header.
  let response:Response;
  try {
    response=await fetch(backendUrl,{method:'POST',mode:'cors',credentials:'omit',redirect:'follow',
      headers:{'Content-Type':'text/plain;charset=UTF-8'},referrerPolicy:'no-referrer',
      body:JSON.stringify({...request,version:1,origin:window.location.origin,...(idToken?{idToken}:{})}),
      signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000)});
  } catch { throw new Error('Cannot reach the email backend. Check the connection and retry; your request will not be duplicated.'); }
  if (!response.ok) throw new Error('The email backend is unavailable.');
  let body:any;
  try { body=await response.json(); } catch { throw new Error('The backend deployment or Google authorization needs attention.'); }
  if (body.ok!==true) throw new Error(typeof body.error==='string'?body.error:'Backend request failed.');
  return body.data as T;
}

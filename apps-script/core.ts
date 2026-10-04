import { evaluate, isFresh, isValidSample, parseBook } from '../shared/market';
import { newPriceAlert, validatePriceAlert } from '../shared/price-alert';
import type { Book, PriceAlertInput, ProductPrice, Workflow } from '../shared/model';

export type DeliveryState = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';
export interface Mail {
  id: string; alertId: string; kind: 'confirmation' | 'target' | 'portfolio';
  status: DeliveryState; attempts: number; nextAttempt: number;
  sentAt?: number; leaseUntil: number; error: string | null;
  quote?: { side: 'buy'|'sell'; unit: number; total: number; timestamp: number };
  portfolio?: { notificationId:string; revision:number; holdingRevision:number; direction:'up'|'down'; percent:number; baseline:number; price:number; sampledAt:number; source:string; portfolioId:string; holdingId:string };
}
export interface RecordAlert {
  workflow: Workflow; fingerprint: string; tokenHash: string;
  recipient: string; test: boolean;
}
export interface State {
  schema: 1; ownerUid: string; alerts: RecordAlert[]; mail: Mail[];
  monitor: { lastAttempt: number; lastSuccess: number; lastUpdated: number;
    error: string | null; quota: number | null; enabled: boolean; nextAttempt: number; failures: number };
}
export interface Market { timestamp: number; prices: ProductPrice[]; books: Record<string, Book> }
export function emptyState(ownerUid: string): State {
  return { schema: 1, ownerUid, alerts: [], mail: [], monitor: {
    lastAttempt: 0, lastSuccess: 0, lastUpdated: 0, error: null, quota: null,
    enabled: false, nextAttempt: 0, failures: 0,
  }};
}
export function parseMarket(raw: any, now: number, names: Record<string, string> = {}): Market {
  if (!isFresh(raw?.lastUpdated, now)) throw new Error('Market data is stale or malformed.');
  return parseSampledMarket(raw, now, names);
}
/** Public browsing only. Alert workers must keep using parseMarket/evaluate. */
export function parseSampledMarket(raw: any, now: number, names: Record<string, string> = {}): Market {
  if (raw?.success !== true || !isValidSample(raw.lastUpdated, now) || !raw.products ||
      typeof raw.products !== 'object' || Array.isArray(raw.products)) throw new Error('Market data is stale or malformed.');
  const books: Record<string, Book> = {}, prices: ProductPrice[] = [];
  for (const [id, value] of Object.entries(raw.products)) {
    if (!/^[A-Za-z0-9_:\-]{1,100}$/.test(id)) continue;
    try {
      const book = parseBook(value);
      books[id] = book;
      const v = (value as any).quick_status?.buyMovingWeek;
      prices.push({ id, name: names[id] || id.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, c=>c.toUpperCase()),
        buy: book.buy[0]?.pricePerUnit ?? null, sell: book.sell[0]?.pricePerUnit ?? null,
        volume: typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0 });
    } catch { /* Suppress the entire malformed product, never salvage a partial book. */ }
  }
  if (!prices.length) throw new Error('No valid market prices.');
  return { timestamp: raw.lastUpdated, books, prices: prices.sort((a,b)=>a.name.localeCompare(b.name)) };
}
export function fingerprint(input: PriceAlertInput) {
  validatePriceAlert(input);
  return JSON.stringify([input.itemId, input.side, input.quantity, input.target, input.taxRate]);
}
function enqueue(state: State, alertId: string, kind: Mail['kind'], now: number, quote?: Mail['quote']) {
  const id = `${alertId}-${kind}`;
  if (!state.mail.some(m=>m.id===id)) state.mail.push({ id, alertId, kind, status:'queued', attempts:0,
    nextAttempt:now, leaseUntil:0, error:null, ...(quote ? {quote} : {}) });
}
export function createAlert(state: State, input: PriceAlertInput, market: Market,
  recipient: string, tokenHash: string, now: number, test = false) {
  const fp = fingerprint(input), existing = state.alerts.find(a=>a.workflow.id===input.requestId);
  if (existing) {
    if (existing.fingerprint !== fp || existing.test !== test) throw new Error('Request ID already used for different alert settings.');
    return existing;
  }
  if (state.alerts.filter(a=>!a.workflow.paused && a.workflow.stage!=='completed').length >= 20)
    throw new Error('You can have at most 20 active alerts.');
  // Retain request IDs: an old retry must never become a new alert or delivery.
  if (state.alerts.length >= 100) throw new Error('The 100 stored-alert limit for your account is reached.');
  if (!isFresh(market.timestamp, now)) throw new Error('Wait for fresh market data.');
  const product = market.prices.find(p=>p.id===input.itemId);
  if (!product) throw new Error('Item unavailable.');
  const alert = { workflow: newPriceAlert(input.requestId, product.name, input, now),
    fingerprint: fp, tokenHash, recipient, test };
  state.alerts.push(alert); enqueue(state, input.requestId, 'confirmation', now);
  return alert;
}
export function disableAlert(state: State, hash: string, now: number) {
  const alert = state.alerts.find(a=>a.tokenHash === hash);
  if (!alert) throw new Error('Invalid alert link.');
  alert.workflow.paused = true; alert.workflow.updatedAt = now;
  for (const mail of state.mail) if (mail.alertId===alert.workflow.id && mail.status!=='sent') {
    mail.status = 'cancelled'; mail.error = null; mail.leaseUntil = 0;
  }
}
export function poll(state: State, market: Market, now: number) {
  if (!isFresh(market.timestamp, now)) throw new Error('Market data is stale.');
  for (const alert of state.alerts) {
    if (alert.test) continue; // Test alerts can only be evaluated by the explicit editor test.
    const w = alert.workflow;
    if (state.mail.find(m=>m.alertId===w.id && m.kind==='confirmation')?.status !== 'sent') continue;
    const quote = evaluate(w, market.books[w.itemId], market.timestamp, w.taxRate ?? 1.25, now);
    if (!quote) continue;
    w.stage = 'completed'; w.updatedAt = now;
    enqueue(state, w.id, 'target', now, { side:quote.side, unit:quote.unit, total:quote.total, timestamp:market.timestamp });
  }
}
export function enqueueTestTarget(state: State, id: string, market: Market, now: number) {
  const a = state.alerts.find(a=>a.workflow.id===id && a.test);
  if (!a || state.mail.find(m=>m.alertId===id && m.kind==='confirmation')?.status!=='sent') throw new Error('Send the test confirmation first.');
  const quote = evaluate(a.workflow, market.books[a.workflow.itemId], market.timestamp, a.workflow.taxRate ?? 1.25, now);
  if (!quote) return false;
  a.workflow.stage = 'completed'; a.workflow.updatedAt=now;
  enqueue(state,id,'target',now,{side:quote.side,unit:quote.unit,total:quote.total,timestamp:market.timestamp}); return true;
}
export const retryDelay = (attempt: number) => [60_000, 300_000, 900_000, 3_600_000][Math.min(Math.max(attempt-1,0),3)];
export function failMail(mail: Mail, now: number) {
  mail.status = mail.attempts >= 5 ? 'failed' : 'queued';
  mail.error = 'Mail delivery could not be confirmed. A bounded retry may duplicate an ambiguous send.';
  mail.nextAttempt = now + retryDelay(mail.attempts); mail.leaseUntil = 0;
}
export interface DeliveryIO { now():number; quota():number; save():void; send(mail:Mail, alert:RecordAlert):void;
  receipt(id:string):number|null; remember(id:string, at:number):void; forget?(id:string):void; budgetExpired():boolean }
export function deliver(state:State, io:DeliveryIO, onlyTest = false) {
  let budget = io.quota(); state.monitor.quota = budget;
  for (const mail of state.mail) {
    const alert = state.alerts.find(a=>a.workflow.id===mail.alertId)!;
    if (alert.test !== onlyTest || ['sent','failed','cancelled'].includes(mail.status)) continue;
    const receipt = io.receipt(mail.id);
    if (receipt) { mail.status='sent'; mail.sentAt=receipt; mail.leaseUntil=0; mail.error=null; io.save(); io.forget?.(mail.id); continue; }
    if (alert.workflow.paused) { mail.status='cancelled'; io.save(); continue; }
    if (mail.status==='sending') {
      if (mail.leaseUntil > io.now()) continue;
      failMail(mail, io.now()); io.save(); continue;
    }
    if (mail.nextAttempt>io.now() || io.budgetExpired()) continue;
    if (mail.kind==='target' && state.mail.find(m=>m.alertId===mail.alertId && m.kind==='confirmation')?.status!=='sent') continue;
    budget=Math.min(budget,io.quota()); state.monitor.quota=budget;
    if (budget<1) { mail.error='Daily email quota exhausted; queued until quota is available.'; mail.nextAttempt=io.now()+3_600_000; io.save(); continue; }
    mail.status='sending'; mail.attempts++; mail.leaseUntil=io.now()+600_000; mail.error=null;
    io.save(); // Must persist before crossing MailApp's non-transactional boundary.
    try { io.send(mail,alert); } catch { failMail(mail,io.now()); io.save(); continue; }
    budget--; const at=io.now();
    // Independent receipt reduces Firestore-outage duplicates; no provider idempotency exists.
    io.remember(mail.id,at);
    mail.status='sent'; mail.sentAt=at; mail.leaseUntil=0; mail.error=null;
    state.monitor.quota=budget; io.save(); io.forget?.(mail.id);
  }
}
export function publicState(state:State) {
  return { workflows: state.alerts.filter(a=>!a.test).map(a=>a.workflow),
    events: state.mail.filter(m=>!state.alerts.find(a=>a.workflow.id===m.alertId)?.test).map(m=>({
      id:m.id, workflowId:m.alertId, itemName:state.alerts.find(a=>a.workflow.id===m.alertId)!.workflow.itemName,
      side:m.kind==='confirmation'?'created':m.quote?.side, createdAt:state.alerts.find(a=>a.workflow.id===m.alertId)!.workflow.createdAt,
      marketTimestamp:m.quote?.timestamp ?? 0, message:'', pending:['queued','sending'].includes(m.status),
      deliveries:{email:{status:m.status,attempts:m.attempts,nextAttempt:m.nextAttempt,leaseUntil:m.leaseUntil,error:m.error,...(m.sentAt?{sentAt:m.sentAt}:{})}}
    })), monitoring: state.monitor };
}

import { createHash } from 'node:crypto';

export const PAID_BUDGET_KEY = 'paid-budget-october';
export const PAID_ADMISSION_LIMIT = 4000;
// Existing inline receipts remain readable until this fixed pilot expires.
// A Firestore string can nearly fill a 1 MiB document; JSON escaping can double
// its wire size. This larger bound applies ONLY to the legacy paid ledger.
export const PAID_LEDGER_READ_LIMIT = 2 * 1024 ** 2 + 4096;
export const PAID_RECEIPT_LIMIT = 1024;
export const paidReceiptKey = (budget: string, invocation: string) =>
  'paid-receipt-' + createHash('sha256').update(`${budget}\0${invocation}`).digest('hex')
    .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
export const isPaidReceiptKey = (key: string) => /^paid-receipt-[a-p]{64}$/.test(key);

export interface PaidReceipt {
  version: 1;
  budget: string;
  invocation: string;
  at: number;
  finished?: boolean;
}

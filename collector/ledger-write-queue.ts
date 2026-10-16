/** Smooth writes to the shared ledger within a warm runtime. Durable CAS still
 * arbitrates other instances; this queue never replaces budget admission. */
export class LedgerWriteQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private nextAt = 0;
  constructor(private intervalMs: number) {}
  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      const delay = this.nextAt - Date.now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      try { return await work(); }
      finally { this.nextAt = Date.now() + this.intervalMs; }
    });
    this.tail = next.catch(() => {});
    return next;
  }
}

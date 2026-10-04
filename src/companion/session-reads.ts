/** Private, in-memory reads owned by one mounted authenticated workspace. */
export class SessionReads {
  private entries = new Map<string, { at: number; promise: Promise<unknown> }>();
  constructor(private now = Date.now) {}
  read<T>(key: string, load: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key);
    if (entry && this.now() - entry.at < 60_000) return entry.promise as Promise<T>;
    const promise = Promise.resolve().then(load);
    if (this.entries.size >= 20) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { at: this.now(), promise });
    void promise.catch(() => {
      if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
    });
    return promise;
  }
  invalidate(prefix?: string) {
    for (const key of this.entries.keys()) if (!prefix || key.startsWith(prefix)) this.entries.delete(key);
  }
}

import type { Snapshot } from "./engine";

const keys = new Set(["catalog", "election", "bazaar", "auctions"]);
function freeze(value: any): any {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

/** Immutable payloads only; callers first read durable coordination. Bytes bound
 * retained JSON weight, not exact V8 heap. Sizing must include decoded expansion
 * and active requests. At most four entries / four in-flight generations. */
export class SnapshotReadCache {
  private entries = new Map<
    string,
    { tag: string; value: Snapshot<any>; bytes: number }
  >();
  private bytes = 0;
  private pending = new Map<
    string,
    { tag: string; work: Promise<Snapshot<any> | null> }
  >();
  constructor(readonly maxBytes = 48 * 1024 ** 2) {}
  async read<T>(
    key: string,
    tag: string,
    load: () => Promise<string | null>,
  ): Promise<Snapshot<T> | null> {
    if (!keys.has(key)) throw new Error("Not an immutable market snapshot");
    const cached = this.entries.get(key);
    if (cached?.tag === tag) return cached.value;
    const pending = this.pending.get(key);
    if (pending) {
      // Bound parallel decoding to one generation per key. A newer caller
      // waits, then loads its generation; it never receives the old one.
      if (pending.tag === tag) return pending.work;
      try {
        await pending.work;
      } catch {
        /* Another generation may recover. */
      }
      return this.read(key, tag, load);
    }
    if (cached) {
      this.bytes -= cached.bytes;
      this.entries.delete(key);
    }
    const work = (async () => {
      const raw = await load();
      if (raw === null) return null;
      const value = JSON.parse(raw) as Snapshot<T>;
      const bytes = Buffer.byteLength(raw);
      if (bytes <= this.maxBytes) {
        freeze(value);
        while (this.bytes + bytes > this.maxBytes && this.entries.size) {
          const first = this.entries.keys().next().value!;
          this.bytes -= this.entries.get(first)!.bytes;
          this.entries.delete(first);
        }
        this.entries.set(key, { tag, value, bytes });
        this.bytes += bytes;
      }
      return value;
    })();
    this.pending.set(key, { tag, work });
    try {
      return await work;
    } finally {
      if (this.pending.get(key)?.work === work) this.pending.delete(key);
    }
  }
  get retainedBytes() {
    return this.bytes;
  }
}

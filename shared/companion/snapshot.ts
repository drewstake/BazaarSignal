import { isFresh } from "../market";
export type FetchJson = (path: string) => Promise<any>;
export async function consistentSnapshot(
  fetchJson: FetchJson,
  options: {
    now?: () => number;
    firstPage?: (page: any) => Promise<void>;
  } = {},
): Promise<{ auctions: any[]; lastUpdated: number }> {
  const first = await fetchJson("skyblock/auctions?page=0");
  if (
    !Number.isSafeInteger(first.totalPages) ||
    first.totalPages < 1 ||
    first.totalPages > 200 ||
    first.success === false ||
    !Number.isSafeInteger(first.totalAuctions) ||
    first.totalAuctions < 0 ||
    !isFresh(first.lastUpdated, (options.now ?? Date.now)()) ||
    first.page !== 0 ||
    !Array.isArray(first.auctions)
  )
    throw new Error("Invalid auction snapshot");
  await options.firstPage?.(first);
  const all = [...first.auctions];
  // Small batches respect upstream pressure. Commit only after EVERY page agrees.
  for (let page = 1; page < first.totalPages; page += 3) {
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(3, first.totalPages - page) }, (_, i) =>
        fetchJson(`skyblock/auctions?page=${page + i}`),
      ),
    );
    // Drain in-flight pages before a failure releases the shared lease.
    const pages = results.map((r) => {
      if (r.status === "rejected") throw r.reason;
      return r.value;
    });
    pages.forEach((p, i) => {
      if (
        p.success === false ||
        p.page !== page + i ||
        p.totalAuctions !== first.totalAuctions ||
        p.lastUpdated !== first.lastUpdated ||
        p.totalPages !== first.totalPages ||
        !Array.isArray(p.auctions)
      )
        throw new Error(
          "Auction snapshot changed during pagination; previous cache preserved.",
        );
      all.push(...p.auctions);
    });
  }
  const ids = new Set(all.map((x) => x.uuid));
  if (
    all.some((x) => typeof x.uuid !== "string" || !x.uuid) ||
    ids.size !== all.length ||
    all.length !== first.totalAuctions
  )
    throw new Error("Partial or duplicate auction snapshot");
  if (!isFresh(first.lastUpdated, (options.now ?? Date.now)()))
    throw new Error(
      "Auction snapshot expired during pagination; previous cache preserved.",
    );
  return { auctions: all, lastUpdated: first.lastUpdated };
}

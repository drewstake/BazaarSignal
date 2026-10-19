/** Bounded reads and deadlines apply to body streaming as well as headers. */
export async function historyDownload(
  url: string,
  limit: number,
  network: typeof fetch = fetch,
): Promise<Buffer> {
  const response = await network(url, {
    redirect: "error",
    signal: AbortSignal.timeout(45_000),
    headers: {
      Accept: "application/json,application/octet-stream",
      "User-Agent": "BazaarSignal-history-import/1",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  if (Number(response.headers.get("content-length")) > limit)
    throw new Error("History download exceeds size limit");
  if (!response.body) throw new Error("Empty history response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("History download exceeds size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks, size);
}

/** An explicit development-only read of the local SQLite snapshot. This does
 * not grant permission to read a remote service or resume market collection. */
export function localPreviewMarketRead(url: string) {
  if (
    !import.meta.env.DEV ||
    import.meta.env.PROD ||
    import.meta.env.VITE_LOCAL_MARKET_PREVIEW !== "true"
  )
    return false;
  const target = new URL(url);
  return (
    target.origin === location.origin &&
    ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) &&
    target.pathname === "/api/companion/portfolio-prices" &&
    [...target.searchParams].length === 1 &&
    /^bz_[A-Za-z0-9_:-]{1,100}$/.test(target.searchParams.get("assets") ?? "")
  );
}

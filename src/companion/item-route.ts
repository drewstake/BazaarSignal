/** Hash routes work on the existing static host without new server routes. */
export const itemPageHash = (itemId: string) =>
  `#${new URLSearchParams({ view: "item", item: itemId })}`;

/** Share only the public item route, never session/query/private-view parameters. */
export function itemPageUrl(itemId: string, base = location.href) {
  const url = new URL(base);
  url.search = "";
  url.hash = itemPageHash(itemId);
  return url.href;
}

/** Presentation only: preserve internal freshness states and cached payloads. */
export function marketStatusLabel(status:string) {
  return status === 'stale' ? 'Awaiting price check' : status;
}

/** Older cached APIs may still return the previous freshness terminology. */
export function marketMessage(text:string) {
  return text
    .replace(/Listing is stale or unavailable/gi, 'Listing needs a fresh price check or is unavailable')
    .replace(/Listing stale/gi, 'Listing needs a fresh price check')
    .replace(/snapshot stale/gi, 'snapshot needs a fresh price check')
    .replace(/\bstale\b/g, 'older')
    .replace(/\bStale\b/g, 'Older');
}

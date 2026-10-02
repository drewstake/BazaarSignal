import { useEffect, useState } from "react";
import type { AppData, Book } from "../shared/model";
import { isFresh } from "../shared/market";
import { fetchItemBook } from "./alerts";
import { isLocal } from "./data";
import { visiblePoll } from "./companion/polling";

/** An alert quote always comes from depth for its full quantity, never a spot price. */
export function useAlertBook(itemId: string, data: AppData) {
  const [snapshot, setSnapshot] = useState<{
    book: Book;
    timestamp: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((v) => v + 1), 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (isLocal) return;
    let closed = false,
      pending = false;
    setSnapshot(null);
    setError("");
    const load = async (signal: AbortSignal) => {
      if (pending) return;
      pending = true;
      try {
        const result = await fetchItemBook(itemId, signal);
        if (!closed) {
          setSnapshot((prev) =>
            prev?.timestamp === result.timestamp ? prev : result,
          );
          setError("");
        }
      } catch (e) {
        if (!closed)
          setError(e instanceof Error ? e.message : "Price unavailable");
      } finally {
        pending = false;
      }
    };
    const stop = visiblePoll(load, 60000);
    return () => {
      closed = true;
      stop();
    };
  }, [itemId]);
  const book = isLocal ? data.books[itemId] : snapshot?.book;
  const timestamp = isLocal
    ? data.status.lastUpdated
    : (snapshot?.timestamp ?? 0);
  const failure = isLocal ? data.status.error : error;
  return {
    book,
    timestamp,
    error: failure,
    stale: !isFresh(timestamp) || Boolean(failure),
  };
}

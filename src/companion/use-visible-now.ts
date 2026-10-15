import { useEffect, useState } from "react";

/** Display-only clock. Resume with the actual time; never changes market cadence. */
export function useVisibleNow(interval: number, enabled = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => setNow(Date.now());
    const visibility = () => {
      clearInterval(timer);
      if (document.visibilityState !== "hidden") {
        update();
        if (enabled) timer = setInterval(update, interval);
      }
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("market-usage-policy", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("market-usage-policy", update);
    };
  }, [interval, enabled]);
  return now;
}

import { configuredStore } from "../collector/cache-store";
import { configuredPolicy } from "../collector/policy";
import type { Control } from "../collector/coordinator";

// Offline policy migration. Never clears an unexpired request budget or source snapshot.
const store = await configuredStore();
try {
  const raw = await store.read("control"),
    policy = configuredPolicy();
  if (!raw) {
    console.log(
      "No existing control state. The collector will initialize this policy on first start.",
    );
  } else {
    const c: Control = JSON.parse(raw),
      now = store.time ? await store.time() : Date.now();
    const lastRequest = Math.max(0, ...c.requests.map((r) => r.at));
    const safeAt = Math.max(
      c.lease?.until ?? 0,
      lastRequest + Math.max(c.policy.windowMs, policy.windowMs),
    );
    if (JSON.stringify(c.policy) === JSON.stringify(policy))
      console.log("Shared policy already matches.");
    else {
      if (now < safeAt)
        throw new Error(
          `Stop every worker and wait until ${new Date(safeAt).toISOString()} before changing policy.`,
        );
      c.policy = policy;
      c.revision++;
      c.lease = null;
      if (!(await store.commit("control", raw, JSON.stringify(c))))
        throw new Error(
          "Another worker changed the state. Stop every worker before retrying.",
        );
      console.log(
        "Shared policy changed; snapshots, counters and cooldowns preserved.",
      );
    }
  }
} finally {
  await store.close();
}

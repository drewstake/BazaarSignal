/** Existing-resource shutdown only; never creates jobs, changes billing or deletes data. */
export interface ShutdownConfig {
  project: string;
  token: () => Promise<string>;
  network?: typeof fetch;
}
export async function stopTrialInfrastructure(config: ShutdownConfig) {
  const network = config.network ?? fetch;
  const root = `projects/${config.project}/locations/us-central1`;
  const job = `https://cloudscheduler.googleapis.com/v1/${root}/jobs/firebase-schedule-refreshMarket-us-central1`;
  const api = `https://run.googleapis.com/v1/${root}/services/marketapi`;
  async function call(url: string, method = "GET", body?: unknown) {
    const token = await config.token();
    const response = await network(url, {
      method,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Trial shutdown HTTP ${response.status}`);
    return response.json();
  }
  // One failure must never prevent attempting the other independent containment action.
  const result = await Promise.allSettled([
    (async () => {
      const current = await call(job);
      if (current.state === "ENABLED") await call(`${job}:pause`, "POST", {});
      const after = await call(job);
      if (after.state !== "PAUSED")
        throw new Error("Scheduler shutdown is unverified");
    })(),
    (async () => {
      const policy = await call(`${api}:getIamPolicy?options.requestedPolicyVersion=3`);
      const hasPublic = (p: any) =>
        (p.bindings ?? []).some(
          (b: any) =>
            b.role === "roles/run.invoker" &&
            b.members?.some(
              (m: string) => m === "allUsers" || m === "allAuthenticatedUsers",
            ),
        );
      if (hasPublic(policy)) {
        policy.bindings = (policy.bindings ?? [])
          .map((b: any) =>
            b.role === "roles/run.invoker"
              ? {
                  ...b,
                  members: b.members.filter(
                    (m: string) =>
                      m !== "allUsers" && m !== "allAuthenticatedUsers",
                  ),
                }
              : b,
          )
          .filter((b: any) => b.members.length);
        await call(`${api}:setIamPolicy`, "POST", { policy });
      }
      if (hasPublic(await call(`${api}:getIamPolicy?options.requestedPolicyVersion=3`)))
        throw new Error("API shutdown is unverified");
    })(),
  ]);
  const errors = result.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  if (errors.length)
    throw new AggregateError(
      errors.map((r) => r.reason),
      "Trial infrastructure shutdown incomplete",
    );
}

import { expect, it, vi } from "vitest";
import { stopTrialInfrastructure } from "../collector/trial-shutdown";
it("shutdown pauses the existing job and removes only public invokers, preserving IAM etag and other bindings", async () => {
  let job = "ENABLED",
    policy: any = {
      etag: "known",
      version: 3,
      bindings: [
        {
          role: "roles/run.invoker",
          members: ["allUsers", "allAuthenticatedUsers", "serviceAccount:kept"],
        },
        { role: "roles/run.viewer", members: ["user:kept"] },
      ],
    };
  const network = vi.fn(async (input: any, init?: RequestInit) => {
    const url = String(input).split("?")[0];
    if (url.endsWith(":pause")) {
      job = "PAUSED";
      return Response.json({ state: job });
    }
    if (url.endsWith(":getIamPolicy")) return Response.json(policy);
    if (url.endsWith(":setIamPolicy")) {
      policy = JSON.parse(String(init?.body)).policy;
      return Response.json(policy);
    }
    return Response.json({ state: job });
  });
  await stopTrialInfrastructure({
    project: "fixture",
    token: async () => "fixture",
    network,
  });
  expect(job).toBe("PAUSED");
  expect(policy).toEqual({
    etag: "known",
    version: 3,
    bindings: [
      { role: "roles/run.invoker", members: ["serviceAccount:kept"] },
      { role: "roles/run.viewer", members: ["user:kept"] },
    ],
  });
  const before = network.mock.calls.length;
  await stopTrialInfrastructure({
    project: "fixture",
    token: async () => "fixture",
    network,
  });
  expect(
    network.mock.calls
      .slice(before)
      .every(([, init]) => init?.method === "GET"),
  ).toBe(true);
});
it("one failed containment action does not prevent the other, and no partial success is reported as complete", async () => {
  let paused = false;
  const network = vi.fn(async (input: any) => {
    const url = String(input);
    if (url.includes("run.googleapis.com"))
      return Response.json({ error: "denied" }, { status: 403 });
    if (url.endsWith(":pause")) paused = true;
    return Response.json({ state: paused ? "PAUSED" : "ENABLED" });
  });
  await expect(
    stopTrialInfrastructure({
      project: "fixture",
      token: async () => "fixture",
      network,
    }),
  ).rejects.toThrow("incomplete");
  expect(paused).toBe(true);
});

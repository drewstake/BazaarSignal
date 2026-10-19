import { expect, it } from "vitest";
// @ts-expect-error operator scripts intentionally remain native ES modules
import { observedRepositoryBytes } from "../scripts/private-trial-release.mjs";
it("requires complete independent evidence when the repository aggregate is absent", () => {
  expect(observedRepositoryBytes({repository:{sizeBytes:"123"}})).toBe(123);
  expect(()=>observedRepositoryBytes({repository:{}})).toThrow("evidence");
  expect(()=>observedRepositoryBytes({repository:{},repositoryFiles:{nextPageToken:"more",files:[]}})).toThrow("evidence");
  expect(observedRepositoryBytes({repository:{},repositoryFiles:{}})).toBe(0);
  const file={name:"projects/bazaarsignal-510305/locations/us-central1/repositories/gcf-artifacts/files/blob",sizeBytes:"321"};
  expect(observedRepositoryBytes({repository:{},repositoryFiles:{files:[file]}})).toBe(321);
  expect(()=>observedRepositoryBytes({repository:{},repositoryFiles:{files:[{...file,sizeBytes:undefined}]}})).toThrow("inventory");
});

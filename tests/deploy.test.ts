import { describe, expect, it } from "vitest";
import { deployableRun, verifyRollout } from "../scripts/deploy.mjs";

const sha = "a".repeat(40);
const run = {
  conclusion: "success", event: "push", path: ".github/workflows/ci.yml",
  head_branch: "main", head_sha: sha, head_repository: { full_name: "harmittaa/junction_2026" },
};

describe("production deployment boundary", () => {
  it("accepts only successful push CI for the current main commit", () => {
    expect(deployableRun({ workflow_run: run }, sha)).toBe(true);
    expect(deployableRun({ workflow_run: run }, "b".repeat(40))).toBe(false);
    for (const patch of [
      { conclusion: "failure" }, { conclusion: "cancelled" }, { event: "pull_request" },
      { event: "workflow_dispatch" }, { head_branch: "feature" },
      { path: ".github/workflows/other.yml" }, { head_repository: { full_name: "other/repo" } },
    ]) expect(deployableRun({ workflow_run: { ...run, ...patch } }, sha)).toBe(false);
  });

  it("requires this uploaded build to be ready and serving all traffic, not an old healthy revision", () => {
    const archive = "gs://firebaseapphosting-sources-967386564020-europe-west4/new.zip";
    const rollout = { state: "SUCCEEDED", build: "backends/sponky/builds/new" };
    const build = { name: rollout.build, state: "READY", image: "registry/new", source: { archive: { userStorageUri: archive } } };
    const service = {
      terminalCondition: { state: "CONDITION_SUCCEEDED" }, generation: "3", observedGeneration: "3",
      latestReadyRevision: "services/sponky/revisions/new", latestCreatedRevision: "services/sponky/revisions/new",
      template: { containers: [{ image: build.image }] }, trafficStatuses: [{ revision: "new", percent: 100 }, { revision: "old", tag: "preview" }],
    };
    expect(() => verifyRollout(rollout, build, service, archive)).not.toThrow();
    expect(() => verifyRollout({ ...rollout, state: "FAILED" }, build, service, archive)).toThrow("did not succeed");
    expect(() => verifyRollout(rollout, build, service, archive.replace("new.zip", "old.zip"))).toThrow("this source upload");
    for (const patch of [
      { observedGeneration: "2" }, { reconciling: true }, { latestCreatedRevision: "services/sponky/revisions/newer" },
      { template: { containers: [{ image: "registry/old" }] } },
      { trafficStatuses: [{ revision: "new", percent: 95 }, { revision: "old", percent: 5 }] },
      { trafficStatuses: [{ revision: "new", percent: 99 }] },
    ]) expect(() => verifyRollout(rollout, build, { ...service, ...patch }, archive)).toThrow();
  });
});

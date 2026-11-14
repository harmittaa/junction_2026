// Existing production resources only. No provider calls or IAM mutations.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, appendFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const project = "sponky-junction-2026";
const backend = `projects/${project}/locations/europe-west4/backends/sponky`;
const serviceName = `projects/${project}/locations/europe-west4/services/sponky`;
const appOrigin = "https://sponky--sponky-junction-2026.europe-west4.hosted.app";
const publicOrigin = "https://sponky.web.app";

export function deployableRun(event, mainSha) {
  const run = event.workflow_run;
  return run?.conclusion === "success" && run.event === "push" &&
    run.path === ".github/workflows/ci.yml" && run.head_branch === "main" &&
    run.head_repository?.full_name === "harmittaa/junction_2026" &&
    /^[a-f0-9]{40}$/.test(run.head_sha) && run.head_sha === mainSha;
}

export function verifyRollout(rollout, build, service, archive) {
  assert.equal(rollout.state, "SUCCEEDED", "App Hosting rollout did not succeed");
  assert.equal(!!rollout.reconciling, false, "Rollout is still reconciling");
  assert.equal(build.name, rollout.build, "Rollout/build mismatch");
  assert.equal(build.state, "READY", "Build is not ready");
  assert.ok(archive?.startsWith("gs://firebaseapphosting-sources-967386564020-europe-west4/"), "No uploaded source archive");
  assert.equal(build.source?.archive?.userStorageUri, archive, "Rollout is not from this source upload");
  assert.equal(service.terminalCondition?.state, "CONDITION_SUCCEEDED", "Cloud Run is not ready");
  assert.equal(!!service.reconciling, false, "Service is still reconciling");
  assert.equal(service.observedGeneration, service.generation, "Service generation is not ready");
  assert.ok(service.latestReadyRevision, "No ready revision");
  assert.equal(service.latestReadyRevision, service.latestCreatedRevision, "Newest revision is not ready");
  assert.ok(build.image, "Build has no image");
  assert.equal(service.template?.containers?.[0]?.image, build.image, "Serving image differs from build");
  const serving = service.trafficStatuses?.filter(target => target.percent > 0) ?? [];
  assert.equal(serving.reduce((sum, target) => sum + target.percent, 0), 100, "Traffic is not fully assigned");
  assert.ok(serving.every(target => service.latestReadyRevision.endsWith(`/revisions/${target.revision}`)), "Traffic still serves another revision");
}

async function deploy() {
  assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_run", "Only successful main CI can deploy");
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const mainHead = () => execFileSync("gh", ["api", "repos/harmittaa/junction_2026/git/ref/heads/main", "--jq", ".object.sha"], { encoding: "utf8" }).trim();
  if (!deployableRun(event, mainHead())) {
    console.log("Skipping: this is not successful CI for the current main head.");
    return;
  }
  const sha = event.workflow_run.head_sha;
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sha, "Checkout differs from checked commit");
  assert.ok(!readdirSync(".").some(name => /^gha-creds-.*\.json$/.test(name)), "Refusing to archive GitHub credentials; move them outside the source first");
  async function getAccessToken() {
    const runnerTemp = process.env.RUNNER_TEMP;
    if (runnerTemp && existsSync(`${runnerTemp}/firebase-cli/node_modules/google-auth-library/package.json`)) {
      const require = createRequire(`${runnerTemp}/firebase-cli/package.json`);
      const { GoogleAuth } = require("google-auth-library");
      const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
      const client = await auth.getClient();
      const tokenResponse = await client.getAccessToken();
      const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
      assert.ok(token, "Failed to acquire Google access token");
      return token;
    }
    const { applicationDefault } = await import("firebase-admin/app");
    const { access_token } = await applicationDefault().getAccessToken();
    assert.ok(access_token, "Failed to acquire Firebase access token");
    return access_token;
  }
  async function api(url) {
    const token = await getAccessToken();
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
    assert.ok(response.ok, `Cloud read failed: HTTP ${response.status} at ${url}`);
    return response.json();
  }
  async function rollouts() {
    const result = [];
    let token = "";
    do {
      const page = await api(`https://firebaseapphosting.googleapis.com/v1beta/${backend}/rollouts?pageSize=100&pageToken=${encodeURIComponent(token)}`);
      assert.ok(!page.unreachable?.length, "Rollout listing is incomplete");
      result.push(...(page.rollouts ?? []));
      token = page.nextPageToken ?? "";
    } while (token);
    return result;
  }
  const before = await rollouts();
  assert.ok(before.every(rollout => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(rollout.state) && !rollout.reconciling), "Another rollout is active; refusing overlapping deployment");
  // Recheck after setup and cloud reads: queued/out-of-order CI must not roll back main.
  if (!deployableRun(event, mainHead())) {
    console.log("Skipping: main advanced during deployment setup.");
    return;
  }
  async function firebase(target) {
    let output = "";
    await new Promise((resolve, reject) => {
      const child = spawn(`${process.env.RUNNER_TEMP}/firebase-cli/node_modules/.bin/firebase`, ["deploy", "--only", target, "--project", project, "--non-interactive", "--message", sha], { stdio: ["ignore", "pipe", "inherit"] });
      child.stdout.on("data", chunk => { process.stdout.write(chunk); output += chunk; });
      child.on("error", reject);
      child.on("close", code => code === 0 ? resolve() : reject(new Error(`Firebase ${target} failed (${code})`)));
    });
    return output;
  }
  const output = await firebase("apphosting:sponky");
  const archive = output.match(/Uploaded at (gs:\/\/[^\s\u001b]+)/)?.[1];
  const created = (await rollouts()).filter(rollout => !before.some(previous => previous.name === rollout.name));
  assert.equal(created.length, 1, "Expected exactly one new rollout; never accept an old successful deployment");
  const rollout = created[0];
  assert.ok(rollout.build.startsWith(`${backend}/builds/`), "Unexpected build scope");
  const build = await api(`https://firebaseapphosting.googleapis.com/v1beta/${rollout.build}`);
  const service = await api(`https://run.googleapis.com/v2/${serviceName}`);
  // Independently bind success to this source upload and the serving revision.
  verifyRollout(rollout, build, service, archive);
  await firebase("hosting"); // Existing rewrite follows the active service; never pin a tag.
  async function assets(origin) {
    const response = await fetch(`${origin}/?deploy=${sha}`, { headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, `${origin} is unavailable`);
    assert.ok(response.headers.get("content-type")?.includes("text/html"), `${origin} did not serve the app`);
    const html = await response.text();
    const paths = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?]+)[^"]*"/g)].map(match => match[1]))].sort();
    assert.ok(paths.length, `${origin} has no application assets`);
    return paths;
  }
  const expectedAssets = await assets(appOrigin);
  assert.deepEqual(await assets(publicOrigin), expectedAssets, "Public URL is not serving the deployed build");
  for (const path of expectedAssets) {
    const response = await fetch(`${publicOrigin}${path}`, { method: "HEAD", signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, `Public asset unavailable: ${path}`);
  }
  const summary = `Deployed ${sha}\nSource archive: ${archive}\nRollout: ${rollout.name}\nReady revision: ${service.latestReadyRevision}\nPublic URL: ${publicOrigin}\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  deploy().catch(error => { console.error(error.message); process.exitCode = 1; });
}

import { defineConfig, devices } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const browserDir = `${homedir()}/.agent-browser/browsers`;
const installedChrome = existsSync(browserDir) ? `${browserDir}/${readdirSync(browserDir).filter(name => name.startsWith("chrome-")).sort().at(-1)}/chrome` : "";
const testEnv = {
  GOOGLE_CLOUD_PROJECT: "demo-sponky-tests", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8180",
  SPONKY_TEST_GEMINI_URL: "http://127.0.0.1:3201", GEMINI_API_KEY: "test-only-no-paid-provider",
  ELEVENLABS_API_KEY: "test-only-no-paid-provider", SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
};
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, workers: 1, retries: 0,
  timeout: 30000, expect: { timeout: 10000 },
  use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    baseURL: "http://localhost:3200", screenshot: "only-on-failure", trace: "retain-on-failure",
    launchOptions: {
      ...(existsSync(installedChrome) ? { executablePath: installedChrome } : {}),
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
        `--use-file-for-fake-audio-capture=${resolve("tests/fixtures/question.wav")}`, "--autoplay-policy=no-user-gesture-required"],
    },
  },
  webServer: [
    { command: "npx firebase emulators:start --config firebase.test.json --only firestore --project demo-sponky-tests", port: 8180, timeout: 30000, reuseExistingServer: false,
      gracefulShutdown: { signal: "SIGINT", timeout: 10000 } },
    { command: "node tests/fake-gemini.mjs", port: 3201, timeout: 10000, reuseExistingServer: false },
    { command: "npm run start -- --port 3200", port: 3200, env: testEnv, timeout: 30000, reuseExistingServer: false },
  ],
});

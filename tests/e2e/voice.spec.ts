import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("prerecorded microphone PCM commits once, plays a reply, interrupts, and recovers to typing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let pcmBytes = 0, nonzero = false, committed = false, coachRequests = 0;
  let finish: (() => void) | undefined;
  const speechRevisions: unknown[] = [];
  await page.route("**/api/voice/token", route => route.fulfill({ json: { token: "fixture-single-use", modelId: "scribe_v3_live" } }));
  await page.route("**/api/speech", route => {
    speechRevisions.push(route.request().postDataJSON());
    return route.fulfill({ contentType: "audio/mpeg", body: readFileSync("tests/fixtures/reply.mp3") });
  });
  await page.routeWebSocket("wss://api.elevenlabs.io/**", socket => {
    setTimeout(() => socket.send(JSON.stringify({ message_type: "session_started" })), 25);
    socket.onMessage(message => {
      const chunk = JSON.parse(String(message));
      expect(chunk.sample_rate).toBe(16000);
      if (chunk.commit) {
        committed = true;
        finish = () => socket.send(JSON.stringify({ message_type: "committed_transcript", text: "How much did I spend on groceries last month?" }));
      } else {
        const pcm = Buffer.from(chunk.audio_base_64, "base64");
        pcmBytes += pcm.length;
        nonzero ||= pcm.some(byte => byte !== 0);
        socket.send(JSON.stringify({ message_type: "partial_transcript", text: "How much did I spend" }));
      }
    });
  });
  page.on("request", request => { if (request.url().endsWith("/api/coach")) coachRequests++; });
  await page.goto("/");
  await page.getByRole("button", { name: "Talk to Sponky" }).click();
  await page.getByRole("button", { name: "Sponky. Tap to talk", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sponky. Stop and send", exact: true })).toBeVisible();
  await expect.poll(() => nonzero && pcmBytes > 8000).toBe(true);
  expect(coachRequests).toBe(0);
  await page.getByRole("button", { name: "Sponky. Stop and send", exact: true }).click();
  await expect.poll(() => committed).toBe(true);
  expect(coachRequests).toBe(0);
  finish!();
  await expect(page.getByRole("button", { name: "Sponky. Speak instead", exact: true })).toBeVisible();
  expect(coachRequests).toBe(1);
  expect(speechRevisions).toEqual([{ revision: 1 }]);
  await expect(page.locator(".coach-message")).not.toContainText("752,75");
  await page.getByRole("button", { name: "Sponky. Speak instead", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sponky. Stop and send", exact: true })).toBeVisible();
  await page.waitForTimeout(750); // Preserve the real reasoning burst limit.
  // Sending typed input must cancel the unfinished capture and preserve typing.
  await page.getByRole("button", { name: "Sound on", exact: true }).click();
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("I've had a long day");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".coach-message")).toContainText("long day");
  await expect(page.getByRole("button", { name: "Sponky. Tap to talk", exact: true })).toBeVisible();
  expect(speechRevisions).toHaveLength(1);
  expect(errors).toEqual([]);
  await page.route("**/api/voice/token", route => route.fulfill({ status: 503, json: { error: "fixture unavailable" } }));
  await page.getByRole("button", { name: "Sponky. Tap to talk", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Typing is always available");
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled();
});

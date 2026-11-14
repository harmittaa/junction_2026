import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
test(`prerecorded voice, interruption and typing recovery (${reducedMotion})`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion });
  const bars = page.locator(".sp-coach-bars line");
  const barLengths = () => bars.evaluateAll(lines => lines.map(line => {
    const value = line as SVGLineElement;
    return Math.hypot(value.x2.baseVal.value - value.x1.baseVal.value, value.y2.baseVal.value - value.y1.baseVal.value);
  }));
  const hiddenBars = () => bars.evaluateAll(lines => lines.every(line => line.getAttribute("opacity") === "0"));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let pcmBytes = 0, nonzero = false, committed = false, coachRequests = 0;
  const interim = "Keskeneräinen — unfinished — 未確定";
  const sentTexts: string[] = [];
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
        socket.send(JSON.stringify({ message_type: "partial_transcript", text: interim }));
      }
    });
  });
  page.on("request", request => {
    if (request.url().endsWith("/api/coach")) { coachRequests++; sentTexts.push(request.postDataJSON().text); }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Talk to Sponky" }).click();
  const draft = page.getByRole("textbox", { name: "Message", exact: true });
  await draft.fill("My unsent typed draft");
  const trigger = page.locator(".sp-coach-trigger");
  const touch = await page.context().newCDPSession(page);
  await expect(trigger).toBeEnabled();
  const box = (await trigger.boundingBox())!;
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await expect(page.getByRole("button", { name: "Sponky. Release to send", exact: true })).toBeVisible();
  await expect.poll(() => nonzero && pcmBytes > 8000).toBe(true);
  await expect(page.locator("body")).not.toContainText(interim);
  expect(await page.locator("body").ariaSnapshot()).not.toContain(interim);
  await expect(draft).toHaveValue("My unsent typed draft");
  await expect(bars).toHaveCount(32);
  await expect(page.locator(".sp-coach-bars")).toHaveAttribute("aria-hidden", "true");
  await expect.poll(async () => Math.max(...await barLengths())).toBeGreaterThan(5);
  if (reducedMotion === "reduce") {
    expect((await barLengths()).every(length => Math.abs(length - 8.2) < 0.001)).toBe(true);
  } else {
    const lengths = await barLengths();
    await expect.poll(barLengths).not.toEqual(lengths);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeGreaterThan(0.1);
  }
  expect(coachRequests).toBe(0);
  // Pointer capture preserves release-to-send even after sliding outside the orb.
  await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 20, y: 180 }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => committed).toBe(true);
  expect(coachRequests).toBe(0);
  await expect(page.locator(".sp-coach")).toHaveAttribute("data-state", "thinking");
  if (reducedMotion === "reduce") {
    await expect.poll(() => bars.evaluateAll(lines => lines.every(line => Math.abs(Number(line.getAttribute("opacity")) - 0.6) < 0.001))).toBe(true);
    expect((await barLengths()).every(length => Math.abs(length - 7.36) < 0.001)).toBe(true);
    const lengths = await barLengths();
    await page.waitForTimeout(150);
    expect(await barLengths()).toEqual(lengths);
  } else {
    const lengths = await barLengths();
    await expect.poll(barLengths).not.toEqual(lengths);
  }
  finish!();
  await expect(page.getByRole("button", { name: "Sponky. Hold to interrupt", exact: true })).toBeVisible();
  expect(coachRequests).toBe(1);
  expect(sentTexts).toEqual(["How much did I spend on groceries last month?"]);
  await expect(draft).toHaveValue("My unsent typed draft");
  expect(speechRevisions).toEqual([{ revision: 1 }]);
  await expect(page.locator(".coach-message")).not.toContainText("752,75");
  await expect.poll(async () => Math.max(...await barLengths())).toBeGreaterThan(5);
  await expect.poll(() => bars.evaluateAll(lines => lines.every(line => line.getAttribute("opacity") === "1"))).toBe(true);
  if (reducedMotion === "reduce") {
    expect((await barLengths()).every(length => Math.abs(length - 8.2) < 0.001)).toBe(true);
  } else {
    const lengths = await barLengths();
    await expect.poll(barLengths).not.toEqual(lengths);
  }
  // The 3.5-second fixture must finish naturally, well before the 30-second cap.
  await expect(page.getByRole("button", { name: "Sponky. Hold to talk", exact: true })).toBeVisible({ timeout: 8000 });
  await expect.poll(hiddenBars).toBe(true);
  // Hidden bars must stop drawing, not keep an invisible animation running.
  expect(await page.locator(".sp-coach-bars").evaluate(element => new Promise<number>(resolve => {
    let writes = 0;
    const observer = new MutationObserver(records => { writes += records.length; });
    observer.observe(element, { attributes: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(writes); }, 200);
  }))).toBe(0);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("region", { name: "Conversation history" })).toContainText("How much did I spend on groceries last month?");
  await expect(page.getByRole("region", { name: "Conversation history" })).not.toContainText(interim);
  await page.getByRole("button", { name: "Close history", exact: true }).click();
  await page.getByRole("button", { name: "Play reply", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sponky. Hold to interrupt", exact: true })).toBeVisible();
  await trigger.focus();
  await page.keyboard.down("Space");
  await expect(page.getByRole("button", { name: "Sponky. Release to send", exact: true })).toBeVisible();
  await page.waitForTimeout(750); // Preserve the real reasoning burst limit.
  // Sending typed input must cancel the unfinished capture and preserve typing.
  await page.getByRole("button", { name: "Sound on", exact: true }).click();
  await page.keyboard.up("Space");
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("I've had a long day");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".coach-message")).toContainText("long day");
  await expect(page.getByRole("button", { name: "Sponky. Hold to talk", exact: true })).toBeVisible();
  await expect.poll(hiddenBars).toBe(true);
  expect(speechRevisions).toEqual([{ revision: 1 }, { revision: 1 }]);
  expect(errors).toEqual([]);
  await page.route("**/api/voice/token", route => route.fulfill({ status: 503, json: { error: "fixture unavailable" } }));
  await trigger.focus();
  await page.keyboard.down("Enter");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Typing is always available");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Could not connect to voice transcription");
  await page.keyboard.up("Enter");
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled();
  await expect(page.locator(".sp-coach")).toHaveAttribute("data-state", "ready");
  await expect.poll(hiddenBars).toBe(true);
});
}

test("hold cancels before connection or on lost focus, and keyboard release commits only once", async ({ page }) => {
  let releaseToken!: () => void;
  const tokenGate = new Promise<void>(resolve => { releaseToken = resolve; });
  let tokens = 0, commits = 0, requests = 0;
  await page.route("**/api/voice/token", async route => {
    tokens++;
    if (tokens === 1) await tokenGate;
    await route.fulfill({ json: { token: "fixture", modelId: "scribe_v3_live" } });
  });
  await page.route("**/api/coach", route => {
    requests++;
    return route.fulfill({ status: 503, json: { error: "Fixture: typing remains available", retryable: true } });
  });
  await page.route("**/api/speech", route => route.abort());
  await page.routeWebSocket("wss://api.elevenlabs.io/**", socket => {
    setTimeout(() => socket.send(JSON.stringify({ message_type: "session_started" })), 25);
    socket.onMessage(message => {
      if (JSON.parse(String(message)).commit) {
        commits++;
        socket.send(JSON.stringify({ message_type: "committed_transcript", text: "My groceries" }));
      }
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Talk to Sponky" }).click();
  const trigger = page.locator(".sp-coach-trigger");
  const coach = page.locator(".sp-coach");
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.down("Space");
  await expect.poll(() => tokens).toBe(1);
  await expect(trigger).toHaveAccessibleName("Sponky. Release to cancel");
  await page.keyboard.up("Space");
  await expect(coach).toHaveAttribute("data-state", "ready");
  releaseToken();
  // A late connection response must not restart capture after release.
  await page.waitForTimeout(200);
  await expect(coach).toHaveAttribute("data-state", "ready");
  expect(commits).toBe(0);

  for (const cancel of ["focus", "Escape", "pointer"] as const) {
    if (cancel === "pointer") {
      await trigger.hover();
      await page.mouse.down();
    } else {
      await trigger.focus();
      await page.keyboard.down("Space");
    }
    await expect(coach).toHaveAttribute("data-state", "listening");
    if (cancel === "focus") await page.getByRole("textbox", { name: "Message", exact: true }).focus();
    else if (cancel === "Escape") await page.keyboard.press("Escape");
    else await trigger.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse" });
    await page.keyboard.up("Space");
    if (cancel === "pointer") await page.mouse.up();
    await expect(coach).toHaveAttribute("data-state", "ready");
    expect(commits).toBe(0);
    expect(requests).toBe(0);
  }

  for (const key of ["Space", "Enter"]) {
    await trigger.focus();
    await page.keyboard.down(key);
    await expect(coach).toHaveAttribute("data-state", "listening");
    const beforeRepeat = tokens;
    await page.keyboard.down(key); // Browser auto-repeat must not restart the stream.
    expect(tokens).toBe(beforeRepeat);
    await page.keyboard.up(key);
    await expect.poll(() => commits).toBe(key === "Space" ? 1 : 2);
    await expect.poll(() => requests).toBe(commits);
    await expect(coach).toHaveAttribute("data-state", "ready");
  }
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toBeEnabled();
});

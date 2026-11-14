import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("prerecorded voice, interruption and suggestion recovery", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
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
  const loaded = page.waitForResponse(response => response.url().endsWith("/api/session"));
  await page.goto("/");
  await loaded;
  await page.getByRole("button", { name: /Talk to Sponky/ }).click();
  await expect.poll(() => speechRevisions).toEqual([{ revision: 0, entry: true }]);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  const trigger = page.locator(".sp-coach-trigger");
  const touch = await page.context().newCDPSession(page);
  await expect(trigger).toBeEnabled();
  const box = (await trigger.boundingBox())!;
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await expect(page.getByRole("button", { name: "Sponky. Release to send", exact: true })).toBeVisible();
  await expect.poll(() => nonzero && pcmBytes > 8000).toBe(true);
  await expect(page.locator("body")).not.toContainText(interim);
  expect(await page.locator("body").ariaSnapshot()).not.toContain(interim);
  await expect(page.getByRole("button", { name: "Am I still on track?", exact: true })).toBeEnabled();
  await expect(bars).toHaveCount(32);
  await expect(page.locator(".sp-coach-bars")).toHaveAttribute("aria-hidden", "true");
  await expect.poll(async () => Math.max(...await barLengths())).toBeGreaterThan(5);
  const lengths = await barLengths();
  await expect.poll(barLengths).not.toEqual(lengths);
  expect(Math.max(...lengths) - Math.min(...lengths)).toBeGreaterThan(0.1);
  expect(coachRequests).toBe(0);
  // Pointer capture preserves release-to-send even after sliding outside the orb.
  await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 20, y: 180 }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => committed).toBe(true);
  expect(coachRequests).toBe(0);
  await expect(page.locator(".sp-coach")).toHaveAttribute("data-state", "thinking");
  const thinkingLengths = await barLengths();
  await expect.poll(barLengths).not.toEqual(thinkingLengths);
  finish!();
  await expect(page.getByRole("button", { name: "Sponky. Hold to interrupt", exact: true })).toBeVisible();
  expect(coachRequests).toBe(1);
  expect(sentTexts).toEqual(["How much did I spend on groceries last month?"]);
  expect(speechRevisions).toEqual([{ revision: 0, entry: true }, { revision: 1 }]);
  await expect(page.locator(".coach-message")).toContainText(/1\s111,06/);
  await expect.poll(async () => Math.max(...await barLengths())).toBeGreaterThan(5);
  await expect.poll(() => bars.evaluateAll(lines => lines.every(line => line.getAttribute("opacity") === "1"))).toBe(true);
  const speakingLengths = await barLengths();
  await expect.poll(barLengths).not.toEqual(speakingLengths);
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
  await expect(page.locator(".checkup-question")).toHaveText("How much did I spend on groceries last month?");
  await expect(page.locator("body")).not.toContainText(interim);
  await expect(page.getByRole("button", { name: "Play reply", exact: true })).toHaveCount(0);
  // A new answer still speaks automatically and can be interrupted without a replay control.
  await page.getByRole("button", { name: "Am I still on track?", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sponky. Hold to interrupt", exact: true })).toBeVisible();
  await trigger.focus();
  await page.keyboard.down("Space");
  await expect(page.getByRole("button", { name: "Sponky. Release to send", exact: true })).toBeVisible();
  await page.waitForTimeout(750); // Preserve the real reasoning burst limit.
  // A neighboring control cancels the capture; a suggestion then recovers without typing.
  await page.getByRole("button", { name: "Sound on", exact: true }).click();
  await page.keyboard.up("Space");
  await page.getByRole("button", { name: "What have I spent more on than usual?", exact: true }).click();
  await expect(page.getByRole("heading", { name: "This month, compared with usual" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sponky. Hold to talk", exact: true })).toBeVisible();
  await expect.poll(hiddenBars).toBe(true);
  expect(speechRevisions).toEqual([{ revision: 0, entry: true }, { revision: 1 }, { revision: 2 }]);
  expect(coachRequests).toBe(3); // The canceled interruption never submits another transcript.
  expect(errors).toEqual([]);
  await page.route("**/api/voice/token", route => route.fulfill({ status: 503, json: { error: "fixture unavailable" } }));
  await trigger.focus();
  await page.keyboard.down("Enter");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("choose a suggestion");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Could not connect to voice transcription");
  await page.keyboard.up("Enter");
  await expect(page.getByRole("button", { name: "Am I still on track?", exact: true })).toBeEnabled();
  await expect(page.locator(".sp-coach")).toHaveAttribute("data-state", "ready");
  await expect.poll(hiddenBars).toBe(true);
});

test("expanded voice target holds, cancels and leaves the page usable", async ({ page }) => {
  const width = 390;
  const compact = true;
  await page.setViewportSize({ width, height: 844 });
  let tokens = 0, commits = 0, chunks = 0, closed = 0;
  const submitted: string[] = [];
  const finalText = "How much did I spend on groceries last month?";
  const interim = "Unfinished voice draft";
  let finish: (() => void) | undefined;
  await page.route("**/api/voice/token", route => {
    tokens++;
    return route.fulfill({ json: { token: "fixture-single-use", modelId: "scribe_v3_live" } });
  });
  await page.route("**/api/speech", route => route.fulfill({ contentType: "audio/mpeg", body: readFileSync("tests/fixtures/reply.mp3") }));
  await page.routeWebSocket("wss://api.elevenlabs.io/**", socket => {
    setTimeout(() => socket.send(JSON.stringify({ message_type: "session_started" })), 25);
    socket.onClose(() => { closed++; });
    socket.onMessage(message => {
      if (JSON.parse(String(message)).commit) {
        commits++;
        finish = () => socket.send(JSON.stringify({ message_type: "committed_transcript", text: finalText }));
      } else {
        chunks++;
        socket.send(JSON.stringify({ message_type: "partial_transcript", text: interim }));
      }
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Talk to Sponky/ }).tap();
  const coach = page.locator(".sp-coach");
  const trigger = page.locator(".sp-coach-trigger");
  const orb = page.locator(".sp-coach-orb");
  const recovery = page.getByRole("button", { name: "What have I spent more on than usual?", exact: true });
  await expect(trigger).toBeEnabled();
  await expect(trigger).toHaveCSS("-webkit-tap-highlight-color", "rgba(0, 0, 0, 0)");
  // Neighbors above the enlarged region must still receive their own touches.
  await page.getByRole("button", { name: "Sound on", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Sound off", exact: true })).toHaveAttribute("aria-pressed", "true");
  if (compact) {
    await page.getByRole("button", { name: "Am I still on track?", exact: true }).tap();
    await expect(page.getByRole("heading", { name: "A little room each day" })).toBeVisible();
  }
  page.on("request", request => {
    if (request.url().endsWith("/api/coach") && request.postDataJSON().action === "ask") submitted.push(request.postDataJSON().text);
  });
  await trigger.scrollIntoViewIfNeeded();
  // The intro is prominent; answers keep a smaller but fully touchable voice target.
  await expect(orb).toHaveCSS("width", compact ? "64px" : "168px");
  await expect(orb).toHaveCSS("height", compact ? "64px" : "168px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const regionBox = (await coach.boundingBox())!;
  const targetBox = (await trigger.boundingBox())!;
  expect(targetBox.x).toBeGreaterThanOrEqual(0);
  expect(targetBox.x + targetBox.width).toBeLessThanOrEqual(width);
  expect(targetBox.width).toBeGreaterThanOrEqual(regionBox.width - 1);
  expect(tokens).toBe(1); // Prefetched when Sponky opened.

  // Observe real microphone cleanup and browser gesture side effects, not just the label.
  const probe = await page.evaluateHandle(() => {
    const observed = { tracks: [] as MediaStreamTrack[], selected: false, canceled: 0, unhandledMenus: 0 };
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await getUserMedia(constraints);
      observed.tracks.push(...stream.getTracks());
      return stream;
    };
    const region = document.querySelector(".sp-coach")!;
    region.addEventListener("pointercancel", () => { observed.canceled++; });
    document.addEventListener("contextmenu", event => {
      if (region.contains(event.target as Node) && !event.defaultPrevented) observed.unhandledMenus++;
    });
    document.addEventListener("selectionchange", () => {
      if (window.getSelection()?.toString()) observed.selected = true;
    });
    return observed;
  });
  const touch = await page.context().newCDPSession(page);
  const label = page.locator(".sp-coach-label span");
  const labelBox = (await label.boundingBox())!;
  const orbBox = (await orb.boundingBox())!;
  expect(labelBox.y).toBeGreaterThan(orbBox.y + orbBox.height);
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: labelBox.x + labelBox.width / 2, y: labelBox.y + labelBox.height / 2 }] });
  await expect(coach).toHaveAttribute("data-state", "listening");
  await expect.poll(() => chunks).toBeGreaterThan(0);
  await page.waitForTimeout(1100); // Deliberately cross the browser's long-press threshold on text.
  await expect(coach).toHaveAttribute("data-state", "listening");
  expect(await probe.evaluate(value => ({ selected: value.selected, canceled: value.canceled, unhandledMenus: value.unhandledMenus })))
    .toEqual({ selected: false, canceled: 0, unhandledMenus: 0 });
  // Chromium cannot prove iOS's native callout; explicitly verify the context-menu guard too.
  expect(await label.evaluate(element => element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })))).toBe(false);
  expect(await page.evaluate(() => {
    const target = document.querySelector(".coach-message") ?? document.body;
    const copyAllowed = target.dispatchEvent(new Event("copy", { bubbles: true, cancelable: true }));
    const selectAllowed = target.dispatchEvent(new Event("selectstart", { bubbles: true, cancelable: true }));
    const selection = window.getSelection();
    selection?.selectAllChildren(target);
    return {
      userSelect: getComputedStyle(document.body).userSelect,
      copyAllowed,
      selectAllowed,
      selectedText: selection?.toString() ?? "",
    };
  })).toEqual({
    userSelect: "none",
    copyAllowed: false,
    selectAllowed: false,
    selectedText: "",
  });
  await touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await expect(coach).toHaveAttribute("data-state", "ready");
  await expect.poll(() => closed).toBe(1);
  await expect.poll(() => probe.evaluate(value => value.tracks.length > 0 && value.tracks.every(track => track.readyState === "ended"))).toBe(true);
  expect(commits).toBe(0);
  expect(submitted).toEqual([]);
  await expect(recovery).toBeEnabled();

  // The label-side padding outside the visible circle is part of the hold target too.
  const side = { x: regionBox.x + 12, y: labelBox.y + labelBox.height / 2 };
  expect(side.y).toBeGreaterThan(orbBox.y + orbBox.height);
  expect(side.x).toBeGreaterThan(targetBox.x);
  expect(side.y).toBeLessThan(targetBox.y + targetBox.height);
  const scrollBefore = await page.evaluate(() => scrollY);
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [side] });
  await expect(coach).toHaveAttribute("data-state", "listening");
  await page.waitForTimeout(1100);
  await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: width - 4, y: Math.max(10, regionBox.y - 40) }] });
  await expect(coach).toHaveAttribute("data-state", "listening");
  expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
  expect(await probe.evaluate(value => ({ selected: value.selected, canceled: value.canceled, unhandledMenus: value.unhandledMenus })))
    .toEqual({ selected: false, canceled: 1, unhandledMenus: 0 });
  expect(commits).toBe(0);
  expect(submitted).toEqual([]);
  await expect(page.locator("body")).not.toContainText(interim);
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => commits).toBe(1);
  await expect(coach).toHaveAttribute("data-state", "thinking");
  expect(submitted).toEqual([]); // Release requests a final transcript; it cannot submit a partial.
  finish!();
  await expect(page.locator(".coach-message")).toContainText(/1\s111,06/);
  await expect(coach).toHaveAttribute("data-state", "ready");
  await expect.poll(() => closed).toBe(2);
  await expect.poll(() => probe.evaluate(value => value.tracks.length === 2 && value.tracks.every(track => track.readyState === "ended"))).toBe(true);
  await expect(recovery).toBeEnabled();
  await expect(page.getByRole("button", { name: "Guess first", exact: true })).toHaveCount(0);
  expect(submitted).toEqual([finalText]);
  await expect.poll(() => tokens).toBe(3); // Each hold uses one; the next is prefetched.
  expect(commits).toBe(1);

  // Suggestions remain touchable after cancellation and do not duplicate voice submissions.
  await page.waitForTimeout(750); // Keep the production reasoning burst limit, and catch delayed duplicate sends.
  expect(submitted).toEqual([finalText]);
  await recovery.tap();
  await expect(page.getByRole("heading", { name: "This month, compared with usual" })).toBeVisible();
  expect(submitted).toEqual([finalText, "What have I spent more on than usual?"]);
  const canvas = page.locator(".checkup-canvas");
  const canvasBox = (await canvas.boundingBox())!;
  // Answers now scroll inside the canvas, not the page: holding the coach must not disable that.
  const x = canvasBox.x + canvasBox.width / 2;
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: canvasBox.y + canvasBox.height - 10 }] });
  for (const fraction of [.8, .6, .4, .2]) {
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: canvasBox.y + canvasBox.height * fraction }] });
  }
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => canvas.evaluate(element => element.scrollTop)).toBeGreaterThan(30);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(tokens).toBe(3);
  expect(commits).toBe(1);
  await expect(coach).toHaveAttribute("data-state", "ready");
  await probe.dispose();
  await touch.detach();
});

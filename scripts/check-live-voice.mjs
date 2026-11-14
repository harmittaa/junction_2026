import { createRequire } from 'node:module';
import { writeFileSync, readFileSync, readdirSync, mkdirSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const usage = 'Usage: node scripts/check-live-voice.mjs --offline|--live en|fi_en|spending APP_ORIGIN [DEPLOYED_COMMIT]\nLive mode also requires SPONKY_LIVE_ACCEPTANCE=1 and a verified 40-character deployed commit. See tests/fixtures/README.md.';
if (process.argv[2] === '--help') { console.log(usage); process.exit(0); }
const [mode, name, origin, deployedCommit, ...extra] = process.argv.slice(2);
assert.ok(['--offline', '--live'].includes(mode) && ['en', 'fi_en', 'spending'].includes(name) && origin && !extra.length, usage);
const live = mode === '--live';
assert.ok(!live || process.env.SPONKY_LIVE_ACCEPTANCE === '1', 'Paid calls refused: set SPONKY_LIVE_ACCEPTANCE=1 only with an authorized allowance.');
assert.ok(live ? /^[a-f0-9]{40}$/.test(deployedCommit ?? '') : !deployedCommit, usage);
const url = new URL(origin);
assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Supply an origin without credentials, path, query or fragment.');
assert.ok(live ? url.protocol === 'https:' : url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Live requires HTTPS; offline requires a loopback HTTP server backed by the Firestore emulator.');
const base = url.origin;
const repo = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium, expect, devices } = require('@playwright/test');
const spending = name === 'spending';
const fixture = spending ? 'da4f2408-spending_en.wav' : name === 'fi_en' ? '1938a13a-fi_en.wav' : '4256f8e6-en.wav';
const expected = spending ? 'How much did I spend on groceries last month?'
  : name === 'fi_en' ? 'Moi! Haluaisin aloittaa uuden tavan joka aamu. Käyn kävelyllä kello kahdeksan. And if it rains, I will do ten minutes of stretching at home.'
  : 'Hello, this is a real-time speech transcription test. Today is Friday, and we are measuring how fast Gemini 3.5 Transcribe responds to live audio.';
const normalize = text => text.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const label = `${name}-${live ? 'live' : 'offline'}`;
mkdirSync(`${repo}/test-results/live-voice`, { recursive: true });
const out = mkdtempSync(`${repo}/test-results/live-voice/${label}-${Date.now()}-`);
const paddedFixture = `${out}/input.wav`;
execFileSync('ffmpeg', ['-v', 'error', '-i', `${repo}/tests/fixtures/${fixture}`, '-af', 'adelay=6000:all=1,apad=pad_dur=1', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', paddedFixture]);
const root = `${homedir()}/.agent-browser/browsers`;
const executablePath = existsSync(root) ? `${root}/${readdirSync(root).filter(x => x.startsWith('chrome-')).sort().at(-1)}/chrome` : '';
const sanitize = value => {
  if (typeof value !== 'string') return value;
  for (const key of ['GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'SESSION_SECRET']) {
    if (process.env[key]) value = value.replaceAll(process.env[key], '[REDACTED]');
  }
  return value.replace(/([?&](?:token|key)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/("(?:token|apiKey|api_key)"\s*:\s*")[^"]+/gi, '$1[REDACTED]')
    .replace(/((?:authorization|cookie|set-cookie|xi-api-key)["']?\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]');
};
const report = {
  fixture, fixtureSha256: createHash('sha256').update(readFileSync(`${repo}/tests/fixtures/${fixture}`)).digest('hex'),
  live, base, startedAt: new Date().toISOString(), expected, normalizedExpected: normalize(expected),
  autoplayBypass: false, physicalDevice: false, declaredDeployedCommit: deployedCommit ?? null,
  events: [], transcript: [], statuses: [], inputBytes: 0, nonzeroBytes: 0, commits: 0,
  speechRequests: [], coachRequests: [], socketErrors: [], socketClosed: false, errors: [], audioFiles: [],
};
const pending = [];
let browser, page;
try {
  browser = await chromium.launch({ ...(existsSync(executablePath) ? { executablePath } : {}), args: [
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${paddedFixture}%noloop`,
  ] });
  page = await browser.newPage({ ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    serviceWorkers: 'block', recordVideo: { dir: `${out}/raw-video`, size: { width: 390, height: 844 } } });
  await page.addInitScript(() => {
    window.__tracks = []; window.__contexts = []; window.__playbacks = [];
    const originalCapture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async options => {
      const stream = await originalCapture(options);
      window.__tracks.push(...stream.getTracks());
      return stream;
    };
    const OriginalContext = window.AudioContext;
    window.AudioContext = class extends OriginalContext {
      constructor(...args) {
        super(...args); window.__contexts.push(this);
        const createSource = this.createBufferSource.bind(this);
        this.createBufferSource = () => {
          const source = createSource();
          const record = { startedAt: null, endedAt: null, connectedToDestination: false };
          window.__playbacks.push(record);
          const connect = source.connect.bind(source);
          source.connect = (...args) => {
            if (args[0] === this.destination) record.connectedToDestination = true;
            return connect(...args);
          };
          const start = source.start.bind(source);
          source.start = (...args) => {
            record.startedAt = performance.now(); record.contextStateAtStart = this.state;
            record.duration = source.buffer.duration; record.sampleRate = source.buffer.sampleRate;
            record.channels = source.buffer.numberOfChannels;
            const samples = source.buffer.getChannelData(0);
            record.decodedRms = Math.sqrt(samples.reduce((sum, x) => sum + x*x, 0) / samples.length);
            return start(...args);
          };
          source.addEventListener('ended', () => { record.endedAt = performance.now(); });
          return source;
        };
      }
    };
  });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('request', request => {
    if (request.url().endsWith('/api/coach')) report.coachRequests.push(request.postDataJSON());
    if (request.url().endsWith('/api/speech')) report.speechRequests.push(request.postDataJSON());
  });
  page.on('response', response => {
    const route = new URL(response.url()).pathname;
    if (!['/api/coach', '/api/speech', '/api/voice/token'].includes(route)) return;
    const result = { route, status: response.status(), retryAfter: response.headers()['retry-after'] ?? null };
    report.statuses.push(result);
    pending.push((async () => {
      if (!response.ok()) result.error = (await response.text()).slice(0, 500);
      else if (route === '/api/speech') {
        const bytes = await response.body();
        const path = `${out}/${label}-reply-${report.audioFiles.length + 1}.mp3`;
        writeFileSync(path, bytes);
        report.audioFiles.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    })().catch(error => { result.captureError = error.message; }));
  });
  page.on('websocket', socket => {
    if (!socket.url().startsWith('wss://api.elevenlabs.io/')) return;
    socket.on('close', () => { report.socketClosed = true; });
    socket.on('socketerror', error => report.socketErrors.push({ type: 'transport', error: String(error).replace(/token=[^&\s]+/g, 'token=REDACTED') }));
    socket.on('framesent', ({ payload }) => {
      const data = JSON.parse(String(payload));
      if (data.commit) { report.commits++; report.events.push('commit'); }
      else if (data.audio_base_64) {
        const bytes = Buffer.from(data.audio_base_64, 'base64');
        report.inputBytes += bytes.length;
        report.nonzeroBytes += bytes.filter(x => x !== 0).length;
        if (!report.events.length) report.events.push('pcm');
      }
    });
    socket.on('framereceived', ({ payload }) => {
      const data = JSON.parse(String(payload));
      if (data.message_type === 'committed_transcript') { report.events.push('final'); report.transcript.push(data.text); }
      if (/error|invalid|quota|limit/i.test(data.message_type ?? '')) report.socketErrors.push({ type: data.message_type, code: data.code, retryAfter: data.retry_after });
    });
  });
  // Benchmark interpretation is deliberately blocked. Spending is never mocked in live mode.
  if (!spending || !live) {
    await page.route('**/api/coach', route => route.fulfill({ status: 503, json: {
      error: 'Transcription-only acceptance: banking request blocked by test.', retryable: true,
    } }));
    await page.route('**/api/speech', route => route.abort());
  }
  if (!live) {
    await page.route('**/api/voice/token', route => route.fulfill({ json: { token: 'fixture-only', modelId: 'scribe_v3_live' } }));
    await page.routeWebSocket('wss://api.elevenlabs.io/**', socket => {
      setTimeout(() => socket.send(JSON.stringify({ message_type: 'session_started' })), 25);
      socket.onMessage(message => {
        if (JSON.parse(String(message)).commit) socket.send(JSON.stringify({ message_type: 'committed_transcript', text: expected }));
      });
    });
  }
  await page.goto(base);
  await page.getByRole('button', { name: 'Talk to Sponky', exact: true }).tap();
  const ready = page.getByRole('button', { name: 'Sponky. Hold to talk', exact: true });
  await expect(ready).toBeEnabled();
  const draft = page.getByRole('textbox', { name: 'Message', exact: true });
  await draft.fill('Unsent typed draft');
  report.before = await (await page.request.get(`${base}/api/session`)).json();
  if (!spending) await page.getByRole('button', { name: 'Sound on', exact: true }).tap();
  const touch = await page.context().newCDPSession(page);
  const box = await ready.boundingBox();
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  const stop = page.getByRole('button', { name: 'Sponky. Release to send', exact: true });
  await expect(stop).toBeVisible({ timeout: 20000 });
  report.listeningTracks = await page.evaluate(() => window.__tracks.map(t => ({ kind: t.kind, state: t.readyState })));
  assert.ok(report.listeningTracks.some(t => t.kind === 'audio' && t.state === 'live'));
  const level = () => page.locator('.sp-coach').evaluate(el => Number(el.style.getPropertyValue('--sp-level')));
  await expect.poll(level, { timeout: 12000 }).toBeGreaterThan(0.005);
  report.listeningLevel = await level();
  await page.screenshot({ path: `${out}/${label}-listening.png`, fullPage: true });
  await page.waitForTimeout(spending ? 3800 : 10800);
  assert.equal(report.coachRequests.length, 0, 'No banking request before manual stop');
  await expect(draft).toHaveValue('Unsent typed draft');
  await expect(page.locator('.caption-bubble')).toHaveCount(0);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => report.coachRequests.length, { timeout: 15000 }).toBe(1);
  report.finalText = report.coachRequests[0].text;
  report.normalizedActual = normalize(report.finalText);
  report.normalizedMatch = report.normalizedActual === report.normalizedExpected;
  assert.ok(report.normalizedMatch, 'Exact punctuation-normalized transcript mismatch');
  if (spending && live) {
    const finishPlayback = async (index, stage) => {
      await expect(page.getByRole('button', { name: 'Sponky. Hold to interrupt', exact: true })).toBeVisible({ timeout: 35000 });
      await expect.poll(level).toBeGreaterThan(0);
      report[`${stage}PlaybackLevel`] = await level();
      report[stage] = await (await page.request.get(`${base}/api/session`)).json();
      if (stage === 'invitation') {
        assert.equal(report[stage].activity.kind, 'invitation');
        assert.doesNotMatch(JSON.stringify(report[stage]), /752|totalCents|evidence/);
        assert.doesNotMatch(await page.getByRole('main').innerText(), /752/);
      } else {
        assert.equal(report[stage].activity.spending.totalCents, 75275);
        assert.equal(report[stage].activity.spending.evidence.length, 11);
      }
      await page.screenshot({ path: `${out}/${label}-${stage}-speaking.png`, fullPage: true });
      await expect.poll(() => page.evaluate(i => window.__playbacks[i]?.endedAt ?? null, index), { timeout: 30000 }).not.toBeNull();
      await expect(ready).toBeVisible();
      assert.equal(await level(), 0);
    };
    await finishPlayback(0, 'invitation');
    await page.getByRole('button', { name: 'Show me', exact: true }).tap();
    await finishPlayback(1, 'reveal');
    assert.deepEqual(report.coachRequests.map(r => r.action), ['ask', 'reveal']);
    assert.deepEqual(report.speechRequests, [{ revision: 1 }, { revision: 2 }]);
  } else {
    await expect(ready).toBeVisible();
    await expect(draft).toBeEnabled();
    assert.equal(report.speechRequests.length, 0);
  }
  await expect(draft).toHaveValue('Unsent typed draft');
  report.typedDraftPreserved = true;
  report.after = await (await page.request.get(`${base}/api/session`)).json();
  assert.deepEqual(report.after.habit, report.before.habit);
  assert.deepEqual(report.after.completedDates, report.before.completedDates);
  if (!spending || !live) assert.deepEqual(report.after, report.before);
  report.cleanup = await page.evaluate(() => ({ tracks: window.__tracks.map(t => t.readyState), contexts: window.__contexts.map(c => c.state), playbacks: window.__playbacks }));
  assert.ok(report.cleanup.tracks.every(state => state === 'ended'));
  assert.ok(report.cleanup.contexts.every(state => state === 'closed'));
  if (live) {
    assert.equal(report.commits, 1); assert.ok(report.nonzeroBytes > 10000); assert.ok(report.socketClosed);
    assert.deepEqual(report.events, ['pcm', 'commit', 'final']);
  }
  if (spending && live) {
    assert.equal(report.cleanup.playbacks.length, 2);
    for (const playback of report.cleanup.playbacks) {
      assert.equal(playback.contextStateAtStart, 'running'); assert.ok(playback.connectedToDestination);
      assert.ok(playback.decodedRms > 0.001); assert.ok(playback.duration < 30);
      assert.ok(Math.abs((playback.endedAt - playback.startedAt) / 1000 - playback.duration) < 1);
    }
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.socketErrors, []);
  await page.screenshot({ path: `${out}/${label}-final.png`, fullPage: true });
  report.passed = true;
} catch (error) {
  report.failure = error.message; process.exitCode = 1;
  if (page) {
    report.visibleErrors = await page.getByRole('alert').allTextContents().catch(() => []);
    report.afterFailure = await (await page.request.get(`${base}/api/session`)).json().catch(() => null);
    report.cleanupAfterFailure = await page.evaluate(() => ({ tracks: window.__tracks.map(t => t.readyState), contexts: window.__contexts.map(c => c.state), playbacks: window.__playbacks })).catch(() => null);
    await page.screenshot({ path: `${out}/${label}-failure.png`, fullPage: true }).catch(() => {});
  }
} finally {
  await Promise.all(pending);
  if (page) {
    const video = page.video();
    await page.context().close();
    await video.saveAs(`${out}/${label}.webm`).catch(error => { report.videoError = error.message; });
  }
  await browser?.close();
  rmSync(paddedFixture, { force: true });
  if (!report.videoError) rmSync(`${out}/raw-video`, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  const json = JSON.stringify(report, (_, value) => sanitize(value), 2);
  writeFileSync(`${out}/${label}.json`, json);
  console.log(json);
  console.log(`Evidence: ${out}`);
}

# Sponky demo acceptance record

The demo is deployed, but the latest exact-fixture acceptance at 06:29–06:35 UTC on 14 November 2026 found spending reasoning blocked at its 20-second deadline. Both supplied English recordings transcribed correctly through the real deployed microphone path. The spending invitation/reveal/spoken-reply chain did not complete in this run. Earlier typed, persisted check-in and eSpeak voice journeys passed; those earlier results do not establish current reasoning availability. Physical phone microphone and Safari checks remain human acceptance work.

- Demo: https://sponky--sponky-junction-2026.europe-west4.hosted.app
- Deployed source: [036b277](https://github.com/harmittaa/junction_2026/commit/036b27701081e3eeee12d6269166e5359c0acf62). Application checks ran on [c6a55e6](https://github.com/harmittaa/junction_2026/commit/c6a55e68f9d2a3171c62183293d57096e139640d); the only subsequent deployment change pins existing secret versions, validated separately.
- Branch: `amp/sponky-overnight`, integrated into `main` by authorized non-force fast-forward pushes. No PR or human approval gate. Worktree: `/home/user/workspace/sponky-overnight`.
- Firebase rollout `build-2026-11-14-002` is `SUCCEEDED`; ready Cloud Run revision `sponky-build-2026-11-14-002`. The first rollout failed while resolving secret metadata, before application compilation. Explicit version-1 pins fixed it without IAM changes. Future rotation requires updating these pins and redeploying.
- Exact deployment command: `npx -y firebase-tools@latest deploy --only firestore:rules,apphosting:sponky --project sponky-junction-2026 --non-interactive`.

## Scope and choices

- Node 22, Java 21, GitHub and Google ADC preflight passed. Existing Standard Firestore and `sponky` App Hosting backend verified. No new infrastructure or IAM changes.
- Data, voice and UI workers used GPT-6.1 Sol at medium effort, maximum two at once in separate worktrees. Fresh Claude quotas were unavailable. One strong independent integrated review completed. No premium coding modes or paid coding keys.
- Real dataset: `data/README.md`. CUST00001, October–November 2024; initial simulated date 2024-11-04. Gross spending includes negative purchase/housing_payment/utilities_payment rows only. Income and investment movements remain in the source slice but do not count as spending. No refunds in this pinned source. Queries cannot include future simulated dates.
- The demo uses groceries, not illustrative taxis. October groceries: 75,275 cents / 11 source purchases. Baskets are interpretations, not judgments. Percentage scenarios use only rows currently assigned Everyday spending and never claim recorded savings.
- Session state lives under `demoSessionsV1`; existing data is never silently reinterpreted. Signed HttpOnly seven-day cookies isolate browsers. Client Firestore access stays denied. Application validation and transactions enforce authorization/once-per-date completion.
- Immutable 39-row data is loaded once. Each turn reads only its session and bounded usage documents. Model context contains category/date scope and the previous query, not transactions or customer identifiers. Corrections/date changes recompute results. No CSV downloads or Firestore collection scans per turn.
- Gemini selects validated operations and reply intents; application code writes every displayed/spoken financial sentence. Chat uses deliberately bounded empathetic wording, not unchecked model prose. Arbitrary user/provider text cannot be sent to synthesis.
- Daily provider ceilings are enforced per session and globally. They are not billing caps. App Hosting configuration and the deployed revision have minimum 0 / maximum 1 instance; Cloud Run's service-level ceiling remains its existing 20, while the serving revision is limited to 1. The owner's configured €25 Cloud Run spend cap and €30 project alerts do not guarantee a €30 total ceiling or cover external providers.

## Earlier acceptance and deterministic evidence

| Requirement | Executed evidence |
| --- | --- |
| Reproducible actual data | Full 362,796,501-byte source checksum verified; 39 selected rows independently reconciled field-by-field with Decimal and by the owner; regeneration byte-identical. Three importer tests pass. |
| Real typed reasoning and calculation | Deployed browser typed “How much did I spend on groceries last month?”; Gemini selected October groceries; hidden invitation omitted amounts/evidence; reveal returned 75,275 cents and 11 source rows. No hardcoded totals. |
| Optional guess/reveal and direct answers | Unit/browser checks cover guess, skip, remembered decline, direct answers and topic changes. Inspected deployed recording shows 120 € guess and animated 752,75 € reveal. |
| Evidence, correction and what-if | Phone browser corrected source row 3's 3,251 cents to Regular essentials. Historical total stayed 75,275; Everyday became 72,024; 20% reduction was 14,405 cents. The displayed reduction is explicitly hypothetical. |
| Confirmed habit and daily loop | Deployed UI saved Housing / “Review my essential housing costs”, showed November 4 spending of 53,520 cents, required a reflection, and persisted one completed day after reload. Repeating completion still returned one day. |
| Atomicity and isolation | Emulator suite checks six concurrent same-revision completions yield one success, duplicate-date protection, reload, next-day/no-spending behavior, separate sessions, paid-work concurrency and direct unauthenticated Firestore 403. |
| Grounding and bounded reads | Deliberately fabricated chat/clarify/spending prose is rejected; actual SDK HTTP fixture checks limited context without transactions; route-level speech test captures hidden/revealed authorized text and rejects stale revisions/arbitrary text. |
| Failure/cancellation recovery | Phone tests preserve typing and saved state after provider failure; stale/lost complete and advance responses cannot confirm against a new date. Actual stalled SDK socket closes at the 20-second deadline and immediately on cancellation, without retries. |
| Real speech transport | Deployed fake microphone WAV → real AudioWorklet PCM → single-use ElevenLabs token/Scribe → committed exact transcript → Gemini → real MP3 reply. Stop-to-spoken-invitation was 5,003 ms on this sample; playback energy was nonzero and mute stopped it. |
| Hidden and revealed speech | Inspected real invitation audio contains no total. After reveal, inspected audio says “752 euros and 75 cents across 11 groceries transactions… historical records, not money saved.” |
| Supplied mixed-language fixture | Deployed tap-to-start/tap-to-stop with the owner's recreated Finnish/English WAV: token 200, real capture/PCM, one commit, final transcript matching both segments after punctuation normalization, ended microphone track. The harness blocked banking interpretation; no Gemini/TTS calls or saved-state changes. |
| Natural playback completion | Extended deterministic phone test checks nonzero MP3 playback energy, natural completion of the 3.5-second fixture within 8 seconds (not the 30-second cap), return to ready/zero level, replay, Speak instead interruption and typing recovery. |
| Mobile UI and accessibility | Chromium phone profile at 390/360 px; light/dark, reduced motion, empty spending, controls and reload checked. No horizontal overflow; coarse pointer verified; reduced-motion animation is none. Inspected screenshots and a real-pointer deployed recording. This is browser emulation, not physical-device proof. |
| S-mobiili feasibility | Clearly labeled entry concept leads to reusable coach/activity/history components. No claimed banking connection, account access or money movement. |

Final combined commands passed: `npm run check` (type generation, TypeScript, ESLint, 35 Vitest cases, 3 importer tests); `npm run test:emulator` (2 integration tests); `npm run build`; `npm run test:e2e` (5 phone journeys). Default tests make no paid-provider calls. No GitHub CI workflow/checks exist for these commits; these commands ran in the Orb rather than relying on an absent CI result.

One independent final review found automatic rebasing of confirmed retries could complete/advance a later date after a lost response. Fixed by retaining the original revision and clearing retryable actions on conflict. Both lost-response regressions passed. No other concrete blockers were reported.

The earlier live acceptance used ten short reasoning invocations, three prerecorded transcription sessions and three speech outputs. Early scenario calls exhausted the thought/output budget; low thinking with a 2,048-token cap passed the scenario and day-chat rechecks. One slow call exposed SDK cancellation propagation; the real-socket regression verifies the fix. Provider variability remains; the UI offers retry/typing without losing saved activity.

All three owner-supplied WAVs are preserved with hashes, transcripts and synthetic macOS voice provenance in `tests/fixtures/README.md`. The mixed-language recreation passed live browser activation in the earlier run. The owner subsequently authorized a separate bounded run for the two exact English recordings, superseding the original three-session testing allowance; its actual outcomes follow.

## Exact English fixtures: transcription passes, reasoning times out

Tested the existing deployed source [036b277](https://github.com/harmittaa/junction_2026/commit/036b27701081e3eeee12d6269166e5359c0acf62) and ready revision `sponky-build-2026-11-14-002` at 06:29–06:35 UTC (08:29–08:35 Europe/Helsinki), 14 November. Read-only App Hosting/Cloud Run checks confirmed the successful rollout and unchanged revision. No code, runtime configuration, billing, IAM, quota, spend-cap or scaling changes were made; no redeployment was needed.

The run used **4 transcription sessions, 3 reasoning attempts and 0 speech outputs**, within the explicitly authorized maximum of 4/3/4. The English benchmark ran once; only the failed spending journey used the two contingency attempts. Cumulative implementation acceptance is now 7 transcription sessions, 13 reasoning attempts and 3 speech outputs. Paid testing stopped at this run's transcription/reasoning ceilings.

| Exact supplied fixture | Live result |
| --- | --- |
| `4256f8e6-en.wav` | PASS: token HTTP 200, real `getUserMedia`/AudioWorklet PCM, nonzero microphone level, exactly one manual commit, final transcript after commit, closed WebSocket, ended track and closed AudioContext. Punctuation-normalized transcript matches every expected word. The harness intercepted banking submission with a clearly labeled test-only error; no Gemini/TTS request or saved-state change. |
| `da4f2408-spending_en.wav` | Transcription PASS on all three attempts, including one full-width question mark that normalizes identically. Real token/Scribe transport and one commit each. The actual `/api/coach` request then returned HTTP 503 on every attempt. No speech request was made and no invitation/reveal was returned. On the final two attempts the captured session remained at revision 0 with no habit/check-in, tracks ended, AudioContexts closed and WebSockets closed. |

Exact final transcripts:

> Hello. This is a real-time speech transcription test. Today is Friday, and we are measuring how fast Gemini 3.5 Transcribe responds to live audio.

> How much did I spend on groceries last month?

Normalization is NFC, lowercase, punctuation/whitespace runs replaced by a space, then trim; it does not drop words, accents or digits. Both fixtures used only a 6-second silent prefix, 1-second silent suffix and conversion to 48 kHz for Chromium; the original files and their recorded hashes remain unchanged. Chromium used the Pixel 7 touch profile at 390 px / 2× and **no autoplay bypass**. No live input was replaced by an injected transcript. The spending path had no mocked API/provider response.

**Identified failure boundary:** the application's existing 20-second Gemini transport deadline. Cloud Run logged `/api/coach` HTTP 503 after **20.117887 s, 20.095184 s and 20.102003 s**, each with `Reasoning failed { type: 'transport', status: undefined }`. There was no upstream HTTP status, `Retry-After` or reset time to report. This was not an ElevenLabs error or the application's HTTP 429 daily/burst limit. The old testing allowance was not used as a blocker. The evidence does **not** establish exhausted Gemini credits/quota, a coding-subscription limit, or a paused Cloud Run spend cap. A non-generation Gemini model-metadata GET from the Orb returned HTTP 200; this establishes reachability/authentication there, not successful inference from Cloud Run. The underlying provider-versus-network cause remains unresolved.

The deterministic real-SDK stalled-socket test was rerun and passed: cancellation occurs at the deadline without retries. The deadline was not increased or bypassed. Inspected screenshots/recording show the finalized grocery question retained, Ready/Tap to talk restored, safe error/Retry and no leaked amount. The spending **transcription → Gemini → grounded invitation/reveal → output graph remains unverified in this run**. Earlier real MP3 playback and deterministic natural-completion evidence must not be substituted for it.

Evidence is retained in this thread's `.amp/in/artifacts/sponky/`: `owner-exact-fixture-acceptance.json`, per-run `owner-en-live-20261114*` / `owner-spending-live-20261114*` reports/screenshots/videos, sanitized `owner-spending-reasoning*-failure.json` server logs, `owner-gemini-metadata.json`, and `owner-fixture-deployed-version.json`. The replay harness is under the worktree's `.amp/in/orb-backup/check-english-fixtures.mjs`; live mode requires explicit `SPONKY_LIVE_ACCEPTANCE=1`. Offline preflight repaired the harness's missing Playwright video encoder and video-save ordering before paid calls; those were tooling issues, not app/provider failures.

## Morning test, about two minutes plus optional exploration

The latest reasoning checks failed as described above. These are the intended success steps, not a claim that a new question will currently succeed; do not repeatedly consume paid calls if the same error persists.

1. Open the demo in a fresh browser/private tab. Tap **Talk to Sponky**. Check **Historical demo · Simulated 2024-11-04**. **Sound on** toggles output mute.
2. Type “How much did I spend on groceries last month?” Choose **Guess first** or **Show me**. Expect **752,75 €**, 11 October transactions. “Just show me” bypasses guessing. The 0–200 € slider has a separate numeric input for larger estimates.
3. Optionally open **Explore this**, inspect source rows, change one basket and **Confirm correction**. Confirm a 20% what-if; it must remain hypothetical and the historical total must not change.
4. Choose **Keep an eye on it**, change category to **Housing**, enter an action and **Confirm habit**. Open **Daily check-in**, choose a reflection and **Complete check-in**. Expect **1 completed reflection day** after reload. Under **About this demo & simulated date**, advance to November 5: no Housing spending is recorded, but reflection still counts.
5. Human device check: enable sound, tap the ribbon, grant microphone permission, speak the same question, then tap **Stop and send**. Listen for a spoken reply. While speaking, tap **Speak instead** and verify the old audio stops before capture. Test mute, permission denial and typing recovery on the actual demo phone.

## Limitations and where to change the product

- Physical microphone/speaker quality, permission prompts, noisy venues, real mobile Safari and ordinary autoplay policy were not tested. Chromium speech-playback automation used a prerecorded WAV and autoplay bypass; the mixed-language transcription-only check did not use an autoplay bypass. Deterministic tests exercise interruption and resource cleanup; real-device interruption remains a human check.
- English bounded demo, one synthetic customer and two historical months. Day conversation is template-bounded. The invitation voice reads ISO dates literally. History is a small client-side session list; saved habit/corrections/check-ins are server-owned. Clearing/expiring the cookie starts a separate demo; this is not bank authentication.
- No live banking, native app, transfers, points economy, weekly recap, notifications, demographics/population comparisons, or safe-to-spend forecasting. These stay outside the approved slice.

| Change | Owner in the code |
| --- | --- |
| Journey, entry, typing and history placement | `src/components/sponky.tsx` |
| Coach motion and reusable activity/history rendering | `src/components/coach.tsx`, `activities.tsx`, `history.tsx`, `activities.css` |
| Money, basket assumptions and percentage rounding | `src/domain/spending.ts` |
| Validated operations, copy, guess/reveal and confirmed mutations | `src/shared/contracts.ts`, `src/server/coach.ts` |
| Reasoning model/transport | `src/server/providers/gemini.ts`, configuration in `.env.example` / `apphosting.yaml` |
| Speech providers and browser audio lifecycle | `src/server/providers/elevenlabs.ts`, `src/client/voice/`, `src/client/use-voice.ts` |
| Signed session and atomic persistence | `src/server/session.ts`, `src/server/storage/` |
| Dataset provenance/import | `data/README.md`, `scripts/import-transactions.py` |

Shared contracts keep provider objects out of UI/domain code; cards accept data/callbacks and History can move without a server change. A new journey/provider can reuse calculations and confirmed operations. No generalized plugin framework or speculative backend was added.

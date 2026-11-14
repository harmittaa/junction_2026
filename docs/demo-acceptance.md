# Sponky demo acceptance record

The bounded demo is deployed and usable. Real typed questions, persisted check-ins and prerecorded real speech transport passed on the HTTPS app on 14 November 2026. Physical phone microphone and autoplay checks remain human acceptance work.

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

## Acceptance evidence

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
| Mobile UI and accessibility | Chromium phone profile at 390/360 px; light/dark, reduced motion, empty spending, controls and reload checked. No horizontal overflow; coarse pointer verified; reduced-motion animation is none. Inspected screenshots and a real-pointer deployed recording. This is browser emulation, not physical-device proof. |
| S-mobiili feasibility | Clearly labeled entry concept leads to reusable coach/activity/history components. No claimed banking connection, account access or money movement. |

Final combined commands passed: `npm run check` (type generation, TypeScript, ESLint, 35 Vitest cases, 3 importer tests); `npm run test:emulator` (2 integration tests); `npm run build`; `npm run test:e2e` (5 phone journeys). Default tests make no paid-provider calls. No GitHub CI workflow/checks exist for these commits; these commands ran in the Orb rather than relying on an absent CI result.

One independent final review found automatic rebasing of confirmed retries could complete/advance a later date after a lost response. Fixed by retaining the original revision and clearing retryable actions on conflict. Both lost-response regressions passed. No other concrete blockers were reported.

Live acceptance used ten short reasoning invocations, two prerecorded transcription sessions and three speech outputs. Early scenario calls exhausted the thought/output budget; low thinking with a 2,048-token cap passed the scenario and day-chat rechecks. One slow call exposed SDK cancellation propagation; the real-socket regression now verifies the fix. Provider variability remains; the UI offers retry/typing without losing saved activity.

## Morning test, about two minutes plus optional exploration

1. Open the demo in a fresh browser/private tab. Tap **Talk to Sponky**. Check **Historical demo · Simulated 2024-11-04**. **Sound on** toggles output mute.
2. Type “How much did I spend on groceries last month?” Choose **Guess first** or **Show me**. Expect **752,75 €**, 11 October transactions. “Just show me” bypasses guessing. The 0–200 € slider has a separate numeric input for larger estimates.
3. Optionally open **Explore this**, inspect source rows, change one basket and **Confirm correction**. Confirm a 20% what-if; it must remain hypothetical and the historical total must not change.
4. Choose **Keep an eye on it**, change category to **Housing**, enter an action and **Confirm habit**. Open **Daily check-in**, choose a reflection and **Complete check-in**. Expect **1 completed reflection day** after reload. Under **About this demo & simulated date**, advance to November 5: no Housing spending is recorded, but reflection still counts.
5. Human device check: enable sound, tap the ribbon, grant microphone permission, speak the same question, then tap **Stop and send**. Listen for a spoken reply. While speaking, tap **Speak instead** and verify the old audio stops before capture. Test mute, permission denial and typing recovery on the actual demo phone.

## Limitations and where to change the product

- Physical microphone/speaker quality, permission prompts, noisy venues, real mobile Safari and ordinary autoplay policy were not tested. Chromium audio automation used a prerecorded WAV and autoplay bypass. Deterministic tests exercise interruption and resource cleanup; real-device interruption remains a human check.
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

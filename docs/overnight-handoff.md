# Sponky overnight setup and Amp handoff

The owner selected an Amp cloud Orb so implementation can continue with the laptop closed. The intended first test is **14 November 2026 at 08:00 Europe/Helsinki**. This is a target, not a timed token-spending loop: complete the bounded slice, validate it, and stop. Do not add work to fill the night.

## Infrastructure

| Resource | Configuration |
| --- | --- |
| Amp project | [Sponky](https://ampcode.com/@user_01M7B4PXVJX977FZJFBJP2JTC9/Sponky), ID `65c33243-48f3-4720-a55e-39ddfc5bfd04` |
| Firebase / Google Cloud project | `sponky-junction-2026`, number `967386564020` |
| Firestore | `(default)`, Standard, Native mode, `europe-west4` |
| App Hosting backend | `sponky`, `europe-west4`, Node.js 22 |
| Hosting bounds | Zero minimum instances, one maximum instance; see `apphosting.yaml` |
| Billing | Owner approved the existing billing account and a €10 project budget alert at 50%, 90%, 100%. Alerts do not cap spend. |
| Coding model | Active ChatGPT subscription connected to Amp; select an OpenAI model served by this connection. Provider quotas still apply. |

App Hosting has been provisioned; application deployment awaits implementation and its checks. Do not change unrelated projects, accounts, billing, or IAM. Use `--project sponky-junction-2026` on cloud commands.

## Credentials and configuration

`GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, and `SESSION_SECRET` are project-scoped Amp secrets and Google Secret Manager secrets. App Hosting injects them only at runtime. `.env.example` defines the application configuration contract; implement a server-only config module that reads it. The original laptop `.env` calls its ElevenLabs key `ELEVEN_LABS_API_KEY`; it was mapped to `ELEVENLABS_API_KEY` during setup. The Claude key is not needed by this application and was not copied.

The Orb uses Google Workload Identity Federation, restricted to this Amp project and its owner, to impersonate `amp-sponky@sponky-junction-2026.iam.gserviceaccount.com`. `.agents/resume` writes a refreshable external-account configuration; `.agents/gcp-token` supplies temporary tokens to Google libraries. No Google service-account private key or personal refresh token is stored in Amp. Do not print the helper's output.

The deployed server uses `firebase-app-hosting-compute@sponky-junction-2026.iam.gserviceaccount.com`. It can access the three named secrets and Firestore. All client Firestore reads/writes are denied by `firestore.rules`; application authorization is still necessary because the Admin SDK bypasses these rules. No Firebase Auth signup or browser Firebase SDK is required for the bounded server-session demo.

Use a `demo-*` project and `FIRESTORE_EMULATOR_HOST` for deterministic persistence tests, isolated from the real demo database. Do not set the emulator variable in App Hosting. Local worktrees do not inherit `.env`; provide secrets explicitly when working locally. The Orb receives secrets as environment variables.

## Startup and permissions

`.agents/setup` installs Java 21 if needed and downloads the Firestore emulator. Once the app has a lockfile it also installs dependencies and Chromium. `.agents/resume` configures Google credentials after the Orb identity is available. These scripts must be on the Amp project's base branch before starting a new Orb. See [Amp lifecycle](https://ampcode.com/docs/orbs/customizing) and [secret handling](https://ampcode.com/docs/orbs/handling-secrets).

The checked-in `.amp/settings.json` permits commits, pushing to **only the named overnight branch**, and the exact demo deploy command below. The installed local CLI only applied these rules when passed `--settings-file .amp/settings.json`; do not assume its permission-test command loads workspace settings automatically. Cloud tool approval behavior must be checked in the Orb. Do not enable global `dangerouslyAllowAll`.

Approved overnight work: install project dependencies, implement and test the bounded product, make commits, push `amp/sponky-overnight`, and deploy this demo after the combined checks pass. Leave `main` for review. Do not modify billing/IAM or start extra paid infrastructure. Provider calls are for short explicit smoke checks and the demo; default tests use deterministic transports.

```sh
git push -u origin HEAD:amp/sponky-overnight
npx -y firebase-tools@latest deploy --only firestore:rules,apphosting:sponky --project sponky-junction-2026 --non-interactive
```

No application exists at the initial audited `main` commit `062a4e0`. It contains the design prototype, style guide/tokens and agent guidance. Issues #1–#12 are briefs/references; at that audit there were no dependency-ordered implementation tickets. Re-read current `main` and issues before creating any missing tickets so concurrent planning work is not duplicated.

## Implementation order if no newer plan exists

Read `AGENTS.md`, #1, #2, #8 and #9 with their latest comments. The voice updates and owner review in #9 supersede the initial voice exclusion and mandatory eight-step journey. Keep the approved coach design and optional branches. Use one integration owner, one task worktree, and small commits; avoid launching a swarm just to meet the morning target.

1. **Scaffold and data:** Next.js/React/TypeScript, shared validated contracts, `npm run check`, `npm run build`, `npm run test:e2e`, and focused emulator checks. Inspect the supplied data and commit a small reproducible customer slice with provenance. No fabricated totals.
2. **Connect one real typed spending question:** UI → `src/server/coach.ts` → integer-cent domain calculation → evidence card. Bind the customer in the server session. Add Gemini interpretation with validated operations, bounded calls, clarification and failure recovery. Keep model SDK objects out of UI/domain.
3. **Optional guess/reveal and exploration:** enforce the hidden answer in text and speech; direct answer bypasses guessing. Then confirmed basket correction and percentage what-if, preserving historical amounts and distinguishing hypothetical savings.
4. **Saved daily habit/check-in:** server-owned signed session, confirmed mutations, reload persistence and atomic duplicate-date protection. First completion shows 1 day. Follow #9's current no-points/no-missed-day-penalty decision; label simulated historical dates.
5. **Real voice:** tap-start/tap-stop, `scribe_v3_live` with server-minted single-use tokens, short spoken replies, mute and “Speak instead.” Commit and receive final transcription before closing the connection. Stop playback before capture and ignore late events from canceled turns. Typing always works.
6. **Integrate, verify and deploy:** reusable coach/cards, phone layout, light/dark and reduced motion; animation follows actual recording/playback. Add the memorable reveal after the flow works. Run combined quick checks, emulator tests, production build and essential browser smoke journeys. Deploy and repeat a small live smoke; record the URL and exact commit.

When complete, stop. Leave the branch/commit, demo URL, reproducible morning test steps, checks run, provider checks, and remaining limitations. If one external service blocks progress, preserve the working typed path, finish independent work and report the blocker. Do not describe a fake fallback as a live integration.

## Dataset download trap

The source is [the challenge dataset](https://github.com/hackjunction/Junction-2026-S-pankki), pinned for inspection at `fbdecdedf1a1f49dd641c2e6b9f2b62d0dc0cc8f`. `tx_junction_transactions.csv` is Git LFS data: ordinary raw content is a 134-byte pointer. The actual file is 362,796,501 bytes, SHA-256 `49b3265d8e44e751de305a074dcffcda732bb79aa1e07b46fcca774ce76f1e63`. Download through Git LFS or [the media URL](https://media.githubusercontent.com/media/hackjunction/Junction-2026-S-pankki/fbdecdedf1a1f49dd641c2e6b9f2b62d0dc0cc8f/tx_junction_transactions.csv), outside the committed tree, and preserve source row references in the selected slice.

A bounded source sample was readable. It contains `Restaurants` and `Transportation`, not a literal `Taxis` category. Inspect MCCs before claiming a taxi-specific total. Amounts are signed euro decimals and timestamps use values such as `03OCT24:09:04:04`; `tx_date` is ISO format. Parse money explicitly into integer cents and handle BOM. Define transfers/refunds before summing. Source availability is verified; a complete customer slice has not yet been selected or imported.

## Checks recorded during setup

- GitHub repository access, Firebase/Google Cloud project creation, Amp GitHub connection and repository skill discovery succeeded.
- Gemini `gemini-4-hydrogen`: a real bounded request returned `READY`.
- ElevenLabs `eleven_flash_v2_5`, George: generated a short PCM audio clip. Scribe `scribe_v3_live` transcribed it as “How much did I spend on groceries last month?” using a single-use token.
- ElevenLabs voice listing works. Subscription/model-list endpoints return `missing_permissions`; remaining provider credit was not visible to this key. Real speech endpoints did work.
- Credential helper tests exercise token normalization, failure redaction and repeatable restricted credential configuration. They make no cloud calls.
- These checks do not establish browser microphone behavior, perceived voice quality, interruption, application correctness, or a deployed application. Those are implementation acceptance checks.

The Mac has Node 22 and authenticated GitHub, Firebase, gcloud and Amp CLIs. It has no Java runtime or local Google Application Default Credentials. That does not block the cloud Orb; install Java 21 before running local Firestore emulator tests on this Mac later.

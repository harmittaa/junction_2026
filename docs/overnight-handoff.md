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
| Billing | Owner set a €30 monthly project target: project alerts at €15/€27/€30, plus a configured €25 monthly Cloud Run spend cap to leave headroom. This is not a guaranteed €30 project ceiling; see below. |
| Coding models | ChatGPT and Claude subscriptions connected. GPT-6 Astra coordinator; lighter Sonnet 5.5 / GPT-6.1 Sol workers, subject to the quota policy below. |

App Hosting has been provisioned; application deployment awaits implementation and its checks. Do not change unrelated projects, accounts, billing, or IAM. Use `--project sponky-junction-2026` on cloud commands.

## Spending safeguards

On 14 November the owner requested a €30 ceiling. The project-wide monthly alert budget was updated to €30 (`80ca235a-bbd9-4ecd-b558-3adea77d43d7`). A separate native Cloud Billing spend cap was created and read back as `CONFIGURED`: €25/month for Cloud Run in this project (`e1fb878c-625e-4077-ae35-ad0cd29965f8`, service `152E-C115-5142`). Cloud Run is the underlying App Hosting runtime. The lower threshold leaves nominal headroom toward the owner's €30 target; it does not reserve or cap the remaining €5.

[Google documents](https://firebase.google.com/docs/projects/billing/spend-caps) that spend caps pause new service usage after estimated spending reaches the threshold, with reporting/enforcement delay and billable overages. The service resumes next month. This cap does not cover Firestore, builds, artifact/storage charges or external Gemini/ElevenLabs accounts. Do not describe it as a hard project-wide ceiling. Alerts alone never stop usage.

Keep runtime at zero minimum and one maximum instance, use emulators for repeated tests, bound provider inputs/outputs and retries, and avoid repeated deployments. Do not lift/increase spend caps or modify billing. If a spend cap pauses the demo, report that clearly and stop paid retries; the owner can decide whether to resume it.

## Credentials and configuration

`GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, and `SESSION_SECRET` are project-scoped Amp secrets and Google Secret Manager secrets. App Hosting injects them only at runtime. `.env.example` defines the application configuration contract; implement a server-only config module that reads it. The original laptop `.env` calls its ElevenLabs key `ELEVEN_LABS_API_KEY`; it was mapped to `ELEVENLABS_API_KEY` during setup. The Claude key is not needed by this application and was not copied.

The Orb uses Google Workload Identity Federation, restricted to this Amp project and its owner, to impersonate `amp-sponky@sponky-junction-2026.iam.gserviceaccount.com`. `.agents/resume` writes a refreshable external-account configuration; `.agents/gcp-token` supplies temporary tokens to Google libraries. No Google service-account private key or personal refresh token is stored in Amp. Do not print the helper's output.

The deployed server uses `firebase-app-hosting-compute@sponky-junction-2026.iam.gserviceaccount.com`. It can access the three named secrets and Firestore. All client Firestore reads/writes are denied by `firestore.rules`; application authorization is still necessary because the Admin SDK bypasses these rules. No Firebase Auth signup or browser Firebase SDK is required for the bounded server-session demo.

Use a `demo-*` project and `FIRESTORE_EMULATOR_HOST` for deterministic persistence tests, isolated from the real demo database. Do not set the emulator variable in App Hosting. Local worktrees do not inherit `.env`; provide secrets explicitly when working locally. The Orb receives secrets as environment variables.

## Startup and permissions

`.agents/setup` selects Node 22 to match App Hosting, installs Java 21 if needed and downloads the Firestore emulator. Once the app has a lockfile it also installs dependencies and Chromium. `.agents/resume` configures Google credentials after the Orb identity is available. These scripts must be on the Amp project's base branch before starting a new Orb. See [Amp lifecycle](https://ampcode.com/docs/orbs/customizing) and [secret handling](https://ampcode.com/docs/orbs/handling-secrets).

The checked-in `.amp/settings.json` permits commits, pushing to the overnight branch and **main after passing acceptance**, and the exact demo deploy command below. The installed local CLI only applied these rules when passed `--settings-file .amp/settings.json`; do not assume its permission-test command loads workspace settings automatically. The cloud preflight ran without approval prompts; exact remote push/deploy permissions still need exercising during implementation. Do not enable global `dangerouslyAllowAll`.

Approved overnight work: install project dependencies, implement and test the bounded product, make commits, push `amp/sponky-overnight`, integrate the tested result into `main`, and deploy this demo after the combined checks pass. The owner explicitly authorized merging without waiting for human PR approval; this supersedes earlier instructions to leave main for review. Do not modify billing/IAM or start extra paid infrastructure. Provider calls are for short explicit smoke checks and the demo; default tests use deterministic transports.

```sh
git push -u origin HEAD:amp/sponky-overnight
# After fetching/integrating current main and passing combined acceptance:
git push origin HEAD:main
npx -y firebase-tools@latest deploy --only firestore:rules,apphosting:sponky --project sponky-junction-2026 --non-interactive
```

No application exists at the initial audited `main` commit `062a4e0`. It contains the design prototype, style guide/tokens and agent guidance. Issues #1–#12 are briefs/references; at that audit there were no dependency-ordered implementation tickets. Re-read current `main` and issues before creating any missing tickets so concurrent planning work is not duplicated.

## Coding quota and delegation policy

The owner confirmed both subscriptions and asked to preserve **at least 50% of the Claude weekly allowance**, favor Claude when safe, and use the larger OpenAI allowance for overflow. Observed at approximately 01:27 Helsinki on 14 November: Claude session 64% used, resets 03:59; weekly all-model usage 17%, resets 17 November 22:59; Fable weekly usage 13%. These are snapshots, not live limits.

Use `openai/gpt-6-astra` at high effort for the integration coordinator and focused reviews. Delegate bounded implementation to `anthropic/claude-sonnet-5-5` at medium effort when current subscription usage can be verified; otherwise use `openai/gpt-6.1-sol` at medium effort. At most two implementation workers at once, each owning a separate worktree. Keep lockfile/shared-contract edits under one owner. Use the strong model for unclear architecture, financial rules and security decisions rather than asking a weak worker to guess.

Amp Task subagents inherit the parent model/effort. To get a different model, use a separate Amp thread with an explicit model and an agreed base/contract, then retrieve its commits/files. Do not assume calling Task creates a cheaper worker. See [Amp models and subagents](https://ampcode.com/docs/models-and-subagents).

The CLI's `amp usage` does not report Claude subscription utilization. `model-providers check-access` confirmed Sonnet routes through the Claude subscription but returned no quota headers. Provider priority does not implement cross-model fallback. Do not deactivate subscriptions: that can route the same model to paid Amp credits.

If a live, authorized quota source is available, check both session and weekly headroom before each Claude task. Switch workers to OpenAI before 40% weekly usage or 85% session usage to leave a buffer. A short-session reset does not reset the week. If live usage is unavailable, use OpenAI for unattended implementation; never run Claude indefinitely from the stale snapshot or claim a prompt is a hard quota cap. Do not copy personal Claude login credentials into the Orb or build a quota-monitoring service. No Fable, Fast/Plaid mode, paid API coding fallback, or unbounded review loops. Switch back to Claude only with fresh verified headroom.

## Implementation order if no newer plan exists

Read `AGENTS.md`, #1, #2, #8 and #9 with their latest comments. The voice updates and owner review in #9 supersede the initial voice exclusion and mandatory eight-step journey. Keep the approved coach design and optional branches. Use one integration owner, one task worktree, and small commits; avoid launching a swarm just to meet the morning target.

1. **Scaffold and data:** Next.js/React/TypeScript, shared validated contracts, `npm run check`, `npm run build`, `npm run test:e2e`, and focused emulator checks. Inspect the supplied data and commit a small reproducible customer slice with provenance. No fabricated totals.
2. **Connect one real typed spending question:** UI → `src/server/coach.ts` → integer-cent domain calculation → evidence card. Bind the customer in the server session. Add Gemini interpretation with validated operations, bounded calls, clarification and failure recovery. Keep model SDK objects out of UI/domain.
3. **Optional guess/reveal and exploration:** enforce the hidden answer in text and speech; direct answer bypasses guessing. Then confirmed basket correction and percentage what-if, preserving historical amounts and distinguishing hypothetical savings.
4. **Saved daily habit/check-in:** server-owned signed session, confirmed mutations, reload persistence and atomic duplicate-date protection. First completion shows 1 day. Follow #9's current no-points/no-missed-day-penalty decision; label simulated historical dates.
5. **Real voice:** tap-start/tap-stop, `scribe_v3_live` with server-minted single-use tokens, short spoken replies, mute and “Speak instead.” Commit and receive final transcription before closing the connection. Stop playback before capture and ignore late events from canceled turns. Typing always works.
6. **Integrate, verify and deploy:** reusable coach/cards, phone layout, light/dark and reduced motion; animation follows actual recording/playback. Add the memorable reveal after the flow works. Run combined quick checks, emulator tests, production build and essential browser smoke journeys. Deploy and repeat a small live smoke; record the URL and exact commit.

When complete, stop. Leave the branch/commit, demo URL, reproducible morning test steps, checks run, provider checks, and remaining limitations. If one external service blocks progress, preserve the working typed path, finish independent work and report the blocker. Do not describe a fake fallback as a live integration.

## Grounded data and autonomous delivery

Use the supplied challenge's **synthetic historical records**, never pretend they are live banking data. The data worker pinned and checksum-verified the full source, recorded source rows and documented transaction inclusion rules in `data/README.md`. An independent setup-side check also matched all 39 exported records/fields directly against the pinned CSV: October groceries 75,275 cents and total gross spending 216,735 cents. That check verifies imported rows; the worker's full-source scan supplies completeness evidence.

All factual financial claims, personalized suggestions and spoken numbers must follow validated application calculations and selected-customer evidence. A JSON schema and a prompt saying “do not invent” do not validate the truth of arbitrary model reply text. Review the chat/clarify path as well as evidence cards and TTS: unsupported transaction facts or savings claims must not pass through unchecked. Use application-owned factual wording/validated results; suggestions need an explicit observed basis, and hypothetical reductions remain hypothetical. Missing data means unavailable or no matching records in the selected slice, not proof of no spending elsewhere. Keep future rows hidden until the simulated date permits them. Cover these boundaries with focused regression cases, including a deliberately hallucinated provider reply.

The owner prioritizes delivery and authorizes integrating worker commits, resolving ordinary conflicts, merging into main and deploying without a human approval pause. Fetch current main before integration, preserve others' work, and run required checks on the combined result. Use a normal PR merge if convenient or a non-force fast-forward push of the integrated result; no bypassing actual repository protections or weakening tests. If GitHub prevents main integration, publish/deploy the checked branch and report that limitation instead of waiting with no usable demo. Do not wait for a CI event if no applicable workflow exists; run the required commands directly. Infrastructure/billing changes outside the existing authorization still remain out of scope.

Before stopping, reconcile current issue #1/#8/#9 requirements and later owner updates against the actual app. Give each requirement concrete evidence or an explicit limitation. Routine implementation failures require diagnosis and a bounded fix/recheck, not a request for permission or another plan. An external outage, exhausted quota, enforced spending cap or missing account privilege can still block delivery; never promise these cannot happen or conceal them behind fake results.

## Pivotability and final review

The owner expects to change the product after testing this first version. Use the existing repository skills on demand; do not install more frameworks or start an architecture rewrite. Apply the separation and reuse rules already in `AGENTS.md`: pure money/product rules, a small coordinator, provider-specific transports with application-owned contracts, storage-owned persistence, and composable UI. A provider swap should affect its integration/configuration and relevant contract tests; a different screen order should reuse the same cards and domain operations. Add an adapter only when a real provider needs it. Keep saved-data changes explicit rather than silently reinterpreting records.

Before deployment, arrange one focused review of the integrated diff by a strong reviewer after implementation workers finish, within the existing concurrency/quota policy. Review connected callers and the actual tests for wrong money, cross-session access, premature reveal (including audio), duplicate mutations, stale/canceled audio events, provider failure recovery, and accidental UI/provider/storage coupling. Fix concrete blockers and add relevant regression cases; do not turn style preferences or speculative future requirements into a refactoring backlog. Run affected checks after fixes and the required combined acceptance checks on the final deploy candidate. Do not claim independent review if it did not occur.

Integrate working increments and push checkpoints to the authorized branch. Preserve the last verified working commit while adding the remaining required flows. If one provider is blocked, finish independent work and clearly label the limitation; a fake integration is not completion. The final handoff must identify the exact tested/deployed commit, working URL, a few morning test steps, known failures, and a short map of where to change journey/copy, calculations, reasoning, speech and persistence. Stop after the agreed slice passes; no extra features to fill the night.

## Dataset download trap

The source is [the challenge dataset](https://github.com/hackjunction/Junction-2026-S-pankki), pinned for inspection at `fbdecdedf1a1f49dd641c2e6b9f2b62d0dc0cc8f`. `tx_junction_transactions.csv` is Git LFS data: ordinary raw content is a 134-byte pointer. The actual file is 362,796,501 bytes, SHA-256 `49b3265d8e44e751de305a074dcffcda732bb79aa1e07b46fcca774ce76f1e63`. Download through Git LFS or [the media URL](https://media.githubusercontent.com/media/hackjunction/Junction-2026-S-pankki/fbdecdedf1a1f49dd641c2e6b9f2b62d0dc0cc8f/tx_junction_transactions.csv), outside the committed tree, and preserve source row references in the selected slice.

A bounded source sample was readable. It contains `Restaurants` and `Transportation`, not a literal `Taxis` category. Inspect MCCs before claiming a taxi-specific total. Amounts are signed euro decimals and timestamps use values such as `03OCT24:09:04:04`; `tx_date` is ISO format. Parse money explicitly into integer cents and handle BOM. Define transfers/refunds before summing. Source availability is verified; a complete customer slice has not yet been selected or imported.

## Checks recorded during setup

- GitHub repository access, Firebase/Google Cloud project creation, Amp GitHub connection and repository skill discovery succeeded.
- Gemini `gemini-4-hydrogen`: a real bounded request returned `READY`.
- ElevenLabs `eleven_flash_v2_5`, George: generated a short PCM audio clip. Scribe `scribe_v3_live` transcribed it as “How much did I spend on groceries last month?” using a single-use token.
- ElevenLabs voice listing works. Subscription/model-list endpoints return `missing_permissions`; remaining provider credit was not visible to this key. Real speech endpoints did work.
- Credential helper tests exercise token normalization, failure redaction and repeatable restricted credential configuration. They make no cloud calls.
- [Cloud preflight](https://ampcode.com/threads/T-01a1d738-a38b-7105-bdea-dc3ae52fb35d): all ten skills and three secrets found; external-account ADC successfully listed the live database/backend; both credential tests passed; emulator get/list/create/update/delete were all denied with 403. No cloud data was written. The Orb initially had Node 26; setup now selects Node 22 before implementation checks.
- Firestore rules compiled and were deployed successfully. The application itself is not yet deployed.
- These checks do not establish browser microphone behavior, perceived voice quality, interruption, application correctness, or a deployed application. Those are implementation acceptance checks.

The Mac has Node 22 and authenticated GitHub, Firebase, gcloud and Amp CLIs. It has no Java runtime or local Google Application Default Credentials. That does not block the cloud Orb; install Java 21 before running local Firestore emulator tests on this Mac later.

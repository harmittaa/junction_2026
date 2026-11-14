# Sponky hackathon instructions

## Priorities and sources

1. Meet the [S-Pankki challenge brief](https://github.com/harmittaa/junction_2026/issues/1): conversational exploration of the user's synthetic transaction data, financial literacy through the three baskets, personalized insights, clear mobile UX, and a feasible S-mobiili entry point.
2. Keep components and product logic reusable, and speech/reasoning providers replaceable, so we can prototype and pivot without rebuilding the foundations.
3. Deliver small working changes with focused checks. Protect time for the demo and submission.

Read the issue being implemented and its latest comments. [Product scope #8](https://github.com/harmittaa/junction_2026/issues/8) and [design #9](https://github.com/harmittaa/junction_2026/issues/9) define our current slice; their later voice updates supersede the earlier voice exclusion and mandatory eight-step journey. [Interview #3](https://github.com/harmittaa/junction_2026/issues/3) supplies context; research #4 is inspiration, not a backlog. Raise conflicts with the challenge brief instead of silently changing the product.

Use `docs/style-guide.md` and `docs/design-tokens.json`. Preserve documented accessible color mappings. Voice input is tap-to-start/tap-to-stop, replies are spoken, and typing remains available. Guessing, exploration and habits are optional. Historical and simulated dates must be explicit. Native apps, live banking, transfers, notifications and safe-to-spend forecasts are outside the current scope.

## Baseline and boundaries

- Next.js, React and TypeScript; Firebase App Hosting and Firestore. Start with Firestore Standard for this bounded app unless an existing selected database or explicit decision requires otherwise.
- Initial integrations: Gemini for reasoning and ElevenLabs for transcription and speech. Model IDs and provider selection belong in configuration, not product components.
- Keep pages/API routes thin. Put calculations and product rules in `src/domain`, coordination in `src/server/coach.ts`, provider integrations in provider-specific modules, and persistence in `src/server/storage`. Create directories when needed, not empty scaffolding.
- Define shared request/result/event contracts before splitting work across callers. Keep each boundary's runtime validation and TypeScript types together, deriving types from schemas where supported; do not maintain separate frontend/backend copies or use type assertions as validation. UI and domain code must not consume provider response objects or import provider SDKs.
- Keep domain functions independent of React, Next.js, Firebase and provider SDKs. Pass records, assumptions and the reference date explicitly; calculations must not perform network calls or read the clock implicitly. UI previews and server results reuse the same calculation rules, with the server validating inputs and authoritative results.
- Give state a clear owner: saved habits, corrections and check-ins belong to the server; drafts and playback belong to the client. Derive totals and display values instead of maintaining competing copies. Persisted-shape changes need a migration or an explicit demo reset, never silent reinterpretation of existing records.
- Build reusable UI components around data and callbacks. Keep provider calls, persistence and journey sequencing outside presentational components. Compose the same spending, evidence, basket, scenario and habit components into different flows; do not tie them to one demo script or screen order. Reuse the existing design tokens and shared interaction patterns.
- Represent voice and activity lifecycles with explicit typed states and transitions, separately where they are independent. Prefer a small union/reducer over overlapping boolean flags or chains of effects. No state-machine library is required; keep audio/session cleanup in the module that owns those resources.
- Browser audio transport may live in a browser-safe provider module. Permanent credentials and privileged data access stay server-side; browser connections use appropriately scoped temporary tokens.
- Select reasoning, transcription and speech separately. A combined live voice provider can have its own session integration emitting the same application events; do not force it into artificial sequential calls. Financial operations still go through application validation, and speech must respect guess/reveal state.
- Normalize provider errors, cancellation and completion. Ignore late events from canceled turns; stop playback before recording an interruption. Failure must preserve saved state and leave typing/retry usable.
- Add an integration when we try that provider. Avoid a generic plugin framework, dependency-injection container, speculative wrappers, or multiple runtime backends.
- Split a module when it mixes product rules, provider transport, storage and rendering; do not split by arbitrary line counts or create a generic `utils` dumping ground. Extract repeated behavior into focused components, hooks or functions. Design reuse around actual product needs, without speculative configuration or a universal component framework; keep financial rules and boundary contracts single-sourced.

## Rules that prototypes must preserve

- Calculate money in application code using integer cents and explicit percentage rounding. Keep source row references and the selected customer's scope. Never substitute illustrative totals for actual dataset results.
- Ground every financial fact and personalized suggestion in validated calculations over the selected customer's source records. Keep source-row evidence, dates and assumptions available; schema-valid model prose is not proof. Never pass unchecked model financial claims into text or speech. Distinguish no matching records, unavailable data, hypothetical reductions and confirmed saved state.
- Bound data access to the operation: reuse the verified small immutable demo slice and read only the current session/needed records. Never scan the whole Firestore database, reload the full source CSV, or send all transactions to the model on each turn. If transactions move to Firestore, use customer/date/category filters with the needed indexes and explicit result/work limits; handle truncation explicitly instead of claiming a partial result is complete. Cache only immutable or safely scoped derived data, and invalidate it when corrections or the simulated date change. Do not add a caching service or benchmark project for this demo.
- Treat basket assignments as correctable interpretations. Corrections never alter historical amounts; hypothetical savings never become recorded savings.
- Validate inputs and model-proposed operations at the boundary. No arbitrary SQL/code execution, model-selected customer access, or model-generated executable UI.
- The application owns guess/reveal and confirmed mutations. Model text alone cannot save a habit, change a goal or complete a check-in. Do not disclose an answer through text, audio or UI before the reveal.
- Complete a check-in at most once per session/user and date, atomically. Ordinary conversation is not completion. Keep calendar-date handling explicit, including the simulated demo date.
- Keep credentials out of source, logs, browser bundles and fixtures. Preserve session isolation and bound requests, retries and output. Firestore Admin access bypasses Security Rules, so server authorization is still required.
- Keep touch targets, labels, keyboard access, light/dark modes and reduced-motion support. Animate actual recording/playback state rather than implying a microphone is active when it is off.

## Small, useful checks

Test observable behavior and expensive-to-break rules, not implementation details. No coverage quota, giant snapshot suites, tests for trivial copy/CSS changes, or paid-provider calls in the default test run.

| Change | Minimum useful check |
| --- | --- |
| Calculations, parsing or state transitions | Focused Vitest cases with small fixtures: normal behavior plus the relevant edge/failure case. |
| Bug fix | A regression case at the lowest useful level, when reproducible. |
| Provider integration | Deterministic fixtures/fake transport covering normalized output and the changed error/cancellation behavior. Do not mock the whole SDK. |
| Persistence or access controls | Focused Firestore Emulator checks for the affected write, isolation or rule; exercise duplicate/concurrent check-in writes when changing that path. |
| UI interaction | Exercise the changed path at phone width. Add browser automation only when it protects an important journey. |
| Copy, styles or documentation | Inspect the result and check relevant links/layout; no new unit tests. |

- Run `npm run check` for typecheck, lint, deterministic Vitest cases and Python importer checks; `npm run test:emulator` for isolated Firestore integration checks; and `npm run build` before `npm run test:e2e` for production compilation and Playwright smoke journeys. Report a check as passing only after running it.

- Before handing off application code, run the quick check and any affected integration/browser checks. Keep the quick check roughly within a minute; split slow tests instead of dropping valuable checks.
- Before merging application changes or preparing a demo deployment, run the production build and the small smoke suite against the combined result. Do not rebuild after each tiny edit when no new concern warrants it.
- Keep smoke coverage to the essential paths: ask/guess-or-skip/reveal; correction and what-if; confirmed habit/check-in with reload and no duplicate credit; provider failure with typing recovery. Reuse setup and fixtures.
- Keep live-provider checks explicit and separate from CI. No latency benchmark work is requested now. A fake-provider pass is not evidence that real audio, credentials or the deployed integration work.
- Report what passed, what was not run and why. Do not weaken assertions, disable checks or remove failing tests merely to get a green result.

## Skills and current documentation

Project skills are vendored under `.agents/skills/` and travel with a clone or worktree; no global Codex skill installation is needed. Amp discovers this directory and reads this root `AGENTS.md`. Run `amp skills list --json` from the repository root to verify discovery. If a personal skill shadows one of these names, use the repository copy explicitly. In an existing Amp session, ask it to reload skills after pulling changes; listing them in another shell does not refresh that session. See [Amp's skill documentation](https://ampcode.com/docs/customize/skills).

Before working on a tool, read its relevant `SKILL.md` and only the references needed for that task. If your agent does not discover this directory automatically, open the paths below directly. Do not load the whole catalog into every task.

| Work | Skill path relative to `.agents/skills/` |
| --- | --- |
| React/Next.js implementation and performance | `react-best-practices/SKILL.md` |
| Firebase CLI/project setup | `firebase-basics/SKILL.md` |
| App Hosting configuration and deployment | `firebase-app-hosting-basics/SKILL.md` |
| Firestore data, indexes and SDK integration | `firebase-firestore/SKILL.md` |
| Firestore Security Rules | `firestore-rules-creation/SKILL.md` |
| Gemini reasoning/function calls | `gemini-api-dev/SKILL.md` |
| Gemini live audio/transcription alternatives | `gemini-live-api-dev/SKILL.md` |
| ElevenLabs transcription | `speech-to-text/SKILL.md` |
| ElevenLabs speech output | `text-to-speech/SKILL.md` |
| Interactive browser inspection | `playwright/SKILL.md` |

Use Playwright's project-local wrapper at `.agents/skills/playwright/scripts/playwright_cli.sh`; its upstream examples assume a global Codex installation. This browser skill complements the application's smoke tests.

Next.js retired the separate `next-best-practices` skill. Once the framework is installed, consult its version-matched bundled docs when available, otherwise the official docs for that version. Preserve these project rules if framework tooling adds documentation pointers. Use the official Vitest/Playwright docs for test-runner APIs.

Skill sources and pinned revisions are recorded in `.agents/skills/SOURCES.md`. For a new provider, find and inspect an official skill, install only the relevant package and record its source; if none exists, use official documentation. Do not install similarly named skills blindly. Skill examples are not permission to change our stack, expand scope, provision infrastructure, deploy, or spend on API calls. Apply only relevant workflows within the user's authorization; reuse already established project/provider choices.

## Working together

- During implementation, connect one narrow spending-question flow from UI through the coordinator and data calculation back to the UI before expanding features. Other workers can build against the agreed contracts, but integrate small working increments frequently. Do not leave the first integration until every subsystem is finished.
- **Always use a separate Git worktree and task branch for writing work, including documentation.** One active worker owns each worktree; never run concurrent writers in the same checkout. Reuse your assigned worktree when continuing the same task. Reserve the primary checkout for coordination and integration.
- Before editing, check `git status --short`, `git branch --show-current` and `git worktree list`. If no worktree is assigned, create a sibling worktree on a uniquely named branch from the agreed base. Use current `origin/main` for independent work, or the agreed parent branch for dependent work. Never switch, reset, stash, clean or overwrite another worker's checkout.
- Start Amp inside the assigned worktree, or use its runner's **New Worktree** option. Check the base commit: Amp's runner creates from the selected checkout's current HEAD. Run all edits, installs, tests and commits with the assigned worktree as the working directory. See [Amp's worktree support](https://ampcode.com/news/one-runner-many-worktrees).
- A worktree includes committed `AGENTS.md` and `.agents/skills/`; it does not inherit uncommitted plans, ignored credentials or installed dependencies. Start from a base containing the required guidance and arrange local configuration without committing secrets or sharing mutable build/dependency directories.
- Worktrees isolate files, not ports or remote services. Use distinct dev-server/emulator ports and isolated test data for concurrent work. Coordinate changes to shared Firebase resources and deployments through one owner.
- Hand off the worktree path, branch and commit/PR. Integrate through reviewed commits and run the combined checks; worktrees do not prevent merge conflicts. Do not remove another worker's worktree or force removal of uncommitted/unmerged work.
- Read connected callers before changing a shared contract. Update callers and fixtures together; tell other active workers when the interface changes.
- Keep changes scoped to the assigned work. Preserve unrelated edits and existing worktrees. Coordinate shared config and lockfile changes through one owner when work is split.
- Before adding a component, hook, calculation or integration helper, look for an existing reusable implementation and extend or compose it where appropriate. Add a dependency only when it removes meaningful work. Avoid unrelated refactors and speculative optimizations.
- At handoff, check reusability: can this component or rule support a changed journey or provider without copying it? Move accidental screen/provider coupling to the owning coordinator or integration, and note any intentional coupling that remains. Keep this check in implementation issue acceptance criteria as work is split.
- Mark a deliberate limitation with `shortcut: <limit>, <when to revisit>` near the affected code. Never use a shortcut to excuse incorrect money, exposed data or silently lost state.
- Finish with a short handoff: behavior changed, checks run, remaining limitation. Do not claim a scripted prototype, fake provider or simulated date is live behavior.

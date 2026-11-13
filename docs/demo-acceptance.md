# Sponky demo acceptance record

Integration branch: `amp/sponky-overnight`, based on setup `c277323` (not a replacement for `main`). Implementation backlog: #16 → #17 → #18 → #19, voice #20 against the shared contract, then #21 for combined acceptance/deployment.

## Scope and choices

- Node 22, Java 21, GitHub and Google ADC preflight passed. Existing Standard Firestore and `sponky` App Hosting backend verified. No new infrastructure or IAM changes.
- Workers use GPT-6.1 Sol at medium effort; fresh Claude subscription quotas are unavailable. Maximum two independent workers, separate worktrees. No premium coding modes or paid coding keys.
- Real dataset: `data/README.md`. CUST00001, October–November 2024; initial simulated date 2024-11-04. Gross spending includes negative purchase/housing_payment/utilities_payment rows only. Income and investment movements remain in the source slice but do not count as spending. No refunds in this pinned source. Queries cannot include future simulated dates.
- The demo uses groceries, not illustrative taxis. October groceries: 75,275 cents / 11 source purchases. Baskets are interpretations, not judgments. Percentage scenarios use only rows currently assigned Everyday spending and never claim recorded savings.
- Session state lives under `demoSessionsV1`; existing data is never silently reinterpreted. Signed HttpOnly seven-day cookies isolate browsers. Client Firestore access stays denied. Application validation and transactions enforce authorization/once-per-date completion.
- Daily provider ceilings are enforced per browser session and globally in Firestore. They reduce exposure but are not billing caps. Runtime remains minInstances 0 / maxInstances 1.

## Checkpoints

- Full source SHA-256 verified; import selected 39 records. Independent Decimal reconciliation and regeneration passed; importer has three deterministic tests.
- First narrow browser path passed at 390 px: real Gemini interpreted “How much did I spend on groceries last month? Just show me.” App calculated 752,75 € / 11 purchases. First acceptance reasoning call used; no speech calls yet. Local storage used the disposable emulator, not production.
- Initial quick check: TypeScript, ESLint, eight Vitest cases and three importer tests passed. Hidden-answer serialization omits totals/evidence/model text; invalid model output and cookie tampering are checked.

Combined acceptance, deployed URL, final commit, speech evidence and morning steps will be recorded after integration. This checkpoint does not claim deployed hosting or working voice.

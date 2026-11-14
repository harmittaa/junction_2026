# Automatic deployment

`.github/workflows/deploy.yml` runs only after successful **push-to-main** CI. PR checks and manually dispatched CI never deploy. It checks out the exact tested SHA, then checks the current main head again immediately before starting the rollout. Superseded or out-of-order CI completions skip deployment.

Deployments share one concurrency group with cancellation disabled. An in-progress rollout finishes before another deployment starts; queued runs recheck main before deploying. The script also refuses to start while another App Hosting rollout is active. Manual deployments must not overlap this workflow.

The workflow installs deployment-only Firebase CLI **15.36.0** outside the source directory; application dependencies and the test CLI remain on their lockfile versions. Unlike the test CLI's 14.x release, this version checks for the existing runtime account and tolerates denied re-grant attempts for its already-provisioned roles. The deployment identity must not receive project IAM administration.

It deploys only `apphosting:sponky`, then `hosting`, in `sponky-junction-2026`. It does not deploy Firestore rules or change IAM, billing, secrets, runtime scaling or other services. The existing Hosting rewrite targets Cloud Run service `sponky` in `europe-west4` without `pinTag`; keep its service-only public invoker binding and the application's `__session` cookie.

## GitHub OIDC setup

The deploy job uses `google-github-actions/auth` and short-lived service-account impersonation, not a service-account key or a user's refresh token. These are public resource identifiers, not secrets:

- Provider: `projects/967386564020/locations/global/workloadIdentityPools/github-actions/providers/github`
- Service account: `github-sponky-deploy@sponky-junction-2026.iam.gserviceaccount.com`
- Issuer: `https://token.actions.githubusercontent.com`
- Attribute mapping: `google.subject=assertion.sub,attribute.repository_id=assertion.repository_id`
- Provider condition: `assertion.repository_id == '1456932559' && assertion.repository_owner_id == '15930880' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == 'harmittaa/junction_2026/.github/workflows/deploy.yml@refs/heads/main' && assertion.event_name == 'workflow_run'`
- Grant `roles/iam.workloadIdentityUser` on that service account only to `principalSet://iam.googleapis.com/projects/967386564020/locations/global/workloadIdentityPools/github-actions/attribute.repository_id/1456932559`.

Owner-side Codex provisioned this restricted trust on 14 November 2026. The existing `amp-orbs/amp-oidc` provider trusts Amp, not GitHub; do not broaden it or copy Orb credentials into GitHub.

Deployment permissions are limited to the existing project: App Hosting Admin, Firebase Hosting Admin, Firebase Viewer, Service Usage Consumer and Storage Viewer; Storage Object Creator on `firebaseapphosting-sources-967386564020-europe-west4`; and Service Account User on `firebase-app-hosting-compute@sponky-junction-2026.iam.gserviceaccount.com`. Cloud Run readiness requires service read access. No IAM-admin, secret-content, Firestore-write or billing grant is needed. The CLI's attempt to re-grant already-provisioned runtime roles must not be solved by granting project IAM administration.

Temporary authentication configuration is moved outside the source directory before Firebase archives it, and removed afterward. The script refuses to archive a source directory still containing `gha-creds-*.json`. No CI cache or artifact is used as deployment input.

## Verification and failures

`scripts/deploy.mjs` checks the new rollout rather than trusting the Firebase CLI exit code: the rollout must succeed, its READY build must refer to this upload, and the matching ready Cloud Run revision must serve 100% of traffic. It then verifies HTTPS at **https://sponky.web.app**, compares the public page's application assets with the App Hosting origin, and checks every referenced JS/CSS asset is available. It makes no Gemini/ElevenLabs calls and does not create a session.

The Actions step summary records the checked Git SHA, source rollout, ready revision and public URL. A failed deployment or verification fails the job; no automatic rollback or paid-provider retry is attempted. Do not cancel a running deployment to replace it with a newer commit. Once a failed cloud rollout has settled, rerunning the successful current-main CI can trigger deployment again; an old commit is skipped.

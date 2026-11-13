# Installed project skills

Installed on 2026-11-14 with Codex's `skill-installer`, using explicit upstream commit revisions and this directory as `--dest`. These are instruction/reference packages, not application dependencies. Installation did not execute their bundled scripts, configure cloud accounts, or call model APIs.

The complete skill directories are version-controlled in this repository, including their reference files, scripts and bundled assets. A fresh clone supplies them to Amp through its project `.agents/skills/` discovery; Codex and its installer are not runtime prerequisites. From the repository root, run `amp skills list --json` and check the reported paths. Personal skills with the same frontmatter name can shadow these copies; use the repository paths in `AGENTS.md` when that happens. See [Amp's documentation](https://ampcode.com/docs/customize/skills). Provider credentials and any runtime SDKs/CLIs are configured separately when implementation needs them.

Read the relevant `SKILL.md` on demand as directed by the root `AGENTS.md`. Agents without automatic discovery can read those same files directly. Keep upstream files unchanged; put project-specific decisions in the root instructions. To update, inspect the new upstream version, use the installer with an explicit `--ref`, and update this record. Do not refresh skills automatically during feature work.

| Installed directory | Upstream path | Pinned revision |
| --- | --- | --- |
| `firebase-basics` | [firebase/agent-skills: skills/firebase-basics](https://github.com/firebase/agent-skills/tree/99954a30898bb5ddc8152ee10e124dc3b4106bf7/skills/firebase-basics) | `99954a30898bb5ddc8152ee10e124dc3b4106bf7` |
| `firebase-app-hosting-basics` | [firebase/agent-skills: skills/firebase-app-hosting-basics](https://github.com/firebase/agent-skills/tree/99954a30898bb5ddc8152ee10e124dc3b4106bf7/skills/firebase-app-hosting-basics) | `99954a30898bb5ddc8152ee10e124dc3b4106bf7` |
| `firebase-firestore` | [firebase/agent-skills: skills/firebase-firestore](https://github.com/firebase/agent-skills/tree/99954a30898bb5ddc8152ee10e124dc3b4106bf7/skills/firebase-firestore) | `99954a30898bb5ddc8152ee10e124dc3b4106bf7` |
| `firestore-rules-creation` | [firebase/agent-skills: skills/firestore-rules-creation](https://github.com/firebase/agent-skills/tree/99954a30898bb5ddc8152ee10e124dc3b4106bf7/skills/firestore-rules-creation) | `99954a30898bb5ddc8152ee10e124dc3b4106bf7` |
| `gemini-api-dev` | [google-gemini/gemini-skills: skills/gemini-api-dev](https://github.com/google-gemini/gemini-skills/tree/87fb0173d36fea4f87de4c3fbd0678cf929c0588/skills/gemini-api-dev) | `87fb0173d36fea4f87de4c3fbd0678cf929c0588` |
| `gemini-live-api-dev` | [google-gemini/gemini-skills: skills/gemini-live-api-dev](https://github.com/google-gemini/gemini-skills/tree/87fb0173d36fea4f87de4c3fbd0678cf929c0588/skills/gemini-live-api-dev) | `87fb0173d36fea4f87de4c3fbd0678cf929c0588` |
| `speech-to-text` | [elevenlabs/skills: speech-to-text](https://github.com/elevenlabs/skills/tree/1d84076319721b3e0b3c8189c76e91a0d859d9d4/speech-to-text) | `1d84076319721b3e0b3c8189c76e91a0d859d9d4` |
| `text-to-speech` | [elevenlabs/skills: text-to-speech](https://github.com/elevenlabs/skills/tree/1d84076319721b3e0b3c8189c76e91a0d859d9d4/text-to-speech) | `1d84076319721b3e0b3c8189c76e91a0d859d9d4` |
| `react-best-practices` | [vercel-labs/agent-skills: skills/react-best-practices](https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/react-best-practices) | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` |
| `playwright` | [openai/skills: skills/.curated/playwright](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/playwright) | `49f948faa9258a0c61caceaf225e179651397431` |

The React skill's declared name is `vercel-react-best-practices`; its installed directory retains the upstream path name `react-best-practices`.

Upstream licenses are retained in `licenses/` for Firebase, Gemini and ElevenLabs. Playwright includes its own `LICENSE.txt` and `NOTICE.txt`. The Vercel React skill declares MIT in its front matter; the selected upstream tree contains no separate license file.

## Deliberate omissions

- Next.js's former `next-best-practices` skill was retired. Follow [the upstream migration notice](https://github.com/vercel-labs/next-skills/blob/c522619e45aa3492fd2bfc916b308b275eff7798/README.md) and use version-matched framework documentation after scaffolding.
- Use [Vitest documentation](https://vitest.dev/guide/) and [Playwright Test documentation](https://playwright.dev/docs/intro) for the small automated suite. The installed Playwright skill is for interactive browser work.
- Install additional provider skills, such as Claude API guidance, when that provider is introduced. No Firebase AI Logic, Genkit, hosted voice-agent framework, or deployment-to-Vercel skill is required by the current architecture.

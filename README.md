# Sponky

Sponky is a mobile-first conversational money-coach prototype for the S-Pankki challenge at Junction 2026. It explores one synthetic customer's historical spending through optional guesses, correctable three-basket interpretations and daily reflections, with voice and typing—not a live banking connection.

## Local setup

Use Node.js 22 (`.nvmrc`), Java 21 for the Firestore emulator, and Python 3 for the checks.
From the repository root:

```sh
npm ci
cp .env.example .env.local
```

In `.env.local`, set `GEMINI_API_KEY`, `ELEVENLABS_API_KEY` and a random `SESSION_SECRET` of at least 32 characters. Keep these server-only and uncommitted. Retain the supplied model/voice settings (`GEMINI_MODEL`, `GEMINI_THINKING_LEVEL`, `ELEVENLABS_STT_MODEL`, `ELEVENLABS_TTS_MODEL`, `ELEVENLABS_VOICE_ID`), and replace the project setting/add the emulator setting:

```dotenv
GOOGLE_CLOUD_PROJECT=demo-sponky-local
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
```

`GEMINI_MODEL` and `GEMINI_THINKING_LEVEL` are required environment settings with no code defaults. Existing local setups must add `GEMINI_THINKING_LEVEL=minimal` when switching to `gemini-3.5-flash-lite`. Production values live in `apphosting.yaml`; choose a thinking level supported by the selected model.

Start Firestore in one terminal (no Google credentials or cloud database required):

```sh
npx firebase emulators:start --only firestore --project demo-sponky-local
```

In another terminal, run `npm run dev` and open the local address it prints.
Transactions come from the checked-in `data/demo-transactions.json`; no CSV download, import or database seed is needed. Session changes survive browser reloads, but this emulator command does not preserve them across emulator restarts.
Interactive reasoning and voice use real Gemini/ElevenLabs APIs and may incur charges; the emulator replaces persistence only.

## Checks

The default checks use deterministic fixtures, not paid providers:

```sh
npm run check          # types, lint, unit tests and Python importer checks
npm run test:emulator  # isolated Firestore integration tests on port 8180
npx playwright install chromium  # once, if no supported browser is installed
npm run build
npm run test:e2e       # requires the build; starts its own test servers/emulator
```

See [demo acceptance and limitations](docs/demo-acceptance.md) for the demo link and rehearsal, and [data provenance](data/README.md) for the synthetic slice and simulated dates.

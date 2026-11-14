# Sponky

Sponky is a mobile financial coach for the S-Pankki challenge at Junction 2026. It spots patterns in your spending, explains the three baskets, checks savings goals against your history, and guides weekly check-ups. Speak to Sponky or choose a question from Ideas; confirm a goal to turn it into an everyday spending jar.

[Try the demo](https://sponky.web.app). The prototype uses one synthetic customer's transactions and has no live banking connection or ability to move money.

## Local setup

You need **Node.js 22**, **Java 21** (Firestore emulator), and API keys for **Gemini** and **ElevenLabs**. Python 3.11+ is needed for the checks.

```sh
git clone https://github.com/harmittaa/junction_2026.git
cd junction_2026
npm ci
cp .env.example .env.local
```

In `.env.local`, fill in `GEMINI_API_KEY` and `ELEVENLABS_API_KEY`. Generate a session secret with `openssl rand -hex 32` and paste the result into `SESSION_SECRET`. Keep the supplied model and voice settings; set these two values for local storage:

```dotenv
GOOGLE_CLOUD_PROJECT=demo-sponky-local
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
```

Start Firestore in one terminal (no Google credentials or cloud database required):

```sh
npx firebase emulators:start --only firestore --project demo-sponky-local
```

In a second terminal, from the repository root:

```sh
npm run dev
```

Open the localhost URL printed in the terminal. Choose **Talk to Sponky**, allow microphone access, then hold the ribbon to speak and release to send. **Ideas** offers questions you can tap instead.

Transactions are included; no import or database seed is needed. Session changes survive page reloads, but not emulator restarts with the command above. Conversation and voice use real provider APIs and may incur charges. Keep `.env.local` uncommitted.

## Checks

The default checks use deterministic fixtures, not paid providers:

```sh
npm run check          # types, lint, unit tests and Python importer checks
npm run test:emulator  # isolated Firestore integration tests on port 8180
npx playwright install chromium  # once, if no supported browser is installed
npm run build
npm run test:e2e       # requires the build; starts its own test servers/emulator
```

## License and data

Our code is licensed under [MIT](LICENSE). The project owner has confirmed permission to redistribute the supplied synthetic dataset; see [data provenance](data/README.md). Third-party materials retain their own licenses and terms.

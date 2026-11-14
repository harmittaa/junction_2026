# Offline audio fixtures

`question.wav` is synthetic English speech, not a person or a paid provider recording: “How much did I spend on groceries last month?” It is mono 48 kHz PCM for Chromium's fake microphone. `reply.mp3` encodes the same phrase solely to exercise browser decoding/playback; it is not the coach's factual reply.

Generated with Debian eSpeak NG and FFmpeg:

```sh
espeak-ng -s 145 -v en-us -w /tmp/question-raw.wav 'How much did I spend on groceries last month?'
ffmpeg -i /tmp/question-raw.wav -af 'adelay=700:all=1,apad=pad_dur=1' -ar 48000 -ac 1 tests/fixtures/question.wav
ffmpeg -i /tmp/question-raw.wav -ar 44100 -b:a 64k tests/fixtures/reply.mp3
```

Default browser tests intercept ElevenLabs HTTP/WebSocket traffic. Explicit live acceptance uses this prerecorded WAV against the real application transport. Neither proves physical microphone permission, speaker quality, interruption on a real phone, Safari autoplay or noisy-venue usability.

## Owner-supplied recreations, 14 November 2026

The original issue #10 audio binaries were unavailable. The owner recreated the same transcripts with macOS `say`: Samantha for English and Satu for Finnish, converted to mono 16 kHz signed 16-bit little-endian PCM WAV. These are synthetic recreations, **not the original benchmark recordings**. Files retain the unique names assigned by `amp files get`; originals were not edited.

| Supplied name | Repository file | Measured duration | SHA-256 |
| --- | --- | --- | --- |
| en.wav | `4256f8e6-en.wav` | 9.748625 s | `b7b633aec4eee9b96f7d6702c109725130bdcd1a4d8d489708b89dfec16bb988` |
| fi_en.wav | `1938a13a-fi_en.wav` | 8.422750 s | `7bcb0c1b336053414b5308b510af99ed88903df04430801039c2cc4454ccf062` |
| spending_en.wav | `da4f2408-spending_en.wav` | 2.701938 s | `ad7d89c9dca5e200531cbbc5f344d67aec4ef717a30d90569f9ff3e9c7eb1a17` |

Expected transcripts:

- **en:** Hello, this is a real-time speech transcription test. Today is Friday, and we are measuring how fast Gemini 3.5 Transcribe responds to live audio.
- **fi_en:** Moi! Haluaisin aloittaa uuden tavan joka aamu. Käyn kävelyllä kello kahdeksan. And if it rains, I will do ten minutes of stretching at home.
- **spending_en:** How much did I spend on groceries last month?

The first two are transcription checks, not banking requests. They must not create habits or check-ins. For exact comparison, normalize Unicode NFC, lowercase, replace punctuation/whitespace runs with one space, and trim. Preserve letters, accents and digits; do not forgive missing words or segments.

### Browser activation method and live result

Consulted [Chromium's media switches](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/base/media_switches.cc) and [Playwright browser network routing](https://playwright.dev/docs/api/class-browsercontext#browser-context-route-web-socket). Chromium converts WAV input to its audio bus; `%noloop` prevents repeating a sample. Use `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream` and `--use-file-for-fake-audio-capture=/absolute/path.wav%noloop`. Do not replace `getUserMedia` with a fake stream or use a direct WebSocket-only client as browser activation evidence.

For the mixed-language check, a disposable derivative added 6 seconds of leading silence for token/connection setup and 1 second of trailing silence, converted to 48 kHz mono PCM. This avoids truncating the start while the actual app establishes capture; the checked-in original stays unchanged:

```sh
ffmpeg -i tests/fixtures/1938a13a-fi_en.wav \
  -af 'adelay=6000:all=1,apad=pad_dur=1' -ar 48000 -ac 1 -c:a pcm_s16le fi-en-browser.wav
```

The final authorized live microphone session used the deployed HTTPS app, its actual **Tap to talk / Stop and send** controls, real `getUserMedia`, AudioWorklet PCM, the deployed token route and ElevenLabs `scribe_v3_live`. Observed: token HTTP 200; live audio track and nonzero level; 467,712 PCM bytes; one manual commit; final transcript only after commit; ended audio track after stop. Actual final text:

> Moi. Haluaisin aloittaa uuden tavan joka aamu. Käyn kävelyllä kello kahdeksan. And if it rains, I will do ten minutes of stretching at home.

Punctuation-normalized equality **passed**, retaining both languages. The harness intercepted the subsequent `/api/coach` request and returned an explicitly labeled test error, preventing Gemini/synthesis/mutations. The transcript remained in the enabled typing field and the saved session view was unchanged. This is live **transcription-only** evidence, not a banking interpretation of the benchmark text.

The other two supplied recreations were saved and their format/duration checked, but were **not sent to a live provider**: earlier acceptance had already used two microphone sessions for the eSpeak spending fixture. That earlier deployed spending journey covered real transcription, optional reveal, hidden invitation speech and revealed speech; it does not establish recognition of these exact new files. Total now: **3 live microphone sessions, 3 speech outputs including a reveal replay, 10 reasoning invocations**. The voice worker independently confirmed zero paid calls. No additional live calls are allowed under the current acceptance budget.

The deterministic browser test additionally waits for the 3.5-second MP3 to finish naturally before replay/interruption, checks nonzero playback energy and return to ready/zero level. Existing deterministic tests cover stop-before-capture, canceled/late transcripts and decoded audio, resource cleanup, failures and typing recovery. Default CI remains provider-free. Physical microphone permission/capture, audible speaker quality and real-device/Safari autoplay still require a human.

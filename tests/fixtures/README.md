# Offline audio fixtures

`question.wav` is synthetic English speech, not a person or a paid provider recording: “How much did I spend on groceries last month?” It is mono 48 kHz PCM for Chromium's fake microphone. `reply.mp3` encodes the same phrase solely to exercise browser decoding/playback; it is not the coach's factual reply.

Generated with Debian eSpeak NG and FFmpeg:

```sh
espeak-ng -s 145 -v en-us -w /tmp/question-raw.wav 'How much did I spend on groceries last month?'
ffmpeg -i /tmp/question-raw.wav -af 'adelay=700:all=1,apad=pad_dur=1' -ar 48000 -ac 1 tests/fixtures/question.wav
ffmpeg -i /tmp/question-raw.wav -ar 44100 -b:a 64k tests/fixtures/reply.mp3
```

Default browser tests intercept ElevenLabs HTTP/WebSocket traffic. Explicit live acceptance uses this prerecorded WAV against the real application transport. Neither proves physical microphone permission, speaker quality, interruption on a real phone, Safari autoplay or noisy-venue usability.

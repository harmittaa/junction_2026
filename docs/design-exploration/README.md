# Sponky design exploration

A static design prototype for issue #9. No build step. No dependencies.

## 1. View it

From the repo root:

```
python3 -m http.server 8000 --directory docs
```

Open `http://localhost:8000/design-exploration/`.

Why a server: the page loads `docs/design-tokens.json` with `fetch`. This does not work from `file://`.

Optional: a private Claude Artifact copy exists for review. It loads `design-tokens.json` from its own folder.

URL parameters: `scene=0..8`, `direct=1` (skip the guess), `theme=dark`, `w=360`, `only=phone|overview`.

## 2. What this is

A simulated design prototype. It uses scripted dialogue and invented data. It uses no microphone, no audio, no AI and no bank data. Coach states are simulated. It does not choose a production stack.

Revision note: this version follows the owner's decisions in issue #9 "Design revision" and issue #8 "Scope update". The first eight-state thread version is in git history (commit 66d1b8d).

## 3. Screens

- 9 live scenes: S-mobiili entry mock, ready, listening, thinking, speaking (guess invitation), guess, reveal, daily check-in, check-in complete.
- 7 variants: muted while speaking, "Speak instead", typing, microphone not available, talk about my day, coach unavailable, already completed today.
- 4 on-request parts: explore this, basket correction, what-if, keep an eye on it.
- The "All screens" overview is generated from the live phone.

## 4. Voice behavior shown

- Tap the coach to start. Tap again to stop and send. No press-and-hold. No always-on listening.
- Spoken replies always keep readable text on screen.
- Mute silences output only. It never opens the microphone.
- "Speak instead" is a proposed interruption control: playback stops first, then capture starts.
- Typing is an equal path in every coach screen.
- If the microphone is not available, the coach falls back to typing.

## 5. Motion rules

| State | Label | Motion | Static cue |
| --- | --- | --- | --- |
| Ready | Ready / Tap to talk | none | no ring |
| Listening | Listening… / Stop and send | ring pulses, ribbons change height irregularly (simulated level) | solid ring |
| Thinking | Thinking… | highlight travels along the ribbons | dashed ring |
| Speaking | Speaking… / Speak instead | ribbons sway sideways | double ring |
| Celebrate | Check-in complete | one turn, about 600 ms | accent ring |

- No animation hints at an unrevealed answer, at money saved, or at microphone activity when capture is off.
- With reduced motion, all animation stops. Rings and labels stay.
- The ribbon is an original abstract motif. It is not the bank logo.

## 6. Token and accessibility exceptions

`docs/style-guide.md` and `docs/design-tokens.json` were not edited. The page builds its CSS variables from the JSON at load.

Derived variables, defined in CSS from tokens only:

1. `--fill-action`: light uses `primaryPressed` (white text 5.58). Dark uses `primary` with `onPrimary` (7.07). Reason: light `onPrimary` on `primary` is 3.07, too low for 16 px text. Used for primary buttons, the user bubble, and now also the coach ribbon and rings. Reason for the ribbon: light `primary` on `greenMintSoft` is 2.72, below 3:1.
2. `--basket-everyday-text`: light uses `status.warningText`. The everyday basket color on its background is 2.73 in light mode.
3. `primary` is used only for non-text marks in light mode (slider accent, bar fill, logo dot): 3.07 on `surface`.

Measured WCAG ratios:

- Light onPrimary on primary: 3.07. White on primaryPressed: 5.58. Dark onPrimary on primary: 7.07.
- Light basket labels: regular 9.99, unexpected 5.18, everyday 2.73 (replaced by warningText: 5.57).
- Dark basket labels: 9.82, 9.09, 10.30.
- textMuted on surfaces: 5.21–5.74 light, 5.96–7.47 dark.
- Dark `borderStrong` on `surface` is 2.51. Input borders are below 3:1 in dark mode. Open issue, not changed.

New pairings in this revision:

- Light: `textBrand` on `greenTintSubtle` (screen) 5.37; on `surface` 5.58; on `greenMintSoft` 4.95. `textMuted` on `greenTintSubtle` 5.53. `greenDeepest` on `greenMintSoft` 9.77. `infoText` on `infoBg` 5.18.
- Dark: `textBrand` on `background` 11.55; on `surface` 10.45. `primary` on `surfaceAccent` 6.74. `textMuted` on `background` 7.47. `infoText` on `infoBg` 9.09.
- Celebrate ring (`accentPlayful`) is 1.55 on the light screen. It is a decoration. The text label "Check-in complete" carries the meaning.
- The mint card border (`greenBorderWeak`, 1.63) is decoration only.

Other notes: focus ring uses `borderFocus`. Touch targets are 48 px. Every color has a text label. Sliders are native range inputs with `accent-color`. The font is a system fallback stack.

## 7. Not validated

Issue #10 measured speech-to-text only: first partial about 711–782 ms, tail about 172–242 ms, on two short samples. These are open implementation checks, not claims:

- full spoken-reply latency
- output voice quality
- interruption behavior
- noisy-venue use

No provider is selected.

## 8. Decisions for the owner

1. Ribbon shape and motion are a proposal, not final, and not the bank logo.
2. Confirm "Speak instead" as the interruption control.
3. Where History opens.
4. Streak start and missed-day rule.
5. Guess range and start value.
6. Should the shared style guide adopt `primaryPressed` for text-bearing green fills in light mode?

## 9. Known limits

- Not wired: History, tab bar and S-mobiili cards (except Sponky), typing Send, "Keep as it is".
- The thinking scene has no tap control. Use Next in the review panel.
- Variants and on-request frames are static.
- Free text is not interpreted. Sound toggle changes only the label.
- Exports were made with headless Chrome.

## 10. Exports

Files in `exports/`: `screens-overview.png`, `ready-light-390.png`, `reveal-dark-390.png`, `checkin-complete-light-360.png`.

Command (server running on port 8000):

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --virtual-time-budget=8000 --window-size=W,H --screenshot=docs/design-exploration/exports/NAME.png "http://localhost:8000/design-exploration/?QUERY"
```

- `screens-overview`: 1680,5700, `only=overview`
- `ready-light-390`: 500,900, `only=phone&scene=1`
- `reveal-dark-390`: 500,900, `only=phone&scene=6&theme=dark`
- `checkin-complete-light-360`: 500,900, `only=phone&scene=8&w=360`

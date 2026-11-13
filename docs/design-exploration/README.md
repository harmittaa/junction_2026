# Sponky design exploration

A static design prototype for issue #9. No build step. No dependencies.

## 1. View it

From the repo root:

```
python3 -m http.server 8000 --directory docs
```

Open `http://localhost:8000/design-exploration/`.

Why a server: the page loads `docs/design-tokens.json` with `fetch`. This does not work from `file://`.

URL parameters:

- `beat=1..12` starts at that beat.
- `flags=direct|left|declined` sets route flags (comma separated).
- `theme=dark` uses the dark theme.
- `w=360` sets the phone width (default 390).
- `only=phone` shows only the phone. `only=overview` shows everything except the prototype section.

Optional: a private Claude Artifact copy of this page exists. It is for review only. The page also loads `design-tokens.json` from its own folder there.

Print the page from the browser for a paper overview. The prototype section is hidden in print.

## 2. What this is / is not

- It is a design prototype with scripted dialogue and invented fixtures.
- It is not AI. It does not read bank data. Free text is not interpreted.
- It does not choose a production stack.

## 3. Recommended direction

**A · Conversation-led, with one borrowed accent.** It uses one card pattern for all eight states. It needs fewer taps, so the demo fits about 90 seconds. Evidence and corrections stay in the thread. It stays calm for all ages and fits a banking app. Borrowed from B: the large actual amount and the playful green highlight on key numbers. Not borrowed: tap-through story steps.

## 4. Flow and timing

Seconds are planning estimates. They are not measured.

| Beat | State | Content | Seconds |
| --- | --- | --- | --- |
| 1 | 1 | Conversation entry | 6 |
| 2 | 2 | Optional guessing invitation | 4 |
| 3 | 3 | Guess | 8 |
| 4 | 4 | Reveal and evidence | 13 |
| 5 | 5 | Understand: three baskets | 9 |
| 6 | 5 | Correct one purchase | 8 |
| 7 | 5 | Effect of the correction | 6 |
| 8 | 6 | What-if | 11 |
| 9 | 7 | Choose a daily habit | 9 |
| 10 | 7 | Habit outcome | 3 |
| 11 | 8 | Return: daily check-in | 8 |
| 12 | 8 | Check-in complete | 5 |
| | | Total | 90 |

Routes: direct answer ("Show the amount"), leave the game, decline the habit.

## 5. Token and accessibility exceptions

`docs/style-guide.md` and `docs/design-tokens.json` were not edited. The page builds its CSS variables from the JSON at load.

Three derived variables, defined in CSS from tokens only:

1. `--fill-action`: light uses `primaryPressed` (white text 5.58). Dark uses `primary` with `onPrimary` (7.07). Reason: light `onPrimary` on `primary` is 3.07, too low for 16 px text. Used for primary buttons and the user bubble.
2. `--basket-everyday-text`: light uses `status.warningText`. Reason: the everyday basket color on its background is 2.73 in light mode. Amber is kept for non-text marks (bar segment) next to a text label.
3. `primary` is used only for non-text marks in light mode (slider accent, progress, logo dot): 3.07 on `surface`.

Measured WCAG ratios:

- Light onPrimary on primary: 3.07. White on primaryPressed: 5.58. Dark onPrimary on primary: 7.07.
- Light basket labels: regular 9.99, unexpected 5.18, everyday 2.73 (replaced by warningText: 5.57).
- Dark basket labels: 9.82, 9.09, 10.30.
- textMuted on surfaces: 5.21–5.74 light, 5.96–7.47 dark.
- Light non-text marks: primary 3.07, everyday amber 3.04 on `surface`.
- Dark `borderStrong` on `surface` is 2.51. Input borders are below 3:1 in dark mode. Open issue, not changed.

Other notes:

- The story card uses the CSS keyword `white` for text. No token is white in both themes.
- Focus ring uses `borderFocus`. Touch targets are 48 px.
- Every color has a text label. Reduced motion is respected.
- Sliders are native range inputs with `accent-color`. Production should style a larger thumb.
- The font is a system fallback stack.

## 6. Reusable components

Conversation shell (app bar, thread, composer), coach and user bubbles, chips, card, source chip, basket chip, breakdown bar and legend, guess card, reveal card, correction card, what-if card, habit card, check-in card, completion card, status and record lines.

## 7. Decisions for the owner

1. Confirm direction A.
2. Guess range and start value rule.
3. Streak start (proposal: first completed check-in = day 1) and missed-day behaviour (undecided; no points are shown).
4. What "Daily check-in" does when no habit is tracked (after a decline).
5. Goal: is a target amount needed, and is progress self-reported only?
6. Should the shared style guide adopt `primaryPressed` for text-bearing green fills in light mode?

## 8. Known limits

- Not wired: "Keep as it is", "Keep my plan", "Change my action". The variant frames are static.
- Free text is not interpreted.
- The "Daily check-in" starter jumps to beat 11 and shows earlier messages too.
- Exports were made with headless Chrome.

## 9. Exports

Files in `exports/`: `storyboard-overview.png`, `reveal-light-390.png`, `correction-dark-390.png`, `checkin-light-360.png`.

Commands (server running on port 8000; replace `W,H` and `NAME`):

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --virtual-time-budget=4000 --window-size=W,H --screenshot=docs/design-exploration/exports/NAME.png "http://localhost:8000/design-exploration/?QUERY"
```

- `storyboard-overview`: 1680,6530, `only=overview`
- `reveal-light-390`: 500,900, `only=phone&beat=4`
- `correction-dark-390`: 500,900, `only=phone&beat=6&theme=dark`
- `checkin-light-360`: 500,900, `only=phone&beat=11&w=360`

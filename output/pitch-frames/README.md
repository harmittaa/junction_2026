# Sponky pitch frames

Eight approved 16:9 storyboard frames for a 1:55 pitch. Sponky leads the story:
notices → explains → checks → guides → celebrates.

Open `index.html` in a browser to review the frames, sample narration, timing,
judging criteria and implementation caveats. These are UI illustrations, not
recordings of the integrated application. Verify them against the final app
before submission.

## Files

- `build.py`: editable copy, layout and review-page source; reads `docs/design-tokens.json`.
- `frames.html`: eight 1920 × 1080 artboards.
- `frames.json`: narration, timing and review notes.
- `clean/` and `captioned/`: exported PNGs without and with sample subtitles.
- `sponky-pitch-deck.pdf`: eight clean slides.
- `contact.html` and `contact-sheet.png`: overview.
- `sponky-pitch-frames.zip`: current review/export bundle.
- `sponky-pitch-frames-v1.zip`: earlier copy before the Sponky-led revision.

## Editing

Edit `build.py`, then run from the repository root:

```sh
python3 output/pitch-frames/build.py
python3 -m http.server 8770 --bind 127.0.0.1 --directory output/pitch-frames
```

Review `http://127.0.0.1:8770/frames.html`. The builder updates HTML and JSON;
PNG, PDF and ZIP exports must be refreshed separately after edits.

For browser exports, set a 1920 × 1080 viewport. Capture each `.slide` element
to `clean/<slide-id>.png`, scrolling it into view and waiting for painting
before each capture. Print the clean page to PDF with backgrounds enabled and
the CSS page size. Add the `captions` class to `body` and capture the slides
again into `captioned/`. Capture `contact.html` at 1600 pixels wide after its
images load. Rebuild the current ZIP with both PNG directories, `index.html`,
`frames.json`, the PDF and contact-sheet PNG.

Before committing updated exports, inspect the overview and subtitles, verify
all 16 PNGs are 1920 × 1080, check the PDF has eight pages, and open the gallery
at phone width. Keep source and exports together in the same commit.

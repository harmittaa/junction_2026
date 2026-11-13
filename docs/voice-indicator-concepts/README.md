# Sponky Voice-Reactive Indicator Concepts

This folder contains the brand reference designs for the Sponky voice indicator.
All assets follow the S-Pankki Design System tokens and the Sponky UI Style Guide.

---

## 1. File Inventory

| Path | Format | Dimensions | Description |
| :--- | :--- | :--- | :--- |
| `svgs/s-ribbon-states.svg` | SVG | 1000 × 260 | Concept A: S-Ribbon Wave states strip |
| `svgs/capsule-buddy-states.svg` | SVG | 1000 × 260 | Concept B: Capsule Face (Aulis) states strip |
| `svgs/signal-arcs-states.svg` | SVG | 1000 × 260 | Concept C: Basket Signal Arcs states strip |
| `renders/concept-comparison-sheet.png` | PNG (2x) | 2800 × 2240 | Complete concept comparison reference sheet |
| `renders/mobile-in-context-light-dark.png` | PNG (2x) | 2880 × 2000 | Four 390px mobile frames in Light and Dark mode |
| `sheet-concepts.html` | HTML | 1400 × 1120 | Standalone source page for concept comparison |
| `sheet-mobile.html` | HTML | 1440 × 1000 | Standalone source page for mobile viewports |

---

## 2. Concept Overview

### Concept A: S-Ribbon Wave (Primary Brand Recommendation)
- **Geometry:** Uses the official S-Pankki two-band S-mark from `s-logo.svg`.
- **Idle:** Crisp static S-mark inside `#EBF7EC` circular dock.
- **Listening:** Expanded mint halo (`#91FA9B`) and widened green ribbons.
- **Thinking:** Staggered opacity phase across the two ribbon bands with orbiting pulse beads.
- **Speaking:** Dual ribbon bands undulate into harmonic S-wave crests with concentric echo rings.
- **Reduced Motion:** High-contrast static border (`#00AA46`) with static badge `LISTENING`.

### Concept B: Capsule Face (Aulis-Inspired Buddy)
- **Geometry:** Uses the rounded capsule head geometry from `aulis.svg` (`#004628` strokes on `#91FA9B` fill).
- **Idle:** Calm capsule face with soft resting smile.
- **Listening:** Raised eyebrows showing attentive curiosity and soft mint aura.
- **Thinking:** Tilted pondering eyebrows and three cadence dots inside mouth area.
- **Speaking:** Mouth opens into a dual-arc smile wave (`Speaking • Wave`) with speech ripple brackets.
- **Reduced Motion:** Static capsule face with high-contrast badge `SPONKY • READY`.

### Concept C: Basket Signal Arcs + Open Speech Frame
- **Geometry:** Three concentric signal arcs mapped to the Three Spending Baskets.
- **Idle:** Compact mic dock with resting three-arc motif.
- **Listening:** Arcs expand outward inside S-Pankki's Per Tieeri open-top speech frame.
- **Thinking:** Arcs rotate in a tri-color cadence ring.
- **Speaking:** Stereo wave pulses emit in the three basket colors (`#004628`, `#006E87`, `#CF8300`).
- **Reduced Motion:** Static three-basket arcs with status pill `3 BASKETS • ACTIVE`.

---

## 3. Design Tokens Reference

All colors and measurements match `docs/design-tokens.json` and `docs/style-guide.md`.

### Brand Colors
- `brand.greenPrimary`: `#00AA46` (Primary CTA buttons, active accents)
- `brand.greenStrong`: `#007841` (Accessible text on light surfaces)
- `brand.greenDeepest`: `#004628` (High-emphasis headers, S-ribbon fill)
- `brand.greenBright`: `#00EB5A` (Playful highlights, dark mode accents)
- `brand.greenMint`: `#91FA9B` (Active voice halo and speaking dock)
- `brand.greenTint`: `#EBF7EC` (Light mode coach surface)

### The Three Spending Baskets
- **Mandatory Regular:** `#004628` (light) / `#6EE7A0` (dark)
- **Mandatory Irregular:** `#006E87` (light) / `#67D5EB` (dark)
- **Everyday Slipping:** `#CF8300` (light) / `#FFCA6B` (dark)

### Radii and Typography
- **Card Radius:** `16px` (`radius.lg`)
- **Pill Radius:** `9999px` (`radius.pill`)
- **Body & Headings:** `Inter`, system fallback geometric sans-serif
- **Currency Format:** `tabular-nums` with European spaces and comma (e.g. `60,00 €`, `1 234,56 €`)

---

## 4. Motion Specification

All transitions follow S-Pankki motion design system values (`--sds-motion-*`).

### Spring Curves
```css
--sds-motion-easing-spring-gentle: cubic-bezier(0.34, 1.3, 0.64, 1);
/* Flutter / React Native Spring Params */
damping: 40;
mass: 1;
stiffness: 700;
```

### Exact S-Pankki Durations
```css
--sds-motion-duration-fast: 100ms, 150ms, 200ms;
--sds-motion-duration-medium: 250ms, 300ms, 500ms;
```

---

## 5. State Machine & Implementation Guide

### State Machine Flow
```
[ IDLE ]  <====>  [ LISTENING ]  ====>  [ THINKING ]  ====>  [ SPEAKING ]
   ^                                                              |
   +--------------------------------------------------------------+
```

### SVG Group Targets
Each SVG file defines clean group identifiers:
- `<g id="state-idle">`
- `<g id="state-listening">`
- `<g id="state-thinking">`
- `<g id="state-speaking">`
- `<g id="state-reduced-motion">`

### How to Animate with CSS
```css
/* Listening halo expansion */
@keyframes sds-halo-pulse {
  0% { transform: scale(1); opacity: 0.45; }
  50% { transform: scale(1.12); opacity: 0.8; }
  100% { transform: scale(1); opacity: 0.45; }
}

/* Speaking wave undulation */
@keyframes sds-wave-ripple {
  0% { transform: scale(0.95); opacity: 0.9; }
  100% { transform: scale(1.25); opacity: 0.0; }
}

/* Reduced motion accessibility */
@media (prefers-reduced-motion: reduce) {
  * {
    animation: none !important;
    transition: none !important;
  }
  #state-idle, #state-listening, #state-thinking, #state-speaking {
    display: none !important;
  }
  #state-reduced-motion {
    display: block !important;
  }
}
```

# Sponky Voice-Reactive Indicator — S-Ribbon Reference

This folder contains the brand reference designs for the Sponky voice indicator.
All assets follow the S-Pankki Design System tokens and the Sponky UI Style Guide.

The Sponky voice UI exclusively uses the official **S-Ribbon** indicator.
It uses the S-Pankki dual-ribbon curve from `s-logo.svg`.

---

## 1. File Inventory

| Path | Format | Dimensions | Description |
| :--- | :--- | :--- | :--- |
| `svgs/s-ribbon-states.svg` | SVG | 1000 × 260 | S-Ribbon Wave vector states strip |
| `renders/s-ribbon-spec-sheet.png` | PNG (2x) | 2800 × 1440 | Brand reference specification sheet |
| `renders/mobile-in-context-light-dark.png` | PNG (2x) | 2880 × 2000 | Four 390px mobile frames in Light and Dark mode |
| `sheet-concepts.html` | HTML | 1400 × 720 | Standalone source page for S-Ribbon reference |
| `sheet-mobile.html` | HTML | 1440 × 1000 | Standalone source page for mobile viewports |

---

## 2. S-Ribbon State Specifications

The S-Ribbon indicator represents all voice interactions across five distinct states:

### 1. IDLE (Standby)
- Crisp static S-Pankki S-ribbon mark (`fill="#004628"`).
- Circular dock with soft mint surface (`fill="#EBF7EC"`, `stroke="#00AA46"`).
- Zero audio input (0 dB).

### 2. LISTENING (Mic Active)
- Gentle expanded mint halo ring (`#91FA9B` with outer `#00EB5A` aura).
- Active dock surface (`fill="#91FA9B"`).
- Widened parallel green ribbon bands showing microphone engagement.

### 3. THINKING (Processing)
- Staggered opacity phase across the two parallel ribbon bands.
- Traveling cadence beads orbit the ribbon at a gentle velocity.
- Surface transitions to calm `#EBF7EC` with `#007841` border.

### 4. SPEAKING (Audio Active)
- Dual ribbon bands undulate into harmonic symmetric S-wave crests.
- Concentric mint audio echo ripples radiate outward from the dock.
- Surface transitions to active green with deep forest green stroke.

### 5. REDUCED MOTION (Accessibility)
- Conforms to `@media (prefers-reduced-motion: reduce)`.
- Zero animation or movement.
- High-contrast static border (`#00AA46` 3px).
- Clear text pill badge: `LISTENING` / `SPEAKING`.

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

### Semantic Dark Mode Surfaces
- `dark.background`: `#0F1411`
- `dark.surface`: `#171F1A`
- `dark.surfaceAccent`: `#142B1D`
- `dark.primary`: `#00C853`

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
`svgs/s-ribbon-states.svg` defines clean group identifiers:
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

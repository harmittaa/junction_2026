# Sponky UI Style Guide

**Sponky** is the S-Pankki Personal Economic Trainer app for Junction 2026.  
This guide is the single source of truth for colors, typography, spacing, rounded corners, and core UI components.

> **Machine-readable tokens:** Always import or reference [`docs/design-tokens.json`](./design-tokens.json) rather than inventing hex codes or magic numbers.

---

## 1. Agent Quick Rules

1. **Use tokens, never raw hexes:** Map your theme directly to `docs/design-tokens.json`.
2. **Respect "Green + Rounded Corners":** S-Pankki's core visual signature is crisp white/dark surfaces, S-Green (`#00AA46`) actions, and generous rounded corners (`16px` cards, `9999px` pill buttons).
3. **Support Light and Dark mode:** Both `light` and `dark` token sets are defined in `design-tokens.json`.
4. **Keep tone encouraging, never punitive:** Avoid harsh red (`#B70000`) for spending insights or overspending nudges. Reserve error red strictly for system/validation failures. Use warm amber (`#CF8300`) or info teal (`#006E87`) for spending awareness.
5. **Format currency consistently:** Use European/Finnish spacing and comma decimals with tabular numbers (`font-variant-numeric: tabular-nums`), e.g., `1 234,56 €` or `42,50 €`.
6. **Minimum touch target:** All interactive elements (buttons, chips, sliders) must be at least `48 × 48` dp/px.

---

## 2. Visual Identity & Tone

- **Core:** Clean, trustworthy Finnish retail banking modeled on `s-pankki.fi` (`--sds-*` design system). High contrast, generous whitespace, calm hierarchy.
- **Playful Accent Layer (Young Adults):** Bright S-Green (`#00EB5A`) and mint (`#91FA9B` / `#D2FCD5`) reserved for gamification: savings goal progress bars, streak badges, "What-If" simulation highlights, and interactive "Guess First" discovery sliders.

---

## 3. Color System

### Brand Greens (Shared Reference)

| Token | Hex | Usage |
| :--- | :--- | :--- |
| `brand.greenPrimary` | `#00AA46` | Primary CTA buttons (light), active icons, brand badges |
| `brand.greenStrong` | `#007841` | Accessible green text & links on light backgrounds |
| `brand.greenDeepest` | `#004628` | High-emphasis dark green headers, text on bright mint |
| `brand.greenBright` | `#00EB5A` | Playful highlight: progress fills, streaks, dark-mode brand text |
| `brand.greenTint` | `#EBF7EC` | Soft green card/chip background (light mode) |
| `brand.greenTintSubtle` | `#F7FCF7` | Subtle hero or AI coach surface tint (light mode) |

### Semantic Surfaces & Text

| Role | Light Mode | Dark Mode |
| :--- | :--- | :--- |
| `background` (Screen) | `#FAFAFA` | `#0F1411` |
| `surface` (Cards, Sheets) | `#FFFFFF` | `#171F1A` |
| `surfaceSubtle` (Inputs, Wells) | `#F5F5F5` | `#1F2A23` |
| `surfaceAccent` (Coach / Tip) | `#EBF7EC` | `#142B1D` |
| `textPrimary` | `#1F1F1F` | `#F4F7F5` |
| `textSecondary` | `#363636` | `#D0DBD4` |
| `textMuted` | `#666666` | `#98A89E` |
| `border` | `#E6E6E6` | `#2B3A31` |
| `primary` (Button Fill) | `#00AA46` | `#00C853` |
| `onPrimary` (Button Text) | `#FFFFFF` | `#002914` |

### Domain Colors: The Three Spending Baskets

Use these consistent colors across charts, category pills, and AI explanations:

| Basket | Examples | Light Color / Bg | Dark Color / Bg |
| :--- | :--- | :--- | :--- |
| **Mandatory & Regular** | Rent, electricity, phone bill | `#004628` on `#EBF7EC` | `#6EE7A0` on `#102B1C` |
| **Mandatory & Irregular** | Broken appliance, dentist | `#006E87` on `#E0F4FF` | `#67D5EB` on `#0F2730` |
| **Everyday Slipping** | Coffee, taxis, dining out | `#CF8300` on `#FFF1D8` | `#FFCA6B` on `#2E220D` |

### Status Colors

- **Success:** `#007841` text / `#EBF7EC` bg (light) | `#6EE7A0` text / `#102B1C` bg (dark)
- **Info / Assumption Prompt:** `#006E87` text / `#E0F4FF` bg (light) | `#67D5EB` text / `#0F2730` bg (dark)
- **Warning / Nudge:** `#885600` text / `#FFF1D8` bg (light) | `#FFCA6B` text / `#2E220D` bg (dark)
- **Error (System Only):** `#B70000` text / `#FFEDED` bg (light) | `#FF8A8A` text / `#331212` bg (dark)

---

## 4. Typography

S-Pankki uses **S Bonus Display** for headings and **S Bonus UX** for UI body text. In Flutter/React Native prototypes without licensed font files, use `Inter` or system geometric sans-serif (`SF Pro` on iOS, `Roboto` on Android).

| Token | Size (px/dp) | Line Height | Weight | Usage |
| :--- | :--- | :--- | :--- | :--- |
| `displaySmall` | `34` | `40` | `700` | Hero balance / Safe-to-spend number |
| `headingLarge` | `27` | `34` | `700` | Screen titles |
| `headingMedium` | `22` | `28` | `600` | Section headers, card titles |
| `headingSmall` | `18` | `24` | `600` | Subheadings, modal titles |
| `bodyLarge` | `18` | `26` | `400` | Highlighted AI insights |
| `bodyMedium` | `16` | `24` | `400` | Default chat & body text |
| `bodySmall` | `14` | `20` | `400` | Secondary labels, helper text |
| `caption` | `11` | `16` | `500` | Data source badges, timestamps |

---

## 5. Spacing, Layout & Rounded Corners

- **Base Grid:** `4px` / `8px` increments (`4, 8, 12, 16, 20, 24, 32, 48`).
- **Screen Horizontal Padding:** `16px` (or `20px` on larger phones).
- **Card Padding:** `16px` internal padding, `12px`–`16px` vertical gap between cards.
- **Border Radii:**
  - **Pill (`9999px`):** Primary & secondary CTA buttons, filter chips, goal badges, chat quick-reply suggestions.
  - **Large (`16px`):** Standard cards, chat bubbles, insight containers.
  - **Extra Large (`24px`):** Bottom sheets, modal dialogs, hero summary cards.
  - **Medium (`12px`):** Text inputs, dropdowns, nested mini-cards.
- **Borders vs. Shadows:** Prefer flat cards with a `1px` `border` (`#E6E6E6` light / `#2B3A31` dark) over heavy drop shadows. Reserve soft elevation only for floating chat composers and bottom navigation.

---

## 6. Core Sponky Components

1. **AI Coach Chat Bubble:**
   - Surface: `surfaceAccent` (`#EBF7EC` light / `#142B1D` dark), `16px` radius (with `4px` top-left corner for chat tail feel).
   - Must include a subtle `caption` chip when citing calculations (e.g., `"Based on 14 transactions • Verify assumptions"`).
2. **User Chat Bubble:**
   - Surface: `primary` (`#00AA46`) with `onPrimary` (`#FFFFFF`) text, `16px` radius (`4px` bottom-right).
3. **"Guess First" Discovery Card (Hypercorrection Mechanic):**
   - Clean `surface` card with `16px` radius, interactive green slider (`#00AA46` track), large tabular euro readout, and a pill CTA `"Lock in my guess"` before revealing actual transaction data.
4. **Three Baskets Breakdown Bar:**
   - Segmented horizontal pill bar (`12px` height, `9999px` radius) using the three basket colors, paired with tappable legend rows.
5. **Goal / Joint Account Progress Pill:**
   - Track: `surfaceSubtle`, Fill: `accentPlayful` (`#00EB5A`), text in `greenDeepest` (`#004628`) or `textPrimary`. Used for personal or shared savings targets (e.g., `"Apartment Down Payment • 64%"`).

---

## 7. Framework Implementation Starters

### Flutter (`ThemeData` Mapping)

```dart
// Load values from docs/design-tokens.json
final lightColorScheme = ColorScheme.light(
  primary: const Color(0xFF00AA46),
  onPrimary: const Color(0xFFFFFFFF),
  secondary: const Color(0xFF00EB5A),
  onSecondary: const Color(0xFF004628),
  surface: const Color(0xFFFFFFFF),
  onSurface: const Color(0xFF1F1F1F),
  outline: const Color(0xFFE6E6E6),
  error: const Color(0xFFB70000),
);

final darkColorScheme = ColorScheme.dark(
  primary: const Color(0xFF00C853),
  onPrimary: const Color(0xFF002914),
  secondary: const Color(0xFF00EB5A),
  onSecondary: const Color(0xFF002914),
  surface: const Color(0xFF171F1A),
  onSurface: const Color(0xFFF4F7F5),
  outline: const Color(0xFF2B3A31),
  error: const Color(0xFFFF8A8A),
);

// Pill button shape: StadiumBorder()
// Card shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))
```

### React Native (`theme.ts` Mapping)

```ts
import tokens from '../docs/design-tokens.json';

export const getTheme = (mode: 'light' | 'dark') => ({
  colors: tokens.color[mode],
  brand: tokens.color.brand,
  spacing: tokens.spacing,
  radius: tokens.radius,
  typography: tokens.typography,
  layout: tokens.layout,
});
```

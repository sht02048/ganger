# Ganger brand guide

This folder holds the source artwork for the Ganger brand and the rules for using it. Read this page before you place the mark, the mascot, the wordmark, or the brand colors anywhere: in the app, on the web, in the desktop app, or in docs.

Some rules also live elsewhere, and this page links to them instead of repeating them:

- Status colors and app-wide visual rules: [ADR 0010](../../../docs/adr/0010-ui-words-and-visual-rules.md), rules 5 (colors) and 11 (rail).
- Brand components and their props: [`DESIGN.md`, brand artwork section](../DESIGN.md#브랜드-그림티켓-0077).
- Color values the app uses: [`src/tokens.stylex.ts`](../src/tokens.stylex.ts).

## Two symbols, two jobs

Ganger has two symbols. Each one has its own places, and they do not swap.

| Symbol                   | What it is                                                                                   | Where it goes                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **The whistle** (mark)   | A round body with a hole and a rounded mouthpiece. The yellow mouthpiece is the only detail. | Places that point at "this product": app icon, favicon, top of the rail, menu bar (tray) icon, next to the wordmark.                   |
| **The foreman** (mascot) | A white round body under a yellow-brimmed cap. Only the eyes change.                         | Empty states, loading, 404, disconnected screens, onboarding, and the root README header (added with the product rename, ticket 0078). |

The mascot has four moods:

| Mood      | Face                   | Where                                  |
| --------- | ---------------------- | -------------------------------------- |
| `default` | Wink                   | Onboarding first screen, README header |
| `signal`  | Whistle in mouth       | First app load                         |
| `resting` | Eyes closed with a "z" | Empty states                           |
| `worried` | Eyebrows               | 404, disconnected                      |

In the app the mascot is always decorative and hidden from screen readers. The text next to it carries the meaning.

## Colors

The brand has three colors.

| Name          | Value                  | Role                      |
| ------------- | ---------------------- | ------------------------- |
| Ink           | `oklch(0.14 0 0)`      | Background, dark surfaces |
| Paper         | `oklch(0.97 0.003 85)` | Text, light surfaces      |
| Ganger Yellow | `oklch(0.84 0.15 75)`  | Accent                    |

How the app uses them (ticket 0080):

- Backgrounds and surfaces are Ink with only the lightness changed (`colors.bg*`, `colors.border*`): raised surfaces are lighter, insets and the backdrop are darker. The selected surface (`colors.bgSelected`) is neutral too; yellow marks emphasis, not selection.
- Text is Paper, with only the lightness lowered for secondary text (`colors.text*`).
- Ganger Yellow is the one accent (`colors.accent*`): the primary button, links, the selected tab and rail item, the focus ring, the whistle's mouthpiece, and the mascot's cap.
- Text on yellow is Ink (`colors.textOnAccent`).
- Yellow is never a status color. Statuses have their own colors, and Human Check is teal. See ADR 0010 rule 5 for the full status table.

In app code, use the tokens above and never a literal color. The SVG files in this folder carry their own sRGB hex fills because icon and image tools need them. When you redraw artwork, take the colors from the table above.

## Wordmark

- `ganger`, all lowercase.
- Manrope ExtraBold, letter spacing −4%.
- Shipped as outlined paths ([`wordmark.svg`](wordmark.svg)), so it renders without the font installed.
- Manrope is licensed under the SIL Open Font License. Keep [`OFL-Manrope.txt`](OFL-Manrope.txt) next to the artwork.
- The wordmark is a logo, not a UI font. App text stays in Pretendard.

## Lockups, clear space, and minimum size

- **Horizontal lockup** ([`logo-horizontal.svg`](logo-horizontal.svg)): the mark to the left of the wordmark. Use it in wide places such as headers.
- **Vertical lockup** ([`logo-vertical.svg`](logo-vertical.svg)): the mark above the wordmark. Use it in square or centered places.
- **Clear space**: keep at least one mouthpiece of empty space around the mark on every side. The mouthpiece is the small yellow rounded rectangle.
- **Minimum size**: the mark alone goes down to 16px. At 16 and 32px (favicon, tray) use the dedicated small version ([`mark-favicon.svg`](mark-favicon.svg)), which has a larger body and a larger mouthpiece. A lockup goes down to 20px tall.

## Don't

- Don't use the mascot as the app icon or favicon. Those belong to the whistle.
- Don't add shadows, glow, highlights, or gradients to the mark or the app icon. macOS 26 applies its own glass effect to app icons.
- Don't give the mascot arms, legs, or clothes. Only the eyes change.
- Don't put the mascot in list rows, next to status pills or buttons, or inside a runner issue card. It keeps status screens from looking playful.
- Don't use Ganger Yellow as a status color.

## App icon

- **Source**: [`app-icon.svg`](app-icon.svg), a 1024 × 1024 square with no rounded corners. It has a background layer and the mark's layers (body and mouthpiece). macOS and iOS draw the corners, and macOS draws the glass.
- **Outputs**: `pnpm --filter @ganger/desktop brand-assets` builds every derived file from this folder:
  - `apps/desktop/icons/AppIcon.icon`, an Icon Composer document for macOS 26 and later.
  - `apps/desktop/icons/icon.icns`, ten PNGs from 16 to 512@2x with the squircle drawn in, for macOS 15 and earlier.
  - `apps/desktop/assets/trayTemplate.png` and `@2x`, the menu bar icon as a black template image on a transparent background.
  - `apps/web/public/favicon.ico` (16 and 32), `icon.svg`, and `apple-touch-icon.png` (180, opaque).
  - `apps/mobile/assets/icon.png`, `icon-dark.png`, and `icon-tinted.png`, the iOS app icon for `ios.icon` in `apps/mobile/app.json`. All three are 1024 × 1024 squares; iOS draws the corners. `icon.png` is the source as is, opaque (no alpha channel), as the App Store requires. `icon-dark.png` is the mark's layers in full color on a transparent background, so iOS 18 and later put their own dark background behind it. `icon-tinted.png` is the mark in one color (Paper, like [`mark-mono.svg`](mark-mono.svg)) on the source's background, opaque, so the tinted appearance has a single shape to tint.
- **Packaging**: `pnpm --filter @ganger/desktop package` passes both `.icns` and `.icon` when Xcode 26 or later (`actool` 26+) is installed. Without it, the app ships with `.icns` only, and packaging still works.

Don't edit the derived files by hand. Change the source in this folder and run the script again.

## dmg install window

- **Source**: [`dmg/background.svg`](dmg/background.svg), 540 × 380, the content area of the window the dmg opens. Paper background, the full-color whistle (Ink body, yellow mouthpiece) at the top, a dark yellow arrow (`oklch(0.62 0.15 70)`, `#be7200`, 3.4:1 on Paper) between the app (left) and Applications (right), and one Ink line, "Drag Ganger to Applications". The background is light because Finder draws the icon names dark on a light picture; Ganger Yellow itself is too light on Paper for the arrow. It sits in its own folder because it is a rendered picture with live text, not a logo source. The icon positions live in `scripts/dmg-settings.py`; move the arrow when you move them.
- **Outputs**: `node scripts/dmg-background.ts` renders `dmg/background.png` and `dmg/background@2x.png` with Google Chrome. `pnpm release:mac` puts them, with `apps/desktop/icons/icon.icns` as the volume icon, into the dmg.

## Source files

| File                                         | Use                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`mark.svg`](mark.svg)                       | The mark in full color. Ink body, yellow mouthpiece; the body turns Paper in dark mode.         |
| [`mark-mono.svg`](mark-mono.svg)             | The mark in one color, for places that cannot show yellow (for example on a yellow background). |
| [`mark-favicon.svg`](mark-favicon.svg)       | The small version for 16–32px: favicon, tray icon.                                              |
| [`wordmark.svg`](wordmark.svg)               | The wordmark as outlined paths.                                                                 |
| [`logo-horizontal.svg`](logo-horizontal.svg) | Horizontal lockup.                                                                              |
| [`logo-vertical.svg`](logo-vertical.svg)     | Vertical lockup.                                                                                |
| [`mascot-default.svg`](mascot-default.svg)   | Mascot, `default` mood (wink).                                                                  |
| [`mascot-signal.svg`](mascot-signal.svg)     | Mascot, `signal` mood (whistle).                                                                |
| [`mascot-resting.svg`](mascot-resting.svg)   | Mascot, `resting` mood.                                                                         |
| [`mascot-worried.svg`](mascot-worried.svg)   | Mascot, `worried` mood.                                                                         |
| [`app-icon.svg`](app-icon.svg)               | App icon source (1024 square, layered).                                                         |
| [`OFL-Manrope.txt`](OFL-Manrope.txt)         | Manrope font license notice for the wordmark.                                                   |

## In the app

Don't import these SVG files into app screens. Use the components from `@ganger/ui`:

- `GangerMark` for the mark.
- `Mascot` for the mascot alone.
- `MascotMessage` for a mascot with a message under it (empty states, 404, loading).

Their props and where each one goes are in [`DESIGN.md`](../DESIGN.md#브랜드-그림티켓-0077).

# GLOS Branding Guidelines

GLOS inherits its visual identity from **yukel.com/shoplane**. The UI must look and feel like
part of the Yukel family: a clean, flat, green design system with generous whitespace, bold
labels, and a signature left active-indicator bar on selected items.

## Color palette

| Token | Hex | Use |
|-------|-----|-----|
| `--forest` | `#0E3B2D` | Deep forest green — top social strip, footer, dark surfaces, text/markers, primary buttons |
| `--forest-dark` | `#082019` | Forest hover |
| `--brand` | `#1E9E66` | Emerald — primary brand band (header), fills, focus, interactive accents |
| `--brand-dark` | `#17804F` | Emerald hover / legible green text (eyebrows) |
| `--brand-bright` | `#2FBF71` | Bright green — active state, the **left-accent indicator bar** |
| `--gold` | `#C9A227` | Gold — secondary accent (e.g. footer links) |
| `--bg` | `#FFFFFF` | Page background |
| `--surface` | `#F4F6F7` | Light-gray section bars (e.g. "Category") |
| `--border` | `#E2E6E9` | Card / control borders |
| `--text` | `#1B1B1B` | Near-black labels (bold for navigation) |
| `--muted` | `#6B7280` | Secondary text |
| `--success` | `#1E8E4A` / bg `#E5F4EC` | Positive status |
| `--warn` | `#9A6B00` / bg `#FCF1D6` | Caution status |
| `--danger` | `#B0233A` / bg `#FBE9EC` | Error status |
| `--info` | `#0E3B2D` / bg `#E7F3EC` | Neutral/info (green-tinted) |

Tokens live in `04_generated_sandbox/frontend/src/styles.css`. Legacy names `--navy`/`--azure`
are kept as aliases (→ forest/emerald) so existing styles re-skin automatically.

## Contrast rule
Emerald (`--brand`) is a **fill/border/focus** color, not a text color (it fails WCAG AA on
white at normal sizes). For green text use `--forest` or `--brand-dark`. All participant UI must
meet WCAG 2.2 AA.

## Typography
System sans stack (`-apple-system, 'Segoe UI', Roboto, …`) — matches the Yukel wordmark. Labels
are bold; headings bold and tight.

## Signature patterns
- **Header band** in emerald (`--brand`) with white wordmark; **footer** in forest (`--forest`).
- **Left active-indicator bar**: a 5px `--brand-bright` left border on the selected list/nav item
  (component helper `.ws-card--selected`; used by the onboarding role picker).
- **Flat surfaces**, soft borders, minimal shadows, `--radius` 12px.

## Iconography — note
Yukel/Shoplane uses thin monochrome **line icons** for chrome. GLOS keeps **colorful emoji
pictograms** (📦 🚚 🏭 📜) on participant-facing low-literacy flows, because color + recognizable
glyphs aid non-readers (see the low-literacy UX requirement). Line icons may be used for dense
operational/admin chrome where the audience is staff. When in doubt on participant screens,
favor the accessible pictogram.

# WS-UX Component Kit (T-007)

Low-literacy-first, accessible, dependency-free UI building blocks for GLOS participant screens.
Implements the WS-UX rulebook from `../../../../05_engineering/implementation_plan.md` and is a
definition-of-done gate on every UI ticket in the Phase-1 backlog.

## Principles baked in
- **Icon + word + color + shape together** — never color alone (see `StatusBadge`).
- **Large tap targets** (≥48–56px), one big primary action per screen (`BigButton`).
- **Show, don't type** — `PhotoCapture`, `MapPinPicker` over free-text fields.
- **Read-aloud** (`ReadAloud`, Web Speech API) on text-bearing screens.
- **Money shown large** as the hero element (`AmountHero`).
- **Cards, not dense tables** (`CardList`).
- **One task per screen** wizard progress (`StepProgress`).
- Accessible: visible focus, ARIA roles/labels, WCAG 2.2 AA contrast on the Yukel green palette.
- i18n-ready: components take plain text props, so the T-008 string catalog plugs in directly.

## Components
| Export | Purpose |
|--------|---------|
| `BigButton` | One large high-contrast action |
| `StepProgress` | Numbered wizard progress |
| `StatusBadge` / `STATUS_MAP` | Status as icon+word+color+shape |
| `AmountHero` | Large money display (Intl currency) |
| `CardList` | Scannable cards with optional status |
| `TierLadder` | Identity tier as a visual ladder (icon + what it unlocks) |
| `PhotoCapture` | Camera capture with preview |
| `MapPinPicker` | Pin/geolocation location picker |
| `ReadAloud` / `speak` / `stopSpeaking` | Text-to-speech |
| `el` / `mount` | DOM helpers |

## Usage
```js
import { BigButton, mount } from './components/index.js';
mount(container, BigButton({ label: 'Cash out', icon: '💸', onClick: pay }));
```
Include the styles once: `<link rel="stylesheet" href="./components/components.css">`.

## Preview
Open `../components-demo.html` (e.g. `npm run start` in `04_generated_sandbox/frontend`, then
`http://localhost:4173/components-demo.html`) to see every component with sample data.

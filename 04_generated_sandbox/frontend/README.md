# GLOS Frontend Sandbox

The SeeBuyGet front end: seven installable PWAs and the operator's two consoles, against the NestJS
backend in `../backend`.

## What is here
Seven installable PWAs under `src/apps/` — `home` (the front door, served at `/`), `genesis` (ships at
`/send/`), `driver`, `agent`, `fleet`, `mdp` and `vendor` — plus the operator's two hand-rolled consoles
at `src/pudo-tower.html` and `src/control-tower.html`, which are vanilla pages and never built.

Each app is its OWN Vite build with its own `base`, because Vite has one root and one base per build.
`vite.config.ts` is a factory over `APPS`; `npm run build` loops all seven into `dist/`, laid out exactly
as it deploys.

## Run locally

**The whole site — the only way cross-app links work.**

```bash
npm run build && npm run preview:site   # http://localhost:8080
```

The apps link to each other by absolute path (the home page's "Send or track a parcel" is `/send/`), so
they need to be served TOGETHER from one origin. `dist/` is that origin. Nothing else below serves more
than one app, and a cross-app link in any of them will appear to do nothing — in dev it re-renders the
page you are already on, because Vite's SPA fallback answers `/send/` with the current app's shell.

**One app, with hot reload.**

```bash
SBG_APP=home npm run dev      # or driver, agent, fleet, mdp, vendor, genesis
```

Each app has its own dev port (see `APPS` in `vite.config.ts`). The service worker is off in dev on
purpose.

**The operator consoles.**

```bash
npm start                     # http://localhost:4173/pudo-tower.html
```

This serves `src/` — the two vanilla console pages live there and are not part of any build. It does not
serve the apps, and there is no `src/index.html`.

The backend must be running for any of it: `cd ../backend && npm run start:dev` (port 3000).

## Conventions
- **Every slice names its screens.** A backend change with no surface is tracked ui-debt, not a shipped slice.
- **i18n per slice**: new English keys go in `src/shared/i18n/catalogs/`; the other locales get a central
  pass, not per-slice dribs. `t()` does no pluralising — plurals are a key PAIR (`…One` / `…Many`).
- **The contract is generated**: `cd ../backend && npm run spec` then `npm run types` here. `schema.d.ts`
  is gitignored and rebuilt.
- `npm test` (vitest) and `npm run typecheck` both have to be clean before a commit.

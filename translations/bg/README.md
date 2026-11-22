# Bulgarian (bg), version 1 — work in progress

The English of every app, split into parts (`parts/`), translated part by part by helpers (`out/`), each part checked
by `node check.cjs <part>` (the same placeholder and plural rules as the app's guard). `node build.cjs --status` says how
far it is; `node build.cjs` writes `04_platform/frontend/src/shared/i18n/words/bg/*.ts` only once every part is done —
a partial folder would tell a draft company's readiness that the apps speak Bulgarian. Kept here, outside the apps, so it
neither deploys nor is lost. Brief and glossary: `BRIEF.md`, `glossary.bg.md`. Batches: `batches.json`.

# Shipper "Send Something" Wizard — Scope (M2-U1…U5 / T-310, T-410)

> Self-contained: frontend only, calls existing **stable** M2 endpoints. WS-UX kit, one task per
> screen, read-aloud, plain words. Page: `04_platform/frontend/src/send.html` + `send.js`.
> Auth: page fetches a client-credentials token from `POST /v1/auth/token` (like tracking/settlement).

## Steps (one task per screen, `StepProgress`)
1. **What are you sending?** — category pictogram cards (📄 docs, 💻 electronics, 🥦 fresh, ❄️ frozen,
   👕 clothing, 💎 valuables, 📦 other) → sets `goods.description`; weight + package count (big inputs).
   Optional **template quick-start cards** (`GET /v1/shipments/templates`) to skip typing. *(M2-U1, M2-U3)*
2. **Where?** — origin + destination (big inputs + map-pin assist via `MapPinPicker`); mode cards
   (🚚 road / 🚢 ocean / ✈️ air / 🛵 courier). *(M2-U2)*
3. **Handling needs** — toggle pictograms: ❄️ keep cold (TEMP_2_8C), 🧊 frozen (TEMP_FROZEN),
   ⬆️ this way up (THIS_WAY_UP), 🥚 fragile (FRAGILE), ☂️ keep dry (KEEP_DRY). *(M2-U4)*
4. **Review + Send** — plain summary + one big **Send** button → `POST /v1/shipments`. Server
   auto-tags handling from the commodity + auto-suggests the HS code (invisible). *(M2-U3)*
5. **Label** — `POST /v1/shipments/:id/label`, show the big QR/label (`GET .../label?format=svg`) +
   pictograms + **Print** / **Show on phone** + read-aloud + **Track it** link
   (`tracking.html?shipment=ID`). *(M2-U5)*

## APIs used (all exist + tested)
`POST /v1/auth/token` · `GET /v1/shipments/templates` · `POST /v1/shipments` ·
`POST /v1/shipments/:id/label` · `GET /v1/shipments/:id/label?format=svg`

## WS-UX components
`StepProgress`, `BigButton`, `CardList`/choice-cards, `MapPinPicker`, `ReadAloud`, `el`, `mount`.

## Done when
A non-reader can pick a category, set route + handling by tapping pictograms, send, and see a
printable label — no typing of addresses/HS codes required. Syntax-checked; opens at
`http://localhost:4173/send.html`.

# Translating SeeBuyGet into Bulgarian (bg), version 1

SeeBuyGet is a parcel and freight network. Small shops (магазини) take parcels in and hand them out. Sort hubs (хъбове)
bag and sort them. Drivers (шофьори) and carriers (превозвачи) carry them. People send parcels from their phone (the
Send app), and online stores (онлайн магазини) ship orders. Staff of SeeBuyGet work on a console. The words you
translate are what these people read on their screens: buttons, labels, notices, help articles.

Your translation is version 1. A Bulgarian proofreader reviews it later, so be correct and plain rather than clever.

## Your job

1. Read this brief and `glossary.bg.md` (both in this folder) first.
2. For each part you are given, read `parts/<id>.json`: an object `{ "key": "English phrase" }`.
3. Write `out/<id>.json` with **exactly the same keys**, each value the Bulgarian phrase. UTF-8, valid JSON, nothing else.
4. Run `node check.cjs <id> [<id> …]` in this folder. It must say `PASS` for every part. Fix and re-run until it does.
   Keep its warnings few (a phrase left in English, a phrase with no Cyrillic, quoted labels that do not match).
5. Write your choices of words the glossary does not cover, one line each, to `out/notes-<your batch>.md`.
6. Run NOTHING else: no tests, no builds, no installs, no servers. This machine shuts down under load.

## How to write

- **Polite plural, plain and short.** Address the reader with the polite plural: imperatives like „Изберете“,
  „Въведете“, „Натиснете“. Never the informal „ти“. Avoid pronouns where the sentence works without them.
- **Plain words.** These readers are shopkeepers, drivers and senders, many reading on a small phone. Prefer short
  sentences and everyday words over formal or bureaucratic ones. Keep the English meaning exactly: never add,
  drop or soften a condition, a number, a "not", or who does what. A statement stays a statement; an order stays an order.
- **Money sentences are exact.** Who pays whom, how much, when, refunds: translate with care, word for word in meaning.
- **Buttons are short** (one to three words), in the short singular imperative Bulgarian software uses: „Запази“, „Отвори“, „Покажи“, „Изпрати“. Sentences use the polite plural. Titles start with the task, as in the English.

## What must stay exactly as it is

- **Placeholders**: `{name}`, `{amount}`, `{plate}`, `{n}` … keep every one, spelled exactly, once each as in the English.
  Move them where Bulgarian word order needs them.
- **Counted words**: `{n, plural, one {# parcel} other {# parcels}}` keeps its structure; translate the words inside.
  Bulgarian uses only `one` and `other`: `{n, plural, one {# пратка} other {# пратки}}`. Never add `few` or `many`.
  Where the English has `=0 {…}`, keep it.
- **Quoted labels** in curly quotes `“…”` (a button or screen named in a sentence): keep the curly quotes `“` `”`
  exactly as in the English (the app draws them as chips), and translate the label inside the way you translated
  that button. A route `“A › B › C”` keeps its `›` marks.
- **Names stay in Latin letters**: SeeBuyGet, M-Pesa, Mollie, iDEAL, telebirr, Chapa, Google, WhatsApp, Telegram.
  The apps are named as names: “the Send app” = „приложението Send“, the Shop app = приложението Shop, the Driver app
  = приложението Driver, the Hub app = приложението Hub, the Fleet app = приложението Fleet, the Store app =
  приложението Store, the Business app = приложението Business, the Partner app = приложението Partner.
- **Codes and units**: PIN → ПИН, QR code → QR код, kg, km, m³, cm, EUR, KES stay; GS1, GLN, SSCC, CMR, ADR stay.
  VAT → ДДС.
- **Apostrophes**: the English uses the curly ’. Bulgarian rarely needs one.
- **Line breaks and markup**: keep any `\n`, and any `**` or `*` exactly where the English has them.

## When unsure

Choose the plain, literal meaning, and note it in your notes file. Never leave a phrase in English unless it is a
name, a code or a unit.

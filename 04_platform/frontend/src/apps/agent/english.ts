import { addEnglish, helpWordsAlso, wordsOf, helpWordsOf } from '../../shared/i18n';
import { enAgent } from '../../shared/i18n/catalogs/en.agent';
import { enAbbr } from '../../shared/i18n/catalogs/en.abbr';
import { enRefusal } from '../../shared/i18n/catalogs/en.refusal';

/**
 * The Shop app's English, added before anything of it is evaluated: main.tsx imports this first. Its own words only,
 * not the other apps', so its first download stays light on a slow connection (the user, 2026-10-23). The help's words
 * come when its Help opens, the articles about working in this app with them (en.help-app.ts), not on the public site.
 */
addEnglish({ ...enAgent, ...enAbbr, ...enRefusal });
helpWordsAlso(() => import('../../shared/i18n/catalogs/en.help-app').then((m) => m.enHelpApp));

// 2026-11-03 — the same catalogues in the other languages, fetched only when one is chosen (shared/i18n/index.ts).
wordsOf('agent', 'goods', 'counter', 'abbr', 'refusal');
helpWordsOf('help-app');

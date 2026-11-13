import { addEnglish, helpWordsAlso, wordsOf, helpWordsOf } from '../../shared/i18n';
import { enMdp } from '../../shared/i18n/catalogs/en.mdp';
import { enAbbr } from '../../shared/i18n/catalogs/en.abbr';
import { enCounter } from '../../shared/i18n/catalogs/en.counter';
import { enSiteHours } from '../../shared/i18n/catalogs/en.site-hours';
import { enSiteTools } from '../../shared/i18n/catalogs/en.site-tools';

/**
 * The Hub app's English, added before anything of it is evaluated: main.tsx imports this first. Its own words, the
 * counter staff's, whose screens it shares with the Shop app, and a site's days and hours as every app says them (when
 * it receives stores' parcels in bulk) — not the other apps' own — so its first download
 * stays light on a slow connection (the user, 2026-10-23). The help's words come when its Help opens, the articles
 * about working in this app with them (en.help-app.ts), not on the public site.
 */
addEnglish({ ...enMdp, ...enCounter, ...enSiteHours, ...enAbbr, ...enSiteTools });
helpWordsAlso(() => import('../../shared/i18n/catalogs/en.help-app').then((m) => m.enHelpApp));

// 2026-11-03 — the same catalogues in the other languages, fetched only when one is chosen (shared/i18n/index.ts).
wordsOf('mdp', 'abbr', 'counter', 'site-hours', 'site-tools');
helpWordsOf('help-app');

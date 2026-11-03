import { addEnglish, helpWordsAlso, wordsOf, helpWordsOf } from '../../shared/i18n';
import { enHome } from '../../shared/i18n/catalogs/en.home';
import { enFront } from '../../shared/i18n/catalogs/en.front';
import { enPages } from '../../shared/i18n/catalogs/en.pages';
import { enPrivacy } from '../../shared/i18n/catalogs/en.privacy';
import { enEnergy } from '../../shared/i18n/catalogs/en.energy';

/**
 * THE FRONT DOOR'S OWN ENGLISH, AND NOTHING ELSE (the user, 2026-10-23: "the loading time of the homepage should be short
 * for a low quality phone with poor connection"). Not the other apps' words, and not the help's: those are the biggest
 * part of every app's code, and the homepage shows none of them. A help page loads the help's words before it is drawn
 * (main.tsx), a help sheet when it opens (useHelpWords). main.tsx imports this first.
 */
// What a courier's own vehicle runs on (2026-11-03): eighteen short words, not the vehicles' whole catalogue.
addEnglish({ ...enHome, ...enFront, ...enPages, ...enPrivacy, ...enEnergy });
// The trade’s short forms said in full in a help sheet’s articles (shared/abbr.ts): fetched with the help’s words when a
// help sheet opens, never in the first download.
helpWordsAlso(() => import('../../shared/i18n/catalogs/en.abbr').then((m) => m.enAbbr));

// 2026-11-03 — the same catalogues in the other languages, fetched only when one is chosen (shared/i18n/index.ts).
wordsOf('home', 'specialisms', 'front', 'pages', 'privacy', 'energy');
helpWordsOf('abbr');

import { addEnglish, helpWordsAlso } from '../../shared/i18n';
import { enHome } from '../../shared/i18n/catalogs/en.home';
import { enFront } from '../../shared/i18n/catalogs/en.front';
import { enPages } from '../../shared/i18n/catalogs/en.pages';
import { enPrivacy } from '../../shared/i18n/catalogs/en.privacy';

/**
 * THE FRONT DOOR'S OWN ENGLISH, AND NOTHING ELSE (the user, 2026-10-23: "the loading time of the homepage should be short
 * for a low quality phone with poor connection"). Not the other apps' words, and not the help's: those are the biggest
 * part of every app's code, and the homepage shows none of them. A help page loads the help's words before it is drawn
 * (main.tsx), a help sheet when it opens (useHelpWords). main.tsx imports this first.
 */
addEnglish({ ...enHome, ...enFront, ...enPages, ...enPrivacy });
// The trade’s short forms said in full in a help sheet’s articles (shared/abbr.ts): fetched with the help’s words when a
// help sheet opens, never in the first download.
helpWordsAlso(() => import('../../shared/i18n/catalogs/en.abbr').then((m) => m.enAbbr));

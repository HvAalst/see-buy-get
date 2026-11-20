import { addEnglish, helpWordsAlso, wordsOf, helpWordsOf } from '../../shared/i18n';
import { enPartner } from '../../shared/i18n/catalogs/en.partner';
import { enAbbr } from '../../shared/i18n/catalogs/en.abbr';

/**
 * The Partner app's English, added before anything of it is evaluated: main.tsx imports this first. Its own words — the
 * hands' card it shares with every app is in the base words already — and the abbreviations. The help's words come when its
 * Help opens, with the articles about working in an app (en.help-app.ts).
 */
addEnglish({ ...enPartner, ...enAbbr });
helpWordsAlso(() => import('../../shared/i18n/catalogs/en.help-app').then((m) => m.enHelpApp));

// The same catalogues in the other languages, fetched only when one is chosen (shared/i18n/index.ts).
wordsOf('partner', 'abbr');
helpWordsOf('help-app');

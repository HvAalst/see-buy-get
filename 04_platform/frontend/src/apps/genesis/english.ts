import { addEnglish, helpWordsAlso } from '../../shared/i18n';
import { enSend } from '../../shared/i18n/catalogs/en.send';
import { enAbbr } from '../../shared/i18n/catalogs/en.abbr';

/**
 * The Send app's English, added before anything of it is evaluated: main.tsx imports this first. Its own words only,
 * not the other apps', so its first download stays light on a slow connection (the user, 2026-10-23). The help's words
 * come when its Help opens, the articles about working in this app with them (en.help-app.ts), not on the public site.
 */
addEnglish({ ...enSend, ...enAbbr });
helpWordsAlso(() => import('../../shared/i18n/catalogs/en.help-app').then((m) => m.enHelpApp));

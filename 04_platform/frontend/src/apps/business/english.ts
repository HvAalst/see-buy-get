import { addEnglish, helpWordsAlso } from '../../shared/i18n';
import { enBusiness } from '../../shared/i18n/catalogs/en.business';
import { enAbbr } from '../../shared/i18n/catalogs/en.abbr';
import { enGoods } from '../../shared/i18n/catalogs/en.goods';
import { enSiteHours } from '../../shared/i18n/catalogs/en.site-hours';
import { enSpecialisms } from '../../shared/i18n/catalogs/en.specialisms';
import { enTowerBusiness } from '../../shared/i18n/catalogs/en.tower-business';
import { enRefusal } from '../../shared/i18n/catalogs/en.refusal';
import { enDirectoryCard } from '../../shared/i18n/catalogs/en.directory-card';

/**
 * The Business app's English, added before anything of it is evaluated: main.tsx imports this first. Its own words;
 * those it says as other apps do (goods, a site's days and hours, what a clearing agent handles); and the words of the
 * console's screens it hosts (an import, depots, a contact card, a company's papers), which it went without from
 * 2026-10-22 until scripts/check-words.mjs found them missing. Not the other apps' own, so its first download stays
 * light on a slow connection (the user, 2026-10-23). The help's words come when its Help opens, the articles about
 * working in this app with them (en.help-app.ts), not on the public site.
 */
addEnglish({ ...enBusiness, ...enGoods, ...enSiteHours, ...enSpecialisms, ...enTowerBusiness, ...enAbbr, ...enRefusal, ...enDirectoryCard });
helpWordsAlso(() => import('../../shared/i18n/catalogs/en.help-app').then((m) => m.enHelpApp));

import { addEnglish, helpWordsAlso } from '../../shared/i18n';
import { enFleet } from '../../shared/i18n/catalogs/en.fleet';
import { enAbbr } from '../../shared/i18n/catalogs/en.abbr';
import { enVehicles } from '../../shared/i18n/catalogs/en.vehicles';
import { enGoods } from '../../shared/i18n/catalogs/en.goods';
import { enUpkeep } from '../../shared/i18n/catalogs/en.upkeep';
import { enDirectoryCard } from '../../shared/i18n/catalogs/en.directory-card';

/**
 * The Fleet app's English, added before anything of it is evaluated: main.tsx imports this first. Its own words, and
 * the words for vehicles and goods it says as the Driver and Shop apps do — not the other apps' own — so its first
 * download stays light on a slow connection (the user, 2026-10-23). The help's words come when its Help opens, the
 * articles about working in this app with them (en.help-app.ts), not on the public site.
 */
addEnglish({ ...enFleet, ...enVehicles, ...enGoods, ...enUpkeep, ...enAbbr, ...enDirectoryCard });
helpWordsAlso(() => import('../../shared/i18n/catalogs/en.help-app').then((m) => m.enHelpApp));

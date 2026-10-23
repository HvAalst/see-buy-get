import { addEnglish } from '../../shared/i18n';
import { enTowerAll } from '../../shared/i18n/catalogs/en.tower';
import { enApps } from '../../shared/i18n/catalogs/en.apps';

/**
 * The console's own words, and every app's (staff read what each app says, and the help), added before anything of the
 * console is evaluated: main.tsx imports this first.
 */
addEnglish({ ...enApps, ...enTowerAll });

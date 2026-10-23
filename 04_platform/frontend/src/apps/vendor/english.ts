import { addEnglish } from '../../shared/i18n';
import { enApps } from '../../shared/i18n/catalogs/en.apps';

/**
 * This app's English, added before anything of it is evaluated: main.tsx imports this first. Every app's own words and
 * the help's — what the catalog every app carries (en.ts) no longer holds, so the front door can leave them out.
 */
addEnglish(enApps);

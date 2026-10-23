import './english';
import { addEnglish } from '../../shared/i18n';
import { enHelp } from '../../shared/i18n/catalogs/en.help';

/** At build time every page is rendered, the help's among them: the front door's words and the help's, before any of it. */
addEnglish(enHelp);

/**
 * A COURIER'S OWN VEHICLE'S UPKEEP, fetched when it is opened (2026-10-25): the sheet a fleet's office keeps, and its
 * words. Some 7 kB a phone downloads only when the owner asks for it — not on every driver's first visit, most of whom
 * drive a fleet's vehicle and never open it.
 */
import { addEnglish } from '../../../shared/i18n';
import { enUpkeep } from '../../../shared/i18n/catalogs/en.upkeep';

addEnglish(enUpkeep);

export { VehicleCareSheet } from '../../../shared/upkeep/VehicleCare';

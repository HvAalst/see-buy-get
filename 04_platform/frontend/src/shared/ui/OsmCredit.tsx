import { useT } from '../i18n';

/**
 * Where a typed address is found, credited the way OpenStreetMap asks: its name, and a link to its copyright page
 * (the user, 2026-10-25: "we can use openstreetmap's address service"). One line, under every box an address is
 * typed into to find the nearest shops — the Send app, the Store app and the Shop app's counter.
 */
export function OsmCredit() {
  const t = useT();
  return (
    <p class="card__note">
      {t('common.addressesByOsm')}{' '}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
        © OpenStreetMap contributors
      </a>
    </p>
  );
}

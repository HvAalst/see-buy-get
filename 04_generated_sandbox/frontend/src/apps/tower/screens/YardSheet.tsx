import { Icon, PlaceMap, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { triggerDownload } from '../../../shared/download';
import type { DepotRow } from './DepotsScreen';

/** A vCard for one yard. Plain text, built here, so the file is exactly what the screen showed. */
export function vcardFor(d: DepotRow): string {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${d.placeLabel}`,
    `ORG:${d.placeLabel}`,
    ...(d.contact?.contactName ? [`N:;${d.contact.contactName};;;`] : []),
    ...(d.contact?.phone ? [`TEL;TYPE=WORK,VOICE:${d.contact.phone}`] : []),
    ...(d.contact?.phoneAlt ? [`TEL;TYPE=WORK,CELL:${d.contact.phoneAlt}`] : []),
    ...(d.contact?.email ? [`EMAIL;TYPE=WORK:${d.contact.email}`] : []),
    ...(d.contact?.website ? [`URL:${d.contact.website}`] : []),
    ...(d.contact?.address ? [`ADR;TYPE=WORK:;;${d.contact.address.replace(/[;,\n]/g, ' ')};;;;${d.country}`] : []),
    // The geo tag carries the SAME point the map drew, and the note says which kind it is — a contact
    // saved out of here should not become the source of a precision nobody claimed.
    ...(d.location ? [`GEO:${d.location.lat};${d.location.lng}`] : []),
    ...(d.contact?.hours ? [`NOTE:${d.contact.hours}`] : []),
    'END:VCARD',
  ];
  return lines.join('\r\n');
}

/**
 * ONE YARD, OPENED.
 *
 * The finder's rows carried everything: the name, the country, two counts, who said so and when, the
 * telephone, the hours and a contact name — four lines a haulier had to read past to compare one yard
 * with the next. The user: "there is much info on the result, decrease it." So the row is now the
 * avatar, the name, the country and an arrow, and this is what the arrow opens.
 *
 * WHAT IT ADDS BEYOND MOVING TEXT. A map, because a yard is a place somebody has to drive to and a town
 * name is not directions — with the honest caveat attached: a pin the yard dropped is the yard pointing
 * at its own gate, and a point resolved from their NAME is the middle of a town. And an "add to
 * contacts" that hands over a vCard, because the next act after finding a yard is ringing them, and
 * the act after that is ringing them again next month.
 */
export function YardSheet({ yard, onClose }: { yard: DepotRow; onClose: () => void }) {
  const t = useT();
  const ring = yard.contact?.phone ? `tel:${yard.contact.phone.replace(/[^+\d]/g, '')}` : null;

  return (
    <Sheet open onClose={onClose} title={yard.placeLabel}>
      <div class="cons__facts">
        <div class="cons__fact">
          <span class="cons__factk">{t('tower.depots.f.country')}</span>
          <span class="cons__factv">{yard.country}</span>
        </div>
        <div class="cons__fact">
          <span class="cons__factk">{t('tower.depots.sheetHolding')}</span>
          <span class="cons__factv">
            {t('tower.depots.rowCounts', { said: yard.saidCount, inbound: yard.inboundCount })}
            <span class="chint">{t('tower.depots.rowSaidBy', { by: yard.saidBy, d: yard.saidAt.slice(0, 10) })}</span>
          </span>
        </div>
        {yard.contact?.hours ? (
          <div class="cons__fact">
            <span class="cons__factk">{t('tower.contact.f.hours')}</span>
            <span class="cons__factv">{yard.contact.hours}</span>
          </div>
        ) : null}
        {yard.contact?.contactName ? (
          <div class="cons__fact">
            <span class="cons__factk">{t('tower.contact.f.person')}</span>
            <span class="cons__factv">{yard.contact.contactName}</span>
          </div>
        ) : null}
        {yard.contact?.address ? (
          <div class="cons__fact">
            <span class="cons__factk">{t('tower.contact.f.address')}</span>
            <span class="cons__factv">{yard.contact.address}</span>
          </div>
        ) : null}
      </div>

      {/* A yard is a place somebody drives to, and a town name is not directions. */}
      {yard.location ? (
        <>
          <PlaceMap pins={[{ id: yard.entityId, label: yard.placeLabel, point: yard.location }]} selectedId={yard.entityId} label={t('tower.depots.mapLabel', { yard: yard.placeLabel })} />
          {/* Which KIND of point this is, every time it is drawn. A pin the yard dropped is them
              pointing at their own gate; one resolved from their name is the middle of a town, and a
              haulier setting off deserves to know which they are looking at. */}
          <p class="chint">{yard.locationFrom === 'pin' ? t('tower.depots.mapPin') : t('tower.depots.mapNamed', { place: yard.placeLabel })}</p>
        </>
      ) : (
        <p class="chint">{t('tower.depots.mapNone')}</p>
      )}

      <div class="twr-panelend">
        {ring ? (
          <a class="cbtn cbtn--primary" href={ring}>
            <Icon name="keypad" size={14} />
            {yard.contact?.phone}
          </a>
        ) : (
          <span class="chint">{t('tower.depots.noContact')}</span>
        )}
        {/* The next act after finding a yard is ringing them; the one after that is ringing them again
            next month, which is what a contact card is for. */}
        {yard.contact ? (
          <button type="button" class="cbtn cbtn--ghost" onClick={() => triggerDownload(`${yard.placeLabel}.vcf`, vcardFor(yard), 'text/vcard;charset=utf-8')}>
            <Icon name="person" size={14} />
            {t('tower.depots.addContact')}
          </button>
        ) : null}
      </div>

      {/* Verbatim: two sources kept apart, and neither is an inventory. */}
      <p class="chint">{yard.basis}</p>
    </Sheet>
  );
}

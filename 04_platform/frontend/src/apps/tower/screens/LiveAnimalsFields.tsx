import type { ComponentChildren } from 'preact';
import { useT, type MessageKey } from '../../../shared/i18n';
import { ConsolePick } from '../ConsolePick';

/** The live-animals declaration as typed — one shape for an export and an import (2026-10-30). */
export interface AnimalsForm {
  kind: 'livestock' | 'crated';
  species: string;
  count: string;
  permit: string;
  healthCertificate: string;
  citesListed: boolean;
  citesPermit: string;
  movementPermit: string;
  attendantName: string;
  attendantPhone: string;
  shipperCertifiedBy: string;
  hatchedAt: string;
  fitToTravel: boolean;
  namedOn: string;
}

export const EMPTY_ANIMALS: AnimalsForm = { kind: 'livestock', species: '', count: '', permit: '', healthCertificate: '', citesListed: false, citesPermit: '', movementPermit: '', attendantName: '', attendantPhone: '', shipperCertifiedBy: '', hatchedAt: '', fitToTravel: false, namedOn: '' };

/** A moment typed as UTC, or nothing. */
const utcIn = (v: string): string | undefined => {
  const at = Date.parse(`${v.trim()}${v.trim().length === 16 ? ':00' : ''}Z`);
  return v.trim() && !Number.isNaN(at) ? new Date(at).toISOString() : undefined;
};

/** What the form still lacks before it can be sent — the server asks the same, in its own words. */
export function animalsReady(f: AnimalsForm, side: 'import' | 'export'): boolean {
  return Boolean(f.species.trim() && Number(f.count) >= 1 && f.permit.trim() && f.healthCertificate.trim() && f.fitToTravel && (!f.citesListed || f.citesPermit.trim()) && (side === 'import' || f.shipperCertifiedBy.trim()));
}

/** The declaration as the server takes it. */
export function animalsBody(f: AnimalsForm, side: 'import' | 'export', quarantineSiteId?: string): Record<string, unknown> {
  return {
    kind: f.kind,
    species: f.species.trim(),
    count: Number(f.count),
    permit: f.permit.trim(),
    healthCertificate: f.healthCertificate.trim(),
    fitToTravel: f.fitToTravel,
    ...(f.citesListed ? { citesListed: true, citesPermit: f.citesPermit.trim() } : {}),
    ...(f.movementPermit.trim() ? { movementPermit: f.movementPermit.trim() } : {}),
    ...(f.attendantName.trim() ? { attendantName: f.attendantName.trim(), ...(f.attendantPhone.trim() ? { attendantPhone: f.attendantPhone.trim() } : {}) } : {}),
    ...(side === 'export' && f.shipperCertifiedBy.trim() ? { shipperCertifiedBy: f.shipperCertifiedBy.trim() } : {}),
    ...(utcIn(f.hatchedAt) ? { hatchedAt: utcIn(f.hatchedAt) } : {}),
    ...(side === 'import' && quarantineSiteId ? { quarantineSiteId, ...(f.namedOn.trim() ? { namedOn: f.namedOn.trim() } : {}) } : {}),
  };
}

/**
 * LIVE ANIMALS, DECLARED BY THEIR KEEPER (2026-10-30): what they are and how many, the papers by number — their originals
 * ride with the animals — who looks after them on the way, and the keeper's word that none is unfit. On an import, the
 * place the veterinary officer named comes in `placeSlot`; on an export, who signed the shipper's certification.
 */
export function LiveAnimalsFields({ value, onChange, side, placeSlot }: { value: AnimalsForm; onChange: (next: AnimalsForm) => void; side: 'import' | 'export'; placeSlot?: ComponentChildren }) {
  const t = useT();
  const set = (k: keyof AnimalsForm) => (e: Event) => onChange({ ...value, [k]: (e.target as HTMLInputElement).value });
  const field = (k: keyof AnimalsForm, label: MessageKey, extra: Record<string, string> = {}) => (
    <label class="twr-knob cfield">
      <span class="cfield__label">{t(label)}</span>
      <input class="cinput" value={String(value[k])} onInput={set(k)} {...extra} />
    </label>
  );
  return (
    <>
      <h3 class="cons__sub">{t('tower.animals.title')}</h3>
      <p class="chint">{t('tower.animals.hint')}</p>
      <div class="twr-knobs__row">
        <div class="twr-knob">
          <ConsolePick
            label={t('tower.animals.f.kind')}
            value={value.kind}
            options={[
              { value: 'livestock', label: t('tower.animals.kind.livestock') },
              { value: 'crated', label: t('tower.animals.kind.crated') },
            ]}
            onChange={(kind) => onChange({ ...value, kind: kind as AnimalsForm['kind'] })}
          />
        </div>
        {field('species', 'tower.animals.f.species', { maxLength: '80', placeholder: value.kind === 'livestock' ? 'Dairy heifers' : 'Day-old chicks' })}
        {field('count', 'tower.animals.f.count', { type: 'number', min: '1' })}
      </div>
      {value.kind === 'crated' ? (
        <div class="twr-knobs__row">
          {field('hatchedAt', 'tower.animals.f.hatchedAt', { type: 'datetime-local' })}
        </div>
      ) : null}
      <div class="twr-knobs__row">
        {field('permit', side === 'import' ? 'tower.animals.f.permitImport' : 'tower.animals.f.permitExport', { maxLength: '60' })}
        {field('healthCertificate', 'tower.animals.f.healthCertificate', { maxLength: '60' })}
        {field('movementPermit', 'tower.animals.f.movementPermit', { maxLength: '60' })}
      </div>
      <label class="cfield--check">
        <input type="checkbox" checked={value.citesListed} onChange={() => onChange({ ...value, citesListed: !value.citesListed })} />
        <span>{t('tower.animals.f.citesListed')}</span>
      </label>
      {value.citesListed ? <div class="twr-knobs__row">{field('citesPermit', 'tower.animals.f.citesPermit', { maxLength: '60' })}</div> : null}
      <div class="twr-knobs__row">
        {field('attendantName', 'tower.animals.f.attendantName', { maxLength: '80' })}
        {field('attendantPhone', 'tower.animals.f.attendantPhone', { maxLength: '24', type: 'tel' })}
      </div>
      <p class="chint">{t('tower.animals.attendantHint')}</p>
      {side === 'export' ? <div class="twr-knobs__row">{field('shipperCertifiedBy', 'tower.animals.f.shipperCertifiedBy', { maxLength: '120' })}</div> : null}
      {side === 'export' ? <p class="chint">{t('tower.animals.certificationHint')}</p> : null}
      {placeSlot}
      <label class="cfield--check">
        <input type="checkbox" checked={value.fitToTravel} onChange={() => onChange({ ...value, fitToTravel: !value.fitToTravel })} />
        <span>{t('tower.animals.f.fitToTravel')}</span>
      </label>
      <p class="chint">{t('tower.animals.originalsHint')}</p>
    </>
  );
}

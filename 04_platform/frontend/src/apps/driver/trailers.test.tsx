import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import './english';
import { EMPTY_TRAILER, trailerBody, trailerLine } from '../../shared/trailers';
import { TrailerSheet } from '../../shared/trailers/TrailerSheet';
import { HitchSheet } from './screens/HitchSheet';
import { LoadSpaceSheet } from './screens/LoadSpaceSheet';
import type { DriverActions } from './useDriverApp';

/*
 * 2026-11-13 — A VAN TOWING A TRAILER (the owner: "movers use vans and trailers in cities"; plan D1–D5): a trailer as typed, what it
 * carries, the hitch with what the licence covers, and what the van may tow in the vehicle sheet.
 */
describe('a trailer, as typed', () => {
  it('sends its plate, weights and kind; asks what is missing first', () => {
    const f = { ...EMPTY_TRAILER, plate: ' ze 1234 ', maxKg: '750', emptyKg: '380', litres: '5500', ramp: true };
    expect(trailerBody(f)).toEqual({ body: { plate: 'ZE 1234', maxKg: 750, emptyKg: 380, braked: false, closed: true, litres: 5500, ramp: true } });
    expect(trailerBody({ ...f, plate: '' })).toEqual({ error: 'trailer.errPlate' });
    expect(trailerBody({ ...f, maxKg: '5000' })).toEqual({ error: 'trailer.errMax' });
    expect(trailerBody({ ...f, emptyKg: '800' })).toEqual({ error: 'trailer.errEmpty' });
    expect(trailerBody({ ...f, litres: 'x' })).toEqual({ error: 'trailer.errLitres' });
    expect(trailerBody({ ...f, litres: '' })).toMatchObject({ body: { plate: 'ZE 1234' } });
  });

  it('says in one line what it carries', () => {
    expect(trailerLine({ plate: 'ZE 1234', payloadKg: 370, volumeM3: 5.5, closed: true, braked: false, ramp: true }, t)).toBe(
      `ZE 1234 · ${t('trailer.carries', { kg: 370 })} · ${t('trailer.litres', { litres: 5500 })} · ${t('trailer.closed')} · ${t('trailer.unbraked')} · ${t('trailer.withRamp')}`,
    );
  });

  it('a kept trailer asks for its registration card; a day’s hire does not', () => {
    const keep = renderToString(<TrailerSheet open onClose={() => undefined} mode="keep" onSave={async () => null} upload={async () => null} />);
    expect(keep).toContain(t('trailer.card'));
    expect(keep).toContain(t('trailer.addSave'));
    const hire = renderToString(<TrailerSheet open onClose={() => undefined} mode="hire" onSave={async () => null} />);
    expect(hire).not.toContain(t('trailer.card'));
    expect(hire).toContain(t('trailer.hireSave'));
  });
});

describe('the hitch and the van’s towing', () => {
  it('the hitch offers a hire for the day and what the licence covers, as on the card', () => {
    const html = renderToString(<HitchSheet open onClose={() => undefined} sbg={{ request: async () => ({ data: [] }) } as never} driverDid="did:drv:1" towing={['BE']} onDone={() => undefined} />);
    expect(html).toContain(t('trailer.hire'));
    expect(html).toContain(t('trailer.kind.B96'));
    expect(html).toMatch(/aria-pressed="true"[^>]*>BE</);
  });

  it('a van says what it may tow; on a shift its rate while towing; a bike says nothing of towing', () => {
    const actions = { setLoadSpace: async () => null } as unknown as DriverActions;
    const sheet = (vehicleClass: string, onShift: boolean) =>
      renderToString(<LoadSpaceSheet open onClose={() => undefined} actions={actions} vehicle={{ vehicleId: 'v1', vehicleClass, capacityKg: 900, towLimits: { brakedKg: 1500, unbrakedKg: 750 } }} word={vehicleClass} own sbg={null} onShift={onShift} />);
    const van = sheet('van', false);
    expect(van).toContain(t('trailer.mayTow'));
    expect(van).toContain('value="1500"');
    expect(van).not.toContain(t('trailer.towRate'));
    expect(sheet('van', true)).toContain(t('trailer.towRate'));
    expect(sheet('bike', true)).not.toContain(t('trailer.mayTow'));
  });
});

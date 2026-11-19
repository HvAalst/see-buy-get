import { describe, expect, it } from 'vitest';
import { formatDate, formatMoney, t } from '../../shared/i18n';
import { abroadNote, type AbroadView } from './abroad';
import { renderToString } from 'preact-render-to-string';
import { h } from 'preact';
import { AbroadNoteOf } from './screens/MyParcelsScreen';

/*
 * 2026-11-19 — A PARCEL ABROAD IN THE SEND APP (parcels across a border, step 3): its receiver is told what customs asks, to whom
 * and by when, and then what they pay at the shop; its sender, that the receiver is asked and what happens if not; and our part
 * at collection once it passed.
 */
const held = { amount: 1200.5, currency: 'ETB', reference: 'ET-CUS-0042', payee: 'Addis Clearing Ltd', payBy: '2026-12-03T10:00:00.000Z' };
const due = { amount: 1850, currency: 'ETB', paid: false };

describe('a parcel abroad, read by its sender and its receiver', () => {
  it('says nothing on its way there', () => {
    expect(abroadNote(undefined, 'received', t)).toBeNull();
    expect(abroadNote({ to: 'ET', stage: 'on_way' }, 'received', t)).toBeNull();
  });

  it('at customs: not decided yet', () => {
    expect(abroadNote({ to: 'ET', stage: 'customs' }, 'received', t)?.detail).toBe(t('send.parcels.abroad.customsDetail'));
  });

  it('held: the receiver is told what, to whom, by when, and then our part at the shop; the sender, what happens if not', () => {
    const a: AbroadView = { to: 'ET', stage: 'held', held, due };
    const amount = formatMoney(1200.5, 'ETB');
    const r = abroadNote(a, 'received', t)!;
    expect(r.title).toBe(t('send.parcels.abroad.held', { amount }));
    expect(r.detail).toContain(t('send.parcels.abroad.heldReceiver', { payee: 'Addis Clearing Ltd', date: formatDate(held.payBy), reference: 'ET-CUS-0042' }));
    expect(r.detail).toContain(t('send.parcels.abroad.thenOurs', { amount: formatMoney(1850, 'ETB') }));
    expect(abroadNote(a, 'sent', t)?.detail).toBe(t('send.parcels.abroad.heldSender', { amount, date: formatDate(held.payBy) }));
    // No clearing agent named: said as the clearing agent.
    expect(abroadNote({ ...a, held: { ...held, payee: undefined } }, 'received', t)?.detail).toContain(t('send.parcels.abroad.theAgent'));
  });

  it('not paid in time: the receiver that it goes back, the sender that they are asked', () => {
    const a: AbroadView = { to: 'ET', stage: 'held', held: { ...held, lapsed: true } };
    expect(abroadNote(a, 'received', t)?.detail).toBe(t('send.parcels.abroad.lapsedReceiver'));
    expect(abroadNote(a, 'sent', t)?.detail).toBe(t('send.parcels.abroad.lapsedSender'));
  });

  it('released: the receiver pays our part at the shop; once paid, nothing more to say to them', () => {
    expect(abroadNote({ to: 'ET', stage: 'released', due }, 'received', t)?.detail).toBe(t('send.parcels.abroad.payAtShop', { amount: formatMoney(1850, 'ETB') }));
    expect(abroadNote({ to: 'ET', stage: 'released', due: { ...due, paid: true } }, 'received', t)).toBeNull();
    expect(abroadNote({ to: 'ET', stage: 'released', due }, 'sent', t)?.detail).toBe(t('send.parcels.abroad.onToShop'));
  });

  it('links the page that explains it to every party, under the note — and nothing where there is no note', () => {
    const html = renderToString(h(AbroadNoteOf, { parcel: { abroad: { to: 'ET', stage: 'customs' }, relation: 'received' } }));
    expect(html).toContain('help/parcel-from-abroad/');
    expect(html).toContain(t('send.parcels.abroad.how'));
    expect(renderToString(h(AbroadNoteOf, { parcel: { abroad: { to: 'ET', stage: 'on_way' }, relation: 'received' } }))).toBe('');
  });
});

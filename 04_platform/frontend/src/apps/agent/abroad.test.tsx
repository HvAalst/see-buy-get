import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { AbroadCard, DestinationCard } from './screens/AcceptScreen';
import { TakenInLabel } from './screens/TakenInLabel';
import { EMPTY_ABROAD, EMPTY_ACCEPT, abroadBody, abroadMissing, abroadRouteFor, acceptMissing, selectablePoints, type AbroadForm } from './logic';
import type { AbroadRoute, NetworkPoint } from './types';
import type { AgentActions, AgentState } from './useAgentApp';

/*
 * 2026-11-18 — A PARCEL ABROAD AT THE COUNTER (parcels across a border, step 2b). A shop in another country is offered only
 * where a route is on to it; picked, the counter checks the parcel with the sender and writes its declaration — what is
 * inside and how many, the value and its money from the invoice, a photo of each, the seal, both names — and prints the
 * customs papers with the label.
 */
const pt = (did: string, country?: string): NetworkPoint => ({ did, shopName: did, zone: 'Z', country, openState: 'open', pricePerParcel: 1 });
const ET: AbroadRoute = { to: 'ET', name: 'Ethiopia', departure: 'NBO', arrival: 'ADD' };
const full: AbroadForm = { contents: 'Shoes', items: '2', value: '45,50', currency: 'usd', invoicePhotoRef: 'm-inv', contentsPhotoRef: 'm-in', seal: 'SL-004211', senderName: 'Wanjiru Kamau', receiverName: 'Abebe Bekele' };

describe('a shop abroad in the picker', () => {
  it('is offered only where a route is on to its country', () => {
    const pts = [pt('nairobi', 'KE'), pt('addis', 'ET'), pt('dar', 'TZ')];
    expect(selectablePoints(pts, undefined, null, 'KE').map((p) => p.did)).toEqual(['nairobi']);
    expect(selectablePoints(pts, undefined, null, 'KE', ['ET']).map((p) => p.did)).toEqual(['addis', 'nairobi']);
  });

  it('is reached by its route; a shop at home, or abroad with no route, by none', () => {
    const pts = [pt('nairobi', 'KE'), pt('addis', 'ET'), pt('dar', 'TZ')];
    expect(abroadRouteFor(pts, 'addis', 'KE', [ET])).toEqual(ET);
    expect(abroadRouteFor(pts, 'nairobi', 'KE', [ET])).toBeNull();
    expect(abroadRouteFor(pts, 'dar', 'KE', [ET])).toBeNull();
    expect(abroadRouteFor(pts, 'addis', undefined, [ET])).toBeNull();
  });

  it('says it is abroad on its row, by its country’s name', () => {
    const html = renderToString(
      <DestinationCard
        state={{ agent: { did: 'did:me', zone: 'Z1', shopName: 'Me', country: 'KE' }, accept: { ...EMPTY_ACCEPT }, acceptPoints: [pt('addis', 'ET'), pt('home', 'KE')], acceptPointsState: 'ready', acceptNear: null, abroadRoutes: [ET] } as unknown as AgentState}
        actions={{} as AgentActions}
      />,
    );
    expect(html).toContain(t('agent.accept.abroad.rowTag', { country: 'Ethiopia' }));
    expect(html.split(t('agent.accept.abroad.rowTag', { country: 'Ethiopia' })).length).toBe(2);
  });
});

describe('its declaration', () => {
  it('asks for each thing in the order the counter does it', () => {
    const steps: Array<[Partial<AbroadForm>, string]> = [
      [{ contents: '' }, 'agent.logic.acceptAbroadContents'],
      [{ items: '0' }, 'agent.logic.acceptAbroadItems'],
      [{ value: '0' }, 'agent.logic.acceptAbroadValue'],
      [{ currency: 'US' }, 'agent.logic.acceptAbroadValue'],
      [{ invoicePhotoRef: '' }, 'agent.logic.acceptAbroadInvoice'],
      [{ contentsPhotoRef: '' }, 'agent.logic.acceptAbroadInside'],
      [{ seal: '' }, 'agent.logic.acceptAbroadSeal'],
      [{ receiverName: 'A' }, 'agent.logic.acceptAbroadNames'],
    ];
    for (const [gap, key] of steps) expect(abroadMissing({ ...full, ...gap }, t)).toBe(t(key as 'agent.logic.acceptAbroadContents'));
    expect(abroadMissing(full, t)).toBeNull();
    expect(abroadMissing(EMPTY_ABROAD, t)).toBe(t('agent.logic.acceptAbroadContents'));
  });

  it('comes after the parcel’s own photo, and only for a parcel abroad', () => {
    const ready = { ...EMPTY_ACCEPT, parcelId: 'PUD-1', dims: { l: '30', w: '20', h: '10', kg: '2' }, destPudoDid: 'addis', photoRef: 'm-drop' };
    expect(acceptMissing(ready, t)).toBeNull();
    expect(acceptMissing(ready, t, true)).toBe(t('agent.logic.acceptAbroadContents'));
    expect(acceptMissing({ ...ready, photoRef: '' }, t, true)).toBe(t('agent.logic.acceptPhoto'));
    expect(acceptMissing({ ...ready, abroad: full }, t, true)).toBeNull();
  });

  it('is sent as the server takes it: a whole count, the value to the cent with a comma read as a point, the money in capitals', () => {
    expect(abroadBody({ ...full, contents: '  Shoes ', senderName: ' Wanjiru Kamau ' })).toEqual({
      contents: 'Shoes',
      itemCount: 2,
      declaredValue: 45.5,
      currency: 'USD',
      invoicePhotoRef: 'm-inv',
      contentsPhotoRef: 'm-in',
      seal: 'SL-004211',
      senderName: 'Wanjiru Kamau',
      receiverName: 'Abebe Bekele',
    });
  });

  it('shows where it leaves and arrives, what to check, and every field to fill', () => {
    const html = renderToString(<AbroadCard route={ET} state={{ accept: { ...EMPTY_ACCEPT, abroad: full } } as unknown as AgentState} actions={{} as AgentActions} />);
    expect(html).toContain(t('agent.accept.abroad.title', { country: 'Ethiopia' }));
    expect(html).toContain(t('agent.accept.abroad.route', { departure: 'NBO', arrival: 'ADD' }));
    expect(html).toContain(t('agent.accept.abroad.check'));
    for (const id of ['abroad-contents', 'abroad-items', 'abroad-value', 'abroad-currency', 'abroad-invoice', 'abroad-inside', 'abroad-seal', 'abroad-sender', 'abroad-receiver']) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('value="SL-004211"');
  });
});

describe('the customs papers', () => {
  it('are printed beside the label, for the pouch; a parcel at home has none', () => {
    const abroad = renderToString(<TakenInLabel label={{ parcelId: 'PUD-1', svg: '<svg></svg>', papersSvg: '<svg>Customs declaration</svg>' }} />);
    expect(abroad).toContain(t('agent.accept.abroad.papers'));
    expect(abroad).toContain(t('agent.accept.abroad.papersHint'));
    const home = renderToString(<TakenInLabel label={{ parcelId: 'PUD-2', svg: '<svg></svg>' }} />);
    expect(home).not.toContain(t('agent.accept.abroad.papers'));
  });
});

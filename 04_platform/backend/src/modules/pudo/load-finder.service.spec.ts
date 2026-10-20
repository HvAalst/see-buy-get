import { GlosError } from '../../foundation/http/glos-error';
import { ssccOf } from '../../foundation/gs1/gs1';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import type { ConsignmentNoteService } from './consignment-note.service';
import type { DispatchService } from './dispatch.service';
import { LoadFinderService, NO_LOAD_YOU_CAN_OPEN, NO_PARCEL_YOU_HANDLE, loadRefOf } from './load-finder.service';
import type { ParcelService } from './parcel.service';
import type { MdpService } from './mdp.service';
import type { ShipperCodesService } from './shipper-codes.service';

const SSCC = ssccOf('6161234', 4, 7);
const load = { freightId: 'frt_1', code: 'FRT-12', description: 'Soap, bagged', pickupLabel: 'Industrial Area', destLabel: 'Nakuru depot', status: 'claimed', trackingKey: 'T-0A1B2C3D4E', postedByDid: 'did:biz' };

function finder() {
  const codes = { packageOf: (s: string) => (s === SSCC ? { freightId: 'frt_1', no: 2, of: 3 } : undefined) } as unknown as ShipperCodesService;
  const dispatch = {
    freightByTrackingKey: (k: string) => (k === load.trackingKey ? load : undefined),
    freightByCode: (c: string) => (c === load.code ? load : undefined),
  } as unknown as DispatchService;
  const notes = {
    requireReader: (id: string, actor: IntrospectionResult | undefined) => {
      if (actor?.role === 'operator' || actor?.did === 'did:biz') return load;
      throw new GlosError('NOT_FOUND', 'Freight not found');
    },
  } as unknown as ConsignmentNoteService;
  return new LoadFinderService(codes, dispatch, notes);
}
const as = (did: string, role = 'business') => ({ did, role }) as unknown as IntrospectionResult;

describe('a load found by what was scanned (round 19)', () => {
  it('reads an SSCC in every form a scanner hands over, our label’s QR, a tracking key and a typed load code — and nothing else', () => {
    for (const raw of [SSCC, `00${SSCC}`, `(00) ${SSCC}`, `]C100${SSCC}`, ` ${SSCC} `]) expect(loadRefOf(raw)).toEqual({ sscc: SSCC });
    expect(loadRefOf('https://seebuyget.com/send/?track=T-0A1B2C3D4E')).toEqual({ trackingKey: 'T-0A1B2C3D4E' });
    expect(loadRefOf('http://localhost:5176/send/?lang=sw&track=t-0a1b2c3d4e')).toEqual({ trackingKey: 'T-0A1B2C3D4E' });
    expect(loadRefOf('T-0A1B2C3D4E')).toEqual({ trackingKey: 'T-0A1B2C3D4E' });
    expect(loadRefOf('frt-12')).toEqual({ code: 'FRT-12' });
    // A parcel's sticker, a bag, a wrong check digit, nothing at all: not a load's code.
    for (const raw of ['PUD-123456', 'sbg:parcel:PUD-1', 'TOTE-042', `${SSCC.slice(0, 17)}${(Number(SSCC[17]) + 1) % 10}`, '', undefined]) expect(loadRefOf(raw)).toBeUndefined();
  });

  it('finds the load, and which package, for whoever may open it', () => {
    expect(finder().find(`]C100${SSCC}`, as('did:biz'))).toEqual({ freightId: 'frt_1', code: 'FRT-12', description: 'Soap, bagged', pickupLabel: 'Industrial Area', destLabel: 'Nakuru depot', status: 'claimed', package: 2, packages: 3, sscc: SSCC });
    expect(finder().find('https://seebuyget.com/send/?track=T-0A1B2C3D4E', as('staff', 'operator'))).toMatchObject({ code: 'FRT-12' });
    expect(finder().find('FRT-12', as('did:biz')).package).toBeUndefined();
  });

  it('says the same to anybody else as for a code that names nothing — and refuses what is no load’s code at all', () => {
    const f = finder();
    expect(() => f.find(SSCC, as('did:rival'))).toThrow(NO_LOAD_YOU_CAN_OPEN);
    expect(() => f.find(ssccOf('6161234', 4, 99), as('did:biz'))).toThrow(NO_LOAD_YOU_CAN_OPEN);
    expect(() => f.find('T-FFFFFFFFFF', as('did:biz'))).toThrow(NO_LOAD_YOU_CAN_OPEN);
    expect(() => f.find('PUD-123456', as('did:biz'))).toThrow(/not a load’s code/);
  });
});

describe('a store parcel found by its SSCC (round 32)', () => {
  const PARCEL_SSCC = ssccOf('6169876', 2, 0);
  const parcel = { parcelId: 'PUD-AB12', status: 'At_MDP', originAgentDid: 'did:shop:north', destAgentDid: 'did:shop:south', atMdpId: 'mdp_1' };
  const finder = () => {
    const codes = { parcelOfSscc: (s: string) => (s === PARCEL_SSCC ? parcel.parcelId : undefined), packageOf: () => undefined } as unknown as ShipperCodesService;
    const parcels = {
      get: (id: string) => {
        if (id === parcel.parcelId) return parcel;
        throw new GlosError('NOT_FOUND', 'No such parcel');
      },
    } as unknown as ParcelService;
    const mdps = { list: () => [{ mdpId: 'mdp_1', did: 'did:hub:1' }, { mdpId: 'mdp_2', did: 'did:hub:2' }] } as unknown as MdpService;
    return new LoadFinderService(codes, {} as DispatchService, {} as ConsignmentNoteService, parcels, mdps);
  };

  it('finds the parcel, in any form a scanner hands it over, for the shops it goes between, the hub it stands at, and staff', () => {
    const found = { parcelId: 'PUD-AB12', sscc: PARCEL_SSCC, status: 'At_MDP' };
    for (const raw of [PARCEL_SSCC, `00${PARCEL_SSCC}`, `(00) ${PARCEL_SSCC}`, `]C100${PARCEL_SSCC}`]) expect(finder().findParcel(raw, as('did:shop:north', 'agent'))).toEqual(found);
    expect(finder().findParcel(PARCEL_SSCC, as('did:shop:south', 'agent'))).toEqual(found);
    expect(finder().findParcel(PARCEL_SSCC, as('did:hub:1', 'mdp'))).toEqual(found);
    expect(finder().findParcel(PARCEL_SSCC, as('did:ops', 'operator'))).toEqual(found);
  });

  it('reads the same to anybody else as a parcel that does not exist — serials run in order, so it is never a way to walk them', () => {
    for (const who of [as('did:shop:other', 'agent'), as('did:hub:2', 'mdp'), as('did:biz', 'business'), as('did:driver', 'driver'), undefined]) {
      expect(() => finder().findParcel(PARCEL_SSCC, who)).toThrow(NO_PARCEL_YOU_HANDLE);
    }
    expect(() => finder().findParcel(ssccOf('6169876', 2, 1), as('did:shop:north', 'agent'))).toThrow(NO_PARCEL_YOU_HANDLE);
    expect(() => finder().findParcel('PUD-AB12', as('did:shop:north', 'agent'))).toThrow(/not a GS1 barcode/);
  });
});

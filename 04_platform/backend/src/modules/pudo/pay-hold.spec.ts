import { readProtocol } from './pay-hold.types';

/**
 * THE PROTOCOL, read from the record (the owner, 2026-11-15: "staff actually needs a decision tree rather than individual
 * judgement"). Three questions, in order; the first that settles it decides. Never more than the carriage price.
 */
describe('the protocol for a held pay', () => {
  const withCode = { deliveryCode: '123456', deliveredWithCode: true };
  const door = (kind: string) => ({ proofOfDelivery: { receiverName: 'Achieng', photoRef: 'p1', exceptions: [{ kind, count: 1 }] } });

  it('step 1: a load with a code, delivered without it and without the sender saying it arrived, was not handed over', () => {
    expect(readProtocol({ deliveryCode: '123456' }, { kind: 'damaged' })).toMatchObject({ step: 'not_handed_over', outcome: 'refund' });
    expect(readProtocol({ deliveryCode: '123456', posterConfirmedAt: '2026-11-15T10:00:00Z' }, { kind: 'damaged' }).step).toBe('not_noted_at_door');
  });

  it('step 1, a load without a code: a name, a photo and the phone at the door are the handover; far from the door is not', () => {
    const pod = { receiverName: 'Achieng', photoRef: 'p1' };
    expect(readProtocol({ proofOfDelivery: pod }, { kind: 'damaged' }).step).toBe('not_noted_at_door');
    expect(readProtocol({ proofOfDelivery: { ...pod, position: { metresFromPlace: 400 } } }, { kind: 'damaged' }).step).toBe('not_noted_at_door');
    expect(readProtocol({ proofOfDelivery: { ...pod, position: { metresFromPlace: 5000 } } }, { kind: 'damaged' }).step).toBe('not_handed_over');
    expect(readProtocol({ proofOfDelivery: { receiverName: 'Achieng' } }, { kind: 'damaged' }).step).toBe('not_handed_over');
    expect(readProtocol({}, { kind: 'not_received' })).toMatchObject({ step: 'not_handed_over', outcome: 'refund' });
  });

  it('step 2: not noted at the door — the driver is paid, whatever was found later (hidden damage)', () => {
    expect(readProtocol({ ...withCode }, { kind: 'damaged' })).toMatchObject({ step: 'not_noted_at_door', outcome: 'release' });
    // Noted at the door, but a different problem from the one reported.
    expect(readProtocol({ ...withCode, ...door('short') }, { kind: 'damaged' }).step).toBe('not_noted_at_door');
    // A count of none is no note.
    expect(readProtocol({ ...withCode, proofOfDelivery: { receiverName: 'A', photoRef: 'p', exceptions: [{ kind: 'damaged', count: 0 }] } }, { kind: 'damaged' }).step).toBe('not_noted_at_door');
  });

  it('step 3: noted at the door — noted at pickup too, the driver is paid; only at the door, the carriage price goes back', () => {
    expect(readProtocol({ ...withCode, ...door('damaged'), reservations: { note: 'Dented already' } }, { kind: 'damaged' })).toMatchObject({ step: 'noted_at_pickup', outcome: 'release' });
    expect(readProtocol({ ...withCode, ...door('damaged'), reservations: { note: '  ' } }, { kind: 'damaged' })).toMatchObject({ step: 'arose_in_carriage', outcome: 'refund' });
    expect(readProtocol({ ...withCode, ...door('wrong') }, { kind: 'wrong' }).step).toBe('arose_in_carriage');
    expect(readProtocol({ ...withCode, ...door('short') }, { kind: 'short' }).facts).toEqual({ handedOver: true, notedAtDoor: true, notedAtPickup: false });
  });

  it('every reading carries the words everybody is shown', () => {
    expect(readProtocol({ ...withCode }, { kind: 'damaged' }).words).toMatch(/^Step 2: /);
  });
});

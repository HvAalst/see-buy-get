import { isAdvancing, isLegalTransition } from './event-vocabulary';

describe('tracking state machine (VTT-021)', () => {
  it('allows the legal happy path', () => {
    expect(isLegalTransition('START', 'PICKUP')).toBe(true);
    expect(isLegalTransition('PICKUP', 'OUT_FOR_DELIVERY')).toBe(true);
    expect(isLegalTransition('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(true);
  });

  it('rejects DELIVERED before OUT_FOR_DELIVERY', () => {
    expect(isLegalTransition('PICKUP', 'DELIVERED')).toBe(false);
    expect(isLegalTransition('START', 'DELIVERED')).toBe(false);
  });

  it('treats geofence/exception as non-advancing and always legal', () => {
    expect(isAdvancing('GEOFENCE_ENTER')).toBe(false);
    expect(isAdvancing('EXCEPTION')).toBe(false);
    expect(isLegalTransition('PICKUP', 'GEOFENCE_ENTER')).toBe(true);
  });
});

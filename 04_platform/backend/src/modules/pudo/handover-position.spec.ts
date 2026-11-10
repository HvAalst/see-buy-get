import { distanceWords, phoneAtHandover, positionAnchor, positionAtAct, positionWords } from './handover-position';

describe('the phone’s position at a handover (2026-11-10)', () => {
  const place = { lat: -1.28, lng: 36.82 };
  const act = '2026-11-10T09:00:00.000Z';

  it('keeps the reading, how sure the phone was, and how far from the place', () => {
    const p = positionAtAct({ lat: -1.2809, lng: 36.82, accuracyM: 14.6, fixAt: '2026-11-10T08:59:50.000Z' }, place, act);
    expect(p).toEqual({ lat: -1.2809, lng: 36.82, accuracyM: 15, fixAt: '2026-11-10T08:59:50.000Z', metresFromPlace: 100 });
    expect(positionWords(p, act)).toBe('The driver’s phone was 100 m from this place (accurate to 15 m)');
  });

  it('writes a missing reading down as missing — never refuses the act for it', () => {
    expect(positionAtAct(undefined, place, act)).toEqual({ none: true });
    expect(positionAtAct({ none: true }, place, act)).toEqual({ none: true });
    expect(positionAtAct({ lat: -1.28 }, place, act)).toEqual({ none: true });
    expect(positionWords({ none: true })).toBe('The driver’s phone gave no position');
    expect(positionAnchor({ none: true })).toBe('none');
  });

  it('says nothing for an act kept before positions were', () => {
    expect(positionWords(undefined)).toBeUndefined();
    expect(positionAnchor(undefined)).toBeUndefined();
  });

  it('gives the place by its coordinates where there is no pin to measure from', () => {
    const p = positionAtAct({ lat: 9.0301234, lng: 38.7401234 }, undefined, act);
    expect(p.metresFromPlace).toBeUndefined();
    expect(positionWords(p, act)).toBe('The driver’s phone was at 9.03012, 38.74012');
  });

  it('says how old a reading was when it was read well before the act, and drops a time from the future', () => {
    const old = positionAtAct({ lat: -1.28, lng: 36.82, fixAt: '2026-11-10T08:54:00.000Z' }, place, act);
    expect(positionWords(old, act)).toBe('The driver’s phone was under 10 m from this place, read 6 min before');
    expect(positionAtAct({ lat: -1.28, lng: 36.82, fixAt: '2026-11-10T09:30:00.000Z' }, place, act).fixAt).toBeUndefined();
  });

  it('reads distances as people do', () => {
    expect(distanceWords(4)).toBe('under 10 m');
    expect(distanceWords(44)).toBe('40 m');
    expect(distanceWords(1250)).toBe('1.3 km');
    expect(distanceWords(25_400)).toBe('25 km');
  });

  it('asks a phone of the driver’s own app only: staff acting for one send nothing', () => {
    expect(phoneAtHandover({ role: 'driver' }, undefined)).toEqual({ position: { none: true } });
    expect(phoneAtHandover({ role: 'driver' }, { lat: 1, lng: 2 })).toEqual({ position: { lat: 1, lng: 2 } });
    expect(phoneAtHandover({ role: 'operator' }, { lat: 1, lng: 2 })).toEqual({});
  });
});

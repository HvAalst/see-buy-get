import { checkDigitFor } from './container-box';
import { holdRailNote, railNoteView } from './rail-note';

/*
 * WHERE ROAD AND RAIL MEET, the rail note's box and seals against ours (the user, 2026-10-28: "I want to reduce mistakes
 * and delays … for road where road and rail comes together"). A number that is a real container number but not ours is
 * the mistake that sends a truck for the wrong box.
 */
const now = Date.parse('2026-10-28T10:00:00Z');
const held = (over: Record<string, unknown> = {}) =>
  holdRailNote(
    { railway: 'krc', from: { name: 'Nairobi ICD', country: 'KE' }, to: { name: 'Mombasa Port Reitz', country: 'ke' }, noteNumber: 'KRC-1', madeOutOn: '2026-10-28', load: 'container', printed: ['mass', 'mass', 'goods'], ...over } as never,
    { by: 'Wanjiku', byEntityId: 'ent_1', now },
  );
const other = `TGHU765432${checkDigitFor('TGHU765432')}`;

describe('a held rail note against our record of the box', () => {
  it('a real container number that is not ours differs — and ours agrees', () => {
    expect(railNoteView(held({ containerNo: other }), { containerNo: 'MSCU1234566' }, 0).matches).toEqual([{ field: 'containerNo', printed: other, ours: 'MSCU1234566', agrees: false }]);
    expect(railNoteView(held({ containerNo: 'mscu 123456-6' }), { containerNo: 'MSCU1234566' }, 0).matches).toEqual([{ field: 'containerNo', printed: 'MSCU1234566', ours: 'MSCU1234566', agrees: true }]);
  });

  it('the seals agree in any order and spacing, and differ when one is not ours', () => {
    expect(railNoteView(held({ seals: ['kr 778', 'KR779'] }), { seals: ['KR779', 'KR778'] }, 0).matches[0]).toMatchObject({ field: 'seals', agrees: true });
    expect(railNoteView(held({ seals: ['KR778'] }), { seals: ['KR779'] }, 0).matches[0]).toMatchObject({ field: 'seals', agrees: false });
    // Nothing of ours to hold it against: nothing is said.
    expect(railNoteView(held({ seals: ['KR778'] }), {}, 0).matches).toEqual([]);
  });

  it('is kept as its holder read it: the country in capitals, each particular once, the day not to come', () => {
    const n = held();
    expect(n.to.country).toBe('KE');
    expect(n.printed).toEqual(['goods', 'mass']);
    expect(() => held({ madeOutOn: '2026-10-29' })).toThrow('A note is made out on a day that has come');
    expect(() => held({ railway: 'other' })).toThrow('Give the railway’s name');
  });
});

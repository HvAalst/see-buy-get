import { describe, expect, it } from 'vitest';
import { readingMatches, sealKey, sealOver, sealStory, sealWhat, type SealView } from './seals';

const t = (key: string, vars?: Record<string, unknown>) => `${key}${vars ? ` ${JSON.stringify(vars)}` : ''}`;
const when = (iso: string) => `@${iso.slice(11, 16)}`;
/** The server's fingerprint of seal KE1234567 on load frt_1 (load-seal.service sealCheck: sha256 of "frt_1|KE1234567"). */
const SERVER_CHECK = '41f5b3d6143aa2cf96c45494677275519c5a9341b92e5e63ecc2bf9dd822af5c';

describe('a seal on a load, as everybody reads it (round 15)', () => {
  it('folds a reading as the server does, and checks it on the phone against the seal’s fingerprint', async () => {
    expect(sealKey('ke 123-4567')).toBe('KE1234567');
    expect(sealKey('KE.1234/567')).toBe('KE1234567');
    const check = SERVER_CHECK;
    expect(await readingMatches('frt_1', ' ke 1234-567 ', check)).toBe(true);
    expect(await readingMatches('frt_1', 'KE1234568', check)).toBe(false);
    // The same number on another load is another fingerprint.
    expect(await readingMatches('frt_2', 'KE1234567', check)).toBe(false);
  });

  it('says what a seal is, and what became of it', () => {
    expect(sealWhat({ number: 'KE1234567', sealClass: 'H', maker: 'Leghorn', appliedBy: 'sender' }, t as never)).toBe('KE1234567 · common.seal.class {"c":"H"} · Leghorn · common.seal.bySender');
    // The driver's app names a seal without its number.
    expect(sealWhat({ sealClass: 'S', appliedBy: 'customs' }, t as never)).toBe('common.seal.class {"c":"S"} · common.seal.byCustoms');
    const base: SealView = { sealId: 's1', number: 'KE1234567', sealClass: 'H', appliedBy: 'sender', state: 'on', writtenAt: '2026-10-19T06:00:00.000Z' };
    expect(sealStory(base, t as never, when)).toBe('common.seal.written');
    expect(sealStory({ ...base, matchedAt: '2026-10-19T08:00:00.000Z' }, t as never, when)).toBe('common.seal.matched {"when":"@08:00"}');
    expect(sealStory({ ...base, state: 'replaced', replaced: { at: '2026-10-19T16:40:00.000Z', post: 'Malaba', by: 'UG990011' } }, t as never, when)).toBe('common.seal.replaced {"by":"UG990011","post":"Malaba","when":"@16:40"}');
    expect(sealStory({ ...base, state: 'broken', broken: { at: '2026-10-19T18:10:00.000Z', cause: 'police' } }, t as never, when)).toBe('common.seal.broken {"how":"common.seal.cause.police","when":"@18:10"}');
    expect(sealStory({ ...base, atDelivery: { at: '2026-10-20T06:00:00.000Z', result: 'not_as_on_the_note' } }, t as never, when)).toBe('common.seal.deliveredNotAsWritten {"when":"@06:00"}');
    expect(sealStory({ ...base, appliedBy: 'customs', replaces: 'KE1234567' }, t as never, when)).toBe('common.seal.inPlaceOf {"number":"KE1234567"}');
  });
});

describe('what a seal closes, in a line (ISO 28000: seals bound to the container number and the SSCCs)', () => {
  it('names the container and counts the packages — one package by its code — and says nothing where it names neither', () => {
    expect(sealOver({ containerNo: 'MSKU1234565', ssccs: ['006141411234567890', '006141411234567906'] }, t as never)).toBe('common.seal.onContainer {"container":"MSKU1234565"} · common.seal.overPackages {"n":2}');
    expect(sealOver({ ssccs: ['006141411234567890'] }, t as never)).toBe('common.seal.overPackage {"sscc":"006141411234567890"}');
    expect(sealOver({ containerNo: 'MSKU1234565' }, t as never)).toBe('common.seal.onContainer {"container":"MSKU1234565"}');
    expect([sealOver({}, t as never), sealOver({ ssccs: [] }, t as never)]).toEqual(['', '']);
  });
});

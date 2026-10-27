import { describe, expect, it } from 'vitest';
import { t } from './i18n';
import { elsewhereBody, refusalSays, utcMoment, type Refusal } from './refusal';

const refused: Refusal = { at: '2026-10-27T08:00:00.000Z', note: 'Wrong colour', decideBy: '2026-10-29T08:00:00.000Z' };

describe('refused at the door, as a sender reads it (the user, 2026-10-27)', () => {
  it('says what happened, then what to do and by when — no reader’s clock assumed', () => {
    expect(utcMoment('2026-10-29T08:00:00.000Z')).toBe('29 Oct at 08:00 UTC');
    expect(refusalSays(refused, 'Depot', t)).toEqual([
      'The receiver refused it on 27 Oct at 08:00 UTC: “Wrong colour”.',
      'The driver keeps the goods until you say where they go, and you pay the way. With no answer by 29 Oct at 08:00 UTC, they go back to Depot, at your cost.',
    ]);
    expect(refusalSays({ ...refused, note: undefined }, 'Depot', t)[0]).toBe('The receiver refused it on 27 Oct at 08:00 UTC.');
  });

  it('says what became of the goods once decided — by the sender, or by the 48 hours', () => {
    const leg = { freightId: 'f2', code: 'FRT-0002' };
    expect(refusalSays({ ...refused, decision: { choice: 'back', at: '2026-10-27T10:00:00Z', by: 'did:x', destLabel: 'Depot', returnLeg: leg } }, 'Depot', t)[1]).toBe('Going back to Depot as load FRT-0002.');
    expect(refusalSays({ ...refused, decision: { choice: 'elsewhere', at: '2026-10-27T10:00:00Z', by: 'did:x', destLabel: 'Second shop', returnLeg: leg } }, 'Depot', t)[1]).toBe('Going to Second shop as load FRT-0002.');
    expect(refusalSays({ ...refused, decision: { choice: 'back', at: '2026-10-29T08:00:00Z', byDeadline: true, destLabel: 'Depot', returnLeg: leg } }, 'Depot', t)[1]).toBe('No answer within 48 hours: going back to Depot as load FRT-0002, at your cost.');
    expect(refusalSays({ ...refused, decision: { choice: 'give_up', at: '2026-10-27T10:00:00Z', by: 'did:x' } }, 'Depot', t)[1]).toBe('You gave the goods up: the receiver may keep them; otherwise the carrier disposes of them, at your cost.');
  });

  it('asks for another place in words and on the map before anything is sent', () => {
    const pin = { lat: -1.2, lng: 36.9 };
    expect(elsewhereBody({ label: 'X', pin, contactName: '', contactPhone: '' })).toEqual({ error: 'refusal.err.place' });
    expect(elsewhereBody({ label: 'Second shop', pin: null, contactName: '', contactPhone: '' })).toEqual({ error: 'refusal.err.pin' });
    expect(elsewhereBody({ label: ' Second shop ', pin, contactName: ' Wanjiru ', contactPhone: '' })).toEqual({ body: { choice: 'elsewhere', destLabel: 'Second shop', destLocation: pin, contactName: 'Wanjiru' } });
  });
});

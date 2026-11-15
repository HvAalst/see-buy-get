import { describe, expect, it } from 'vitest';
import { EMPTY_PERSON_LOAD, personLoadBlocker, personLoadBody, type PersonLoadForm } from './personLoads';

/** 2026-11-13 — a person posts a load (unusual loads, U5): asked in order, sent as said; a person names no rate. */
const filled = (over: Partial<PersonLoadForm> = {}): PersonLoadForm => ({
  ...EMPTY_PERSON_LOAD('+256700123456'),
  description: 'A fridge',
  weightKg: '60',
  from: { label: 'Ntinda', pin: { lat: 0.35, lng: 32.6 } },
  to: { label: 'Entebbe', pin: { lat: 0.05, lng: 32.46 } },
  ...over,
});

describe('a person’s load, on the Send app', () => {
  it('asks what is missing, in the order the form asks it', () => {
    expect(personLoadBlocker(EMPTY_PERSON_LOAD())).toBe('send.load.needWhat');
    expect(personLoadBlocker(filled({ weightKg: '0' }))).toBe('send.load.needKg');
    expect(personLoadBlocker(filled({ from: { label: 'Ntinda', pin: null } }))).toBe('send.load.needFrom');
    expect(personLoadBlocker(filled({ to: { label: '', pin: { lat: 0, lng: 32 } } }))).toBe('send.load.needTo');
    expect(personLoadBlocker(filled({ contactPhone: ' ' }))).toBe('send.load.needPhone');
    expect(personLoadBlocker(filled({ work: { ...filled().work, needs: 'two' } }))).toBe('work.needHandsPickup');
    expect(personLoadBlocker(filled())).toBeNull();
  });

  it('sends what was said, and no rate', () => {
    const body = personLoadBody(filled({ weightKg: '60,5', note: ' Ring twice ' }));
    expect(body).toEqual({ description: 'A fridge', weightKg: 60.5, pickupLabel: 'Ntinda', pickupLocation: { lat: 0.35, lng: 32.6 }, destLabel: 'Entebbe', destLocation: { lat: 0.05, lng: 32.46 }, contactPhone: '+256700123456', instructions: 'Ring twice' });
    expect(body).not.toHaveProperty('commitMode');
  });
});

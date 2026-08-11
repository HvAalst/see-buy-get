import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n'; // English is the base catalog, so the real `t` yields the English literals
import {
  EMPTY_JOIN,
  ROLES,
  codeLooksValid,
  joinSpoken,
  nextStep,
  normalizePhone,
  phoneLooksValid,
  prevStep,
  roleById,
  roleMeta,
  signupBody,
  stepBlocker,
  stepsFor,
  type JoinForm,
  type RoleSpec,
} from './logic';

const role = (id: string): RoleSpec => roleById(id)!;

const filled = (over: Partial<JoinForm> = {}): JoinForm => ({
  ...EMPTY_JOIN,
  phone: '+254700111222',
  code: '1234',
  email: 'me@example.com',
  password: 'hunter22',
  displayName: 'Mama Sarah Shop',
  fullName: 'Sarah Njeri',
  nationalId: 'NID-1',
  location: { lat: -1.28, lng: 36.82 },
  zone: 'Z-A',
  ...over,
});

describe('roles', () => {
  it('every role names an app path and a join kind', () => {
    expect(ROLES.length).toBe(5);
    for (const r of ROLES) {
      expect(r.app).toMatch(/^\/[a-z]+\/$/);
      expect(['signup', 'vendor', 'invite']).toContain(r.kind);
      expect(roleMeta(r, t).promise.length).toBeGreaterThan(0);
    }
    // The three roles the backend's /auth/signup actually supports.
    expect(ROLES.filter((r) => r.kind === 'signup').map((r) => r.id)).toEqual(['pudo', 'driver', 'mdp']);
  });
});

describe('phone + code', () => {
  it('accepts real international shapes and rejects junk', () => {
    expect(phoneLooksValid('+254 700 111 222')).toBe(true);
    expect(phoneLooksValid('0712345678')).toBe(true);
    expect(phoneLooksValid('(020) 123-4567')).toBe(true);
    expect(phoneLooksValid('12345')).toBe(false);
    expect(phoneLooksValid('not a phone')).toBe(false);
    expect(normalizePhone('+254 700-111 (222)')).toBe('+254700111222');
  });

  it('the OTP is 4 to 6 digits', () => {
    expect(codeLooksValid('1234')).toBe(true);
    expect(codeLooksValid(' 123456 ')).toBe(true);
    expect(codeLooksValid('12')).toBe(false);
    expect(codeLooksValid('12a4')).toBe(false);
  });
});

describe('wizard steps', () => {
  it('a vendor skips the phone gate the backend never asks for', () => {
    expect(stepsFor('vendor')).toEqual(['about', 'done']);
    expect(stepsFor('signup')[0]).toBe('phone');
  });

  it('next/prev stay inside the sequence', () => {
    expect(nextStep('signup', 'phone')).toBe('code');
    expect(prevStep('signup', 'phone')).toBe('phone');
    expect(nextStep('signup', 'done')).toBe('done');
    expect(prevStep('signup', 'login')).toBe('where');
  });
});

describe('stepBlocker', () => {
  it('walks a shop through in order', () => {
    const shop = role('pudo');
    expect(stepBlocker(shop, 'phone', EMPTY_JOIN, t)).toContain('phone');
    expect(stepBlocker(shop, 'phone', filled(), t)).toBeNull();
    expect(stepBlocker(shop, 'about', { ...filled(), displayName: '' }, t)).toContain('shop');
    expect(stepBlocker(shop, 'about', { ...filled(), fullName: '' }, t)).toContain('full name');
    expect(stepBlocker(shop, 'where', { ...filled(), location: null }, t)).toContain('map');
    expect(stepBlocker(shop, 'where', filled(), t)).toBeNull();
    expect(stepBlocker(shop, 'login', { ...filled(), password: '123' }, t)).toContain('6 characters');
    expect(stepBlocker(shop, 'login', filled(), t)).toBeNull();
  });

  it('a driver must say what they drive; a hub needs no personal ID', () => {
    expect(stepBlocker(role('driver'), 'about', { ...filled(), licenceClasses: [] }, t)).toContain('what you drive');
    expect(stepBlocker(role('mdp'), 'about', { ...filled(), fullName: '', nationalId: '' }, t)).toBeNull();
  });

  it('a store only needs its name', () => {
    expect(stepBlocker(role('vendor'), 'about', EMPTY_JOIN, t)).toContain('Name your store');
    expect(stepBlocker(role('vendor'), 'about', { ...EMPTY_JOIN, displayName: 'Nairobi Threads' }, t)).toBeNull();
  });
});

describe('signupBody', () => {
  it('a shop carries the Golden Record, the pin and workable defaults', () => {
    const body = signupBody(role('pudo'), filled(), 'dev-marker') as {
      role: string;
      phone: string;
      profile: { agent: Record<string, unknown> };
    };
    expect(body.role).toBe('pudo');
    expect(body.phone).toBe('+254700111222');
    const a = body.profile.agent;
    expect(a.shopName).toBe('Mama Sarah Shop');
    expect(a.mobile).toBe('+254700111222'); // the verified number, not a second entry
    expect(a.deviceImei).toBe('dev-marker');
    expect(a.location).toEqual({ lat: -1.28, lng: 36.82 });
    expect(a.shelf).toEqual({ rows: 4, cols: 5 });
    expect(Object.keys(a.openingHours as object)).toHaveLength(7);
    expect((a.requirements as { criminalRecordClear: boolean }).criminalRecordClear).toBe(true);
  });

  it('a driver sends licence classes and a home zone; a hub sends its zone list', () => {
    const d = signupBody(role('driver'), filled({ licenceClasses: ['bike', 'van'] }), 'x') as {
      profile: { driver: Record<string, unknown> };
    };
    expect(d.profile.driver.licenceClasses).toEqual(['bike', 'van']);
    expect(d.profile.driver.homeZone).toBe('Z-A');

    const m = signupBody(role('mdp'), filled(), 'x') as { profile: { mdp: Record<string, unknown> } };
    expect(m.profile.mdp.zones).toEqual(['Z-A']);
    expect(m.profile.mdp.location).toEqual({ lat: -1.28, lng: 36.82 });
  });

  it('a landmark is optional — the pin is the address', () => {
    const body = signupBody(role('pudo'), filled({ landmark: '' }), 'x') as { profile: { agent: { landmark: string } } };
    expect(body.profile.agent.landmark).toContain('Pin');
  });
});

describe('speaking', () => {
  it('every step has a spoken line', () => {
    for (const step of stepsFor('signup')) {
      expect(joinSpoken(role('pudo'), step, t).length).toBeGreaterThan(0);
    }
  });
});

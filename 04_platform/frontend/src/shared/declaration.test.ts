import { describe, expect, it } from 'vitest';
import { t } from './i18n';
import { declarationAsks, declarationWhy, type DeclarationView } from './declaration';
import { declarationCounts, type DeclarationRow } from '../apps/tower/screens/DeclarationsPanel';

const day = (iso: string) => iso.slice(0, 10);
const base: DeclarationView = { required: true, kind: 'shop', version: 1, title: 'Our security declaration', lines: ['One', 'Two', 'Three', 'Four'] };

describe('the security declaration on a partner’s home screen (round 39)', () => {
  it('asks for a hand only when it is missing, lapsed, of a new wording, or due — never when signed, or of a fleet’s driver', () => {
    for (const state of ['missing', 'lapsed', 'outdated', 'due'] as const) expect(declarationAsks({ ...base, state })).toBe(true);
    expect(declarationAsks({ ...base, state: 'signed' })).toBe(false);
    expect(declarationAsks({ required: false, coveredBy: 'Kilima Logistics' })).toBe(false);
    expect(declarationAsks(null)).toBe(false);
  });

  it('says a stop as a stop and a reminder as a reminder, with the day', () => {
    expect(declarationWhy({ ...base, state: 'missing' }, t, day)).toEqual({ tone: 'danger', title: 'Sign your security declaration: nothing new is taken on until you have.' });
    expect(declarationWhy({ ...base, state: 'lapsed', until: '2026-10-20T09:00:00Z' }, t, day)).toEqual({ tone: 'danger', title: 'Your security declaration ran out on 2026-10-20: sign it again — nothing new is taken on until you have.' });
    expect(declarationWhy({ ...base, state: 'outdated' }, t, day)?.tone).toBe('danger');
    expect(declarationWhy({ ...base, state: 'due', until: '2026-11-15T09:00:00Z' }, t, day)).toEqual({ tone: 'warn', title: 'Your security declaration runs out on 2026-11-15: sign it again before then.' });
    expect(declarationWhy({ ...base, state: 'signed' }, t, day)).toBeNull();
  });

  it('counts for staff who takes on nothing new, who is due, and who is signed', () => {
    const rows: DeclarationRow[] = [
      { kind: 'shop', did: 'a', name: 'A', state: 'missing' },
      { kind: 'hub', did: 'b', name: 'B', state: 'lapsed' },
      { kind: 'fleet', did: 'c', name: 'C', state: 'outdated' },
      { kind: 'driver', did: 'd', name: 'D', state: 'due' },
      { kind: 'shop', did: 'e', name: 'E', state: 'signed' },
    ];
    expect(declarationCounts(rows)).toEqual({ stopped: 3, due: 1, signed: 1 });
  });
});

import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { attemptWords } from './screens/LoadDoor';

describe('at the door, as a business reads its load (the user, 2026-10-27: "Business sees attempts")', () => {
  it('says each door the driver could not hand over at: when, why, and the driver’s words', () => {
    expect(attemptWords({ outcome: 'absent', note: 'Gate locked', at: '2026-10-27T08:00:00.000Z' }, t)).toBe('27 Oct at 08:00 UTC — nobody was there to receive it: “Gate locked”');
    expect(attemptWords({ outcome: 'unreachable', at: '2026-10-27T09:30:00.000Z' }, t)).toBe('27 Oct at 09:30 UTC — the driver could not reach the place');
    expect(attemptWords({ outcome: 'refused', at: '2026-10-27T10:00:00.000Z' }, t)).toBe('27 Oct at 10:00 UTC — the receiver refused it');
  });
});

import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { handshakeStanding, lossStanding, pct, retentionStanding, seconds, takeInStanding, type PilotTargets } from './pilot';

const TG: PilotTargets = { handshake: 0.95, handshakeWarn: 0.92, loss: 0.01, lossWarn: 0.015, takeInSeconds: 30, takeInWarnSeconds: 45, retention: 0.8, retentionAtWeek: 8 };

describe('the pilot, against the compendium’s targets', () => {
  it('reads the handshake rate: on target from 95%, a warning from 92%', () => {
    expect([0.97, 0.95, 0.93, 0.92, 0.9, undefined].map((r) => handshakeStanding(r, TG))).toEqual(['ok', 'ok', 'warn', 'warn', 'danger', 'none']);
  });

  it('reads the loss rate: under 1% on target, to 1.5% a warning', () => {
    expect([0, 0.0099, 0.01, 0.015, 0.016, undefined].map((r) => lossStanding(r, TG))).toEqual(['ok', 'ok', 'warn', 'warn', 'danger', 'none']);
  });

  it('reads the take-in time: under 30 s on target, to 45 s a warning', () => {
    expect([12, 29.9, 30, 45, 46, undefined].map((s) => takeInStanding(s, TG))).toEqual(['ok', 'ok', 'warn', 'warn', 'danger', 'none']);
  });

  it('judges shop retention only from week 8, as the compendium does', () => {
    expect(retentionStanding({ pilotWeek: 3, original: 3, active: 1, rate: 0.333 }, TG)).toBe('none');
    expect(retentionStanding({ pilotWeek: 8, original: 3, active: 3, rate: 1 }, TG)).toBe('ok');
    expect(retentionStanding({ pilotWeek: 9, original: 5, active: 3, rate: 0.6 }, TG)).toBe('danger');
    expect(retentionStanding(undefined, TG)).toBe('none');
  });

  it('says a share and a time as people say them, and a dash where nothing was measured', () => {
    expect([pct(0.9643), pct(1), pct(undefined)]).toEqual(['96.4%', '100%', '—']);
    expect([seconds(27.6, t), seconds(undefined, t)]).toEqual(['28 s', '—']);
  });
});

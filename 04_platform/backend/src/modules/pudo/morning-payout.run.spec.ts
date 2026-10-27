import type { EntityService } from '../../foundation/entity/entity.service';
import { sameSigner } from '../../foundation/entity/same-person';
import type { PayoutService } from '../../foundation/payouts/payout.service';
import { MORNING_RUN_SIGNER, MorningPayoutRun } from './morning-payout.run';

/**
 * THE MORNING PAYOUT RUN (the user, 2026-10-27: "Morning run, one approves"): raised by the system at 06:00 on each company's
 * own clock, once a day — and the system is not a person, so one member of staff may approve what it raised.
 */
describe('the morning payout run', () => {
  const at = (iso: string) => Date.parse(iso);
  const make = (sisters: Array<{ entityId: string; jurisdiction: string }>) => {
    const runFor = jest.fn(() => ({ day: 'x', raised: [{}], skipped: [] }));
    const run = new MorningPayoutRun({ sisters: () => sisters } as unknown as EntityService, { runFor } as unknown as PayoutService);
    return { run, runFor };
  };

  it('raises each company’s run once its own morning has come — once a day, by the system', () => {
    const { run, runFor } = make([{ entityId: 'ent_ke_mr1', jurisdiction: 'KE' }]);
    // 05:50 in Nairobi (UTC+3): not yet.
    expect(run.tick(at('2026-10-28T02:50:00Z'))).toEqual([]);
    expect(runFor).not.toHaveBeenCalled();
    // 06:05 in Nairobi: raised, by the morning run.
    expect(run.tick(at('2026-10-28T03:05:00Z'))).toEqual([{ entityId: 'ent_ke_mr1', day: '2026-10-28', raised: 1, skipped: 0 }]);
    expect(runFor).toHaveBeenCalledWith('ent_ke_mr1', at('2026-10-28T03:05:00Z'), MORNING_RUN_SIGNER);
    // Later the same day: not again.
    expect(run.tick(at('2026-10-28T09:00:00Z'))).toEqual([]);
    expect(runFor).toHaveBeenCalledTimes(1);
    // The next morning: again.
    expect(run.tick(at('2026-10-29T03:10:00Z'))).toHaveLength(1);
    expect(run.lastRanOn('ent_ke_mr1')).toBe('2026-10-29');
  });

  it('a run that fails is looked at by a person, not raised again every ten minutes', () => {
    const { run, runFor } = make([{ entityId: 'ent_ke_mr2', jurisdiction: 'KE' }]);
    runFor.mockImplementationOnce(() => {
      throw new Error('books unavailable');
    });
    expect(run.tick(at('2026-11-02T04:00:00Z'))).toEqual([]);
    expect(run.tick(at('2026-11-02T04:10:00Z'))).toEqual([]);
    expect(runFor).toHaveBeenCalledTimes(1);
  });

  it('the system is not a person: one member of staff may approve what it raised', () => {
    expect(sameSigner(MORNING_RUN_SIGNER, { name: 'Achieng Otieno', key: 'rk_staff_1' })).toBe(false);
    expect(sameSigner(MORNING_RUN_SIGNER, { name: 'Achieng', key: 'typed:Achieng' })).toBe(false);
  });
});

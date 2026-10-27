import type { EntityService } from '../../foundation/entity/entity.service';
import type { OperatorAccountService } from '../../foundation/entity/operator-account.service';
import type { MailService } from '../../foundation/mail/mail.service';
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

  it('a run with payouts in it is emailed to every member of staff who holds the money role — a run with none, to nobody', () => {
    const sent: Array<{ to: string; params: Record<string, unknown> }> = [];
    const mail = { send: jest.fn(async (_t: string, to: { address: string }, params: Record<string, unknown>) => (sent.push({ to: to.address, params }), true)) } as unknown as MailService;
    const staff = { list: () => [
      { email: 'amina@sbg.example', name: 'Amina', roles: ['money', 'support'] },
      { email: 'otieno@sbg.example', name: 'Otieno', roles: ['support'] },
      { email: 'baraka@sbg.example', name: 'Baraka', roles: ['money'] },
    ] } as unknown as OperatorAccountService;
    const runFor = jest.fn(() => ({ day: 'x', raised: [{ amount: 1200 }, { amount: 350.5 }], skipped: [{}] }));
    const run = new MorningPayoutRun({ sisters: () => [{ entityId: 'ent_ke_mr3', jurisdiction: 'KE', name: 'SeeBuyGet Kenya', currency: 'KES' }] } as unknown as EntityService, { runFor } as unknown as PayoutService, staff, mail);
    run.tick(at('2026-10-28T03:05:00Z'));
    expect(sent.map((s) => s.to)).toEqual(['amina@sbg.example', 'baraka@sbg.example']);
    expect(sent[0].params).toEqual({ company: 'SeeBuyGet Kenya', day: '2026-10-28', count: 2, total: 'KES 1,550.50', skipped: 1 });
    expect((mail.send as jest.Mock).mock.calls[0][0]).toBe('payout-run-waiting');
    // The next morning, nothing to pay: nobody is emailed.
    runFor.mockImplementationOnce(() => ({ day: 'y', raised: [], skipped: [] }));
    run.tick(at('2026-10-29T03:05:00Z'));
    expect(sent).toHaveLength(2);
  });

  it('the system is not a person: one member of staff may approve what it raised', () => {
    expect(sameSigner(MORNING_RUN_SIGNER, { name: 'Achieng Otieno', key: 'rk_staff_1' })).toBe(false);
    expect(sameSigner(MORNING_RUN_SIGNER, { name: 'Achieng', key: 'typed:Achieng' })).toBe(false);
  });
});

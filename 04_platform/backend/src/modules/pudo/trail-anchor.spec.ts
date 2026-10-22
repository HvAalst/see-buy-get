import { FabricLedgerAdapter } from '../../foundation/ledger/fabric-ledger.adapter';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import type { MailService } from '../../foundation/mail/mail.service';
import { MAIL_TEMPLATES } from '../../foundation/mail/mail.templates';
import { renderDocument } from '../../foundation/mail/mail.blocks';
import { TrailAnchorService } from './trail-anchor.service';

/**
 * Round 40 — THE TRAIL ANCHORED OUTSIDE OUR DATABASE (the user: "Daily to an auditor"): the chain's head mailed once a day to
 * an address two members of staff named, kept here, and an auditor's copy checked against the chain as it stands.
 */
describe('the trail, anchored outside our database', () => {
  const amina = { operatorId: 'opr_a', name: 'Amina Otieno' };
  const brian = { operatorId: 'opr_b', name: 'Brian Kamau' };
  const day = (iso: string) => Date.parse(iso);

  function harness(delivers = false) {
    process.env.GLOS_PERSIST = 'off';
    const adapter = new FabricLedgerAdapter();
    const ledger = new LedgerService(adapter);
    const sent: Array<{ template: string; to: string; params: Record<string, unknown> }> = [];
    const mail = {
      send: async (template: string, to: { address: string }, params: Record<string, unknown>) => {
        sent.push({ template, to: to.address, params });
        return true;
      },
      delivers: () => delivers,
    } as unknown as MailService;
    const svc = new TrailAnchorService(ledger, mail);
    return { svc, ledger, adapter, sent };
  }
  const refused = async (fn: () => unknown) => {
    try {
      await fn();
    } catch (e) {
      return (e as { getResponse(): { code: string } }).getResponse().code;
    }
    return null;
  };

  describe('the auditor’s address', () => {
    it('is asked for by one member of staff and counts only once ANOTHER approves — the new address told', async () => {
      const { svc, sent } = harness();
      expect(svc.propose(' Audit@Example.com ', amina).proposal).toMatchObject({ address: 'audit@example.com', by: 'Amina Otieno', mine: true });
      expect(svc.view(brian).proposal?.mine).toBe(false);
      expect(svc.view().auditor).toBeUndefined();
      expect(await refused(() => svc.decide(true, amina))).toBe('FORBIDDEN');
      const v = await svc.decide(true, brian, undefined, day('2026-10-22T15:40:00Z'));
      expect(v.auditor).toMatchObject({ address: 'audit@example.com', proposedBy: 'Amina Otieno', approvedBy: 'Brian Kamau' });
      expect(v.proposal).toBeUndefined();
      expect(sent).toEqual([{ template: 'trail-auditor-named', to: 'audit@example.com', params: expect.objectContaining({ proposedBy: 'Amina Otieno', approvedBy: 'Brian Kamau', nextAt: '2026-10-22T15:40:00.000Z' }) }]); // nothing went today yet: the next look sends it
    });

    it('tells the address it had when it moves — the one thing somebody hiding a change would want to move', async () => {
      const { svc, sent } = harness();
      svc.propose('audit@example.com', amina);
      await svc.decide(true, brian);
      svc.propose('audit@another.example', brian);
      await svc.decide(true, amina);
      expect(sent.map((s) => [s.template, s.to])).toEqual([
        ['trail-auditor-named', 'audit@example.com'],
        ['trail-auditor-changed', 'audit@example.com'],
        ['trail-auditor-named', 'audit@another.example'],
      ]);
    });

    it('is declined with a reason; one change waits at a time; the same address is no change', async () => {
      const { svc } = harness();
      expect(await refused(() => svc.propose('not an address', amina))).toBe('VALIDATION_FAILED');
      svc.propose('audit@example.com', amina);
      expect(await refused(() => svc.propose('other@example.com', brian))).toBe('INVALID_STATE');
      expect(await refused(() => svc.decide(false, brian, '  '))).toBe('REASON_REQUIRED');
      expect((await svc.decide(false, brian, 'We have not agreed this auditor yet')).proposal).toBeUndefined();
      expect(await refused(() => svc.decide(true, brian))).toBe('INVALID_STATE');
      svc.propose('audit@example.com', amina);
      await svc.decide(true, brian);
      expect(await refused(() => svc.propose('AUDIT@example.com', brian))).toBe('INVALID_STATE');
    });
  });

  describe('the daily head', () => {
    it('goes once a day, from a few minutes after midnight UTC, with the chain’s height and newest link — and is kept', async () => {
      const { svc, ledger, sent } = harness();
      svc.propose('audit@example.com', amina);
      await svc.decide(true, brian);
      sent.length = 0;
      ledger.anchor({ a: 1 });
      const second = ledger.anchor({ a: 2 });
      expect(await svc.sweep(day('2026-10-23T00:04:00Z'))).toBeUndefined(); // not yet
      const kept = await svc.sweep(day('2026-10-23T00:06:00Z'));
      expect(kept).toMatchObject({ date: '2026-10-23', height: 2, txId: second.txId, whole: true, to: 'audit@example.com', mailed: true });
      expect(sent).toEqual([{ template: 'trail-head', to: 'audit@example.com', params: { date: '2026-10-23', height: 2, txId: second.txId, whole: true } }]);
      // Not twice in a day.
      ledger.anchor({ a: 3 });
      expect(await svc.sweep(day('2026-10-23T18:00:00Z'))).toBeUndefined();
      expect(sent).toHaveLength(1);
      // A server down at midnight sends when it is back.
      expect(await svc.sweep(day('2026-10-24T09:30:00Z'))).toMatchObject({ date: '2026-10-24', height: 3 });
      expect(svc.view(undefined, day('2026-10-24T09:31:00Z')).nextAt).toBe('2026-10-25T00:05:00.000Z');
    });

    it('is kept, saying it went to nobody, while no auditor is named', async () => {
      const { svc, sent } = harness();
      expect(await svc.sweep(day('2026-10-23T01:00:00Z'))).toMatchObject({ date: '2026-10-23', height: 0, txId: '', mailed: false });
      expect((await svc.sweep(day('2026-10-24T01:00:00Z')))?.to).toBeUndefined();
      expect(sent).toEqual([]);
    });

    it('says, on every day kept, whether the chain still gives the same link at its height', async () => {
      const { svc, ledger, adapter } = harness();
      ledger.anchor({ a: 1 });
      ledger.anchor({ a: 2 });
      await svc.sweep(day('2026-10-23T01:00:00Z'));
      expect(svc.view().heads).toEqual([expect.objectContaining({ date: '2026-10-23', stillMatches: true })]);
      // Somebody rewrites the first link and works every id after it out again: the chain is "whole", and the day says no.
      const store = (adapter as unknown as { store: Map<string, { hash: string; txId: string; blockHeight: number; prev: string }> }).store;
      const first = [...store.values()].find((e) => e.blockHeight === 1)!;
      store.delete(first.hash);
      store.set('f'.repeat(64), { ...first, hash: 'f'.repeat(64) });
      expect(svc.view().heads[0].stillMatches).toBe(false);
    });
  });

  describe('an auditor’s copy', () => {
    it('matches while nothing up to its link has changed; another link later changes nothing', async () => {
      const { svc, ledger } = harness();
      ledger.anchor({ a: 1 });
      const two = ledger.anchor({ a: 2 });
      ledger.anchor({ a: 3 });
      expect(svc.check(2, two.txId.toUpperCase())).toMatchObject({ height: 2, match: true });
      expect(svc.check(2, 'a'.repeat(64))).toMatchObject({ match: false, txId: two.txId });
      expect(svc.check(9, two.txId)).toMatchObject({ match: false, why: expect.stringMatching(/no link at that height/) });
    });

    it('is read out as a height and the 64 letters and digits, or refused', async () => {
      const { svc } = harness();
      expect(await refused(() => svc.check(0, 'a'.repeat(64)))).toBe('VALIDATION_FAILED');
      expect(await refused(() => svc.check(2, 'abc'))).toBe('VALIDATION_FAILED');
    });
  });

  it('writes its three emails in words an auditor can keep', () => {
    for (const id of ['trail-head', 'trail-auditor-named', 'trail-auditor-changed'] as const) {
      const t = MAIL_TEMPLATES[id];
      const doc = (t.build as (p: unknown) => Parameters<typeof renderDocument>[0])(t.sample);
      expect(doc.subject.length).toBeGreaterThan(10);
      expect(doc.reason).toMatch(/two members of SeeBuyGet staff|received the SeeBuyGet trail/);
    }
  });
});

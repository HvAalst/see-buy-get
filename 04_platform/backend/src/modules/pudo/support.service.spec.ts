import { SUPPORT_KEPT_DAYS, SupportService } from './support.service';

/*
 * WRITING TO US — what is kept, and for how long. A closed message, and the person's address with it, is deleted once its
 * keeping is over; one that is open or answered is never deleted by time — somebody is still owed, or may write back.
 */
describe('a message to us, kept and then let go', () => {
  const DAY = 86_400_000;
  const t0 = Date.parse('2026-10-22T10:00:00Z');
  const write = (s: SupportService, email: string, now: number) => s.write({ category: 'other', email, message: 'A question about my account, please.' }, now);

  it('deletes a closed message, address and all, once its keeping is over — and not a day before', async () => {
    const s = new SupportService();
    const { reference } = await write(s, 'kept@example.com', t0);
    s.close(reference, 'Amina', t0);
    expect(s.inbox('closed', t0 + SUPPORT_KEPT_DAYS * DAY).items.map((m) => m.reference)).toContain(reference);
    const after = s.inbox('closed', t0 + (SUPPORT_KEPT_DAYS + 1) * DAY);
    expect(after.items.map((m) => m.reference)).not.toContain(reference);
    expect(JSON.stringify(after)).not.toContain('kept@example.com');
  });

  it('never deletes an open or answered message by time', async () => {
    const s = new SupportService();
    const open = (await write(s, 'open@example.com', t0)).reference;
    const answered = (await write(s, 'answered@example.com', t0)).reference;
    await s.answer(answered, 'Here is the answer.', 'Brian', t0);
    const later = t0 + (SUPPORT_KEPT_DAYS * 3) * DAY;
    expect(s.inbox('open', later).items.map((m) => m.reference)).toContain(open);
    expect(s.inbox('answered', later).items.map((m) => m.reference)).toContain(answered);
  });

  it('gives references that can be read out: SBG- and six letters and digits, never 0, O, 1 or I', async () => {
    const s = new SupportService();
    for (let i = 0; i < 40; i += 1) expect((await write(s, `r${i}@example.com`, t0)).reference).toMatch(/^SBG-[A-HJ-NP-Z2-9]{6}$/);
  });
});

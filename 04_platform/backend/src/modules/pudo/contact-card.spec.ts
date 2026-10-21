import { Test } from '@nestjs/testing';
import { ContactCardService } from './contact-card.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { DidService } from '../../foundation/did/did.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { EventBus } from '../../foundation/events/event-bus.service';

/**
 * A company's own entry — how to reach them.
 *
 * The gap it closes was self-inflicted: the yard finder told a haulier the next step was a telephone call
 * and printed no telephone number, and the agent directory had the same hole. So what these tests defend
 * is that it is a MERGE (correcting a number must not drop the website), that shapes are checked and
 * choices never are, and that it stays one card rather than a copy per directory.
 */
describe('how to reach a company', () => {
  let cards: ContactCardService;
  let entities: EntityService;
  let yardId: string;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ContactCardService, EntityService, DidService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    cards = moduleRef.get(ContactCardService);
    yardId = entities.createCompany({ kind: 'partner', jurisdiction: 'ke', name: 'Athi River Empties' }, 'Amina').entityId;
  });

  it('is written by the company, with their name and the date on it', () => {
    const card = cards.set(yardId, { contactName: 'Ask for Grace at the gate', phone: '+254 712 345 678', hours: '6am–6pm, closed Sunday' }, 'Grace');
    expect(card).toMatchObject({ entityId: yardId, contactName: 'Ask for Grace at the gate', phone: '+254 712 345 678', saidBy: 'Grace' });
    expect(cards.reachable(yardId)).toBe(true);
  });

  it('merges, so correcting the number does not drop the website', () => {
    cards.set(yardId, { phone: '+254712345678', website: 'https://athiriver.example', email: 'gate@athiriver.example' }, 'Grace');
    const after = cards.set(yardId, { phone: '+254799999999' }, 'Grace');
    // An entry that silently loses half of itself every time somebody fixes a typo is how a directory
    // rots. Absent means unchanged; that is the whole reason this is a merge.
    expect(after).toMatchObject({ phone: '+254799999999', website: 'https://athiriver.example', email: 'gate@athiriver.example' });
    // And an EMPTY STRING clears, which is the one thing a merge cannot otherwise express.
    expect(cards.set(yardId, { website: '' }, 'Grace').website).toBeUndefined();
  });

  it('checks the shape and never the choice', () => {
    expect(() => cards.set(yardId, { phone: 'ring the yard' }, 'Grace')).toThrow(/digits/);
    expect(() => cards.set(yardId, { email: 'grace at athiriver' }, 'Grace')).toThrow(/shape of an email/);
    // http or https only: anything else on a page a stranger will click is a link we should not print —
    // and we never fetch it to find out what it is.
    expect(() => cards.set(yardId, { website: 'javascript:alert(1)' }, 'Grace')).toThrow(/http/);
    expect(() => cards.set(yardId, { website: 'athiriver.example' }, 'Grace')).toThrow(/http/);
    // A number we have no way to check is kept exactly as given: the shape is ours, the choice is theirs.
    expect(cards.set(yardId, { phone: '020-555-0199' }, 'Grace').phone).toBe('020-555-0199');
  });

  it('says plainly that nobody verified any of it', () => {
    cards.set(yardId, { phone: '+254712345678' }, 'Grace');
    // The sentence travels with the card on every screen that shows it, for the same reason an agent's
    // advertisement carries one: a directory entry reads as endorsed unless it says otherwise.
    expect(cards.of(yardId)).toBeDefined();
  });

  it('knows an empty entry from a full one', () => {
    expect(cards.reachable(yardId)).toBe(false);
    cards.set(yardId, { contactName: 'Grace' }, 'Grace');
    // A name and no way to reach them is not reachable, and a finder that showed it as a contact would be
    // telling a haulier to go and ring a person with no number.
    expect(cards.reachable(yardId)).toBe(false);
    cards.set(yardId, { phone: '+254712345678' }, 'Grace');
    expect(cards.reachable(yardId)).toBe(true);
  });

  it('keeps the desk a held driver rings on the company’s own card, and out of every directory (round 39)', () => {
    cards.set(yardId, { phone: '+254712345678', deskPhone: '+254 20 765 4321' }, 'Grace');
    // The company's own screen reads it, and so does the driver's load; a directory or a public page never does.
    expect(cards.own(yardId)?.deskPhone).toBe('+254 20 765 4321');
    expect(cards.deskOf(yardId)).toBe('+254 20 765 4321');
    expect(cards.of(yardId)).toMatchObject({ phone: '+254712345678' });
    expect(cards.of(yardId)).not.toHaveProperty('deskPhone');
    // Its shape is checked like any number; an empty string clears it, and the rest of the card stays.
    expect(() => cards.set(yardId, { deskPhone: 'ask at the border' }, 'Grace')).toThrow(/desk’s number is digits/);
    const cleared = cards.set(yardId, { deskPhone: '' }, 'Grace');
    expect(cleared.deskPhone).toBeUndefined();
    expect(cleared.phone).toBe('+254712345678');
    expect(cards.deskOf(yardId)).toBeUndefined();
  });

  it('refuses a company that does not exist', () => {
    expect(() => cards.set('partner-ke-nobody', { phone: '+254712345678' }, 'Grace')).toThrow();
  });
});

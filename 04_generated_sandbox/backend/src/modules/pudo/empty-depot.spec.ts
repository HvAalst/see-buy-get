import { Test } from '@nestjs/testing';
import { EmptyDepotService } from './empty-depot.service';
import { ContainerBoxService } from './container-box.service';
import { ContactCardService } from './contact-card.service';
import { DispatchService } from './dispatch.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { DidService } from '../../foundation/did/did.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { EventBus } from '../../foundation/events/event-bus.service';

/**
 * Y4 — a yard that wants to be findable, and what is on its way to it.
 *
 * What these tests defend is the seam. The two sources are never added together, the position is the
 * yard's own words and never ours, and the thing we actually contribute to somebody's planning is the
 * INBOUND list — which is the half a gate man with a notebook cannot have. There is no slot, no row and
 * no tier anywhere in here, and that is the design rather than an omission.
 */
describe('a yard that says it holds empties', () => {
  let depots: EmptyDepotService;
  let boxes: ContainerBoxService;
  let entities: EntityService;
  let yardId: string;
  let otherYardId: string;
  /** The legs that name a depot, and where each has got to. */
  let legs: Record<string, { code: string; emptyRun?: boolean; pickedUpAt?: string; deliveredAt?: string }>;

  beforeEach(async () => {
    legs = {};
    const moduleRef = await Test.createTestingModule({
      providers: [
        EmptyDepotService,
        ContactCardService,
        ContainerBoxService,
        EntityService,
        DidService,
        LedgerService,
        EventBus,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        {
          provide: DispatchService,
          useValue: {
            requireFreightPublic: (freightId: string) => {
              if (!legs[freightId]) throw new Error(`no such freight ${freightId}`);
              return { freightId, ...legs[freightId] };
            },
          },
        },
      ],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    depots = moduleRef.get(EmptyDepotService);
    boxes = moduleRef.get(ContainerBoxService);
    yardId = entities.createCompany({ kind: 'partner', jurisdiction: 'ke', name: 'Athi River Empties' }, 'Amina').entityId;
    otherYardId = entities.createCompany({ kind: 'partner', jurisdiction: 'ke', name: 'Mombasa Road Yard' }, 'Amina').entityId;
  });

  /** A box whose leg home names this yard, at whatever stage the test wants it. */
  const heading = (containerNo: string, entityId: string, stage: 'posted' | 'moving' | 'arrived', freightId = `frt_${containerNo}`) => {
    legs[freightId] = {
      code: `FRT-${containerNo.slice(-3)}`,
      emptyRun: true,
      ...(stage === 'moving' || stage === 'arrived' ? { pickedUpAt: new Date(Date.now() - 86_400_000).toISOString() } : {}),
      ...(stage === 'arrived' ? { deliveredAt: new Date().toISOString() } : {}),
    };
    boxes.see(containerNo, { returnFreightId: freightId, returnDepot: 'Athi River Empties', returnDepotEntityId: entityId });
  };

  it('is a company that says so, and says it in its own words', () => {
    const depot = depots.declare(yardId, { placeLabel: 'Athi River empty yard', country: 'ke', note: 'Gate open 6am to 6pm' }, 'Amina');
    expect(depot).toMatchObject({ entityId: yardId, placeLabel: 'Athi River empty yard', country: 'KE', saidBy: 'Amina' });
    // Never checked, because we run no yards and have nothing to check it against — the same as an
    // agent's advertisement, and the same as an importer's free days.
    expect(() => depots.declare(yardId, { placeLabel: '  ', country: 'KE' }, 'Amina')).toThrow(/what the yard is called/);
    expect(() => depots.declare(yardId, { placeLabel: 'X', country: 'Kenya' }, 'Amina')).toThrow(/two-letter/);
  });

  it('records the position the yard writes, and never assigns one', () => {
    depots.declare(yardId, { placeLabel: 'Athi River empty yard', country: 'KE' }, 'Amina');
    const register = depots.say(yardId, 'csqu3054383', { position: 'C-12, third row' }, 'Gate');
    expect(register.said).toHaveLength(1);
    expect(register.said[0]).toMatchObject({ containerNo: 'CSQU3054383', position: 'C-12, third row', by: 'Gate' });
    // Nothing anywhere decides where a box goes. Recording a position and assigning one are different
    // jobs, and only the first is honestly ours: we have never seen this yard.
    expect(JSON.stringify(register)).not.toMatch(/slot|tier|stack|assign/i);
    // The number is checked like any other, because a register keyed to a typo is a box nobody can find.
    expect(() => depots.say(yardId, 'CSQU3054384', {}, 'Gate')).toThrow(/check digit/);
  });

  it('treats saying it twice as a correction, not a second box', () => {
    depots.declare(yardId, { placeLabel: 'Athi River empty yard', country: 'KE' }, 'Amina');
    depots.say(yardId, 'CSQU3054383', { position: 'C-12' }, 'Gate');
    const after = depots.say(yardId, 'CSQU3054383', { position: 'A-01, moved this morning' }, 'Gate');
    expect(after.said).toHaveLength(1);
    expect(after.said[0].position).toBe('A-01, moved this morning');
    expect(depots.gone(yardId, 'csqu3054383').said).toHaveLength(0);
  });

  it('keeps what the yard SAYS apart from what we DERIVED, and never adds them up', () => {
    depots.declare(yardId, { placeLabel: 'Athi River empty yard', country: 'KE' }, 'Amina');
    heading('CSQU3054383', yardId, 'arrived');
    heading('MSCU1234566', yardId, 'arrived');
    depots.say(yardId, 'CSQU3054383', { position: 'C-12' }, 'Gate');
    depots.say(yardId, 'TGHU7654320', {}, 'Gate');

    const register = depots.registerOf(yardId);
    expect(register.said.map((s) => s.containerNo)).toEqual(['CSQU3054383', 'TGHU7654320']);
    expect(register.derived.map((d) => d.containerNo)).toEqual(['CSQU3054383', 'MSCU1234566']);
    // Two of them, one in both, and no total anywhere: the yard's claim can be stale and our derivation
    // is incomplete by construction, so a single number would be a false inventory.
    expect(register.inBoth).toBe(1);
    expect(register).not.toHaveProperty('total');
    expect(register.basis).toContain('never added together');
  });

  /**
   * THE HALF THAT IS ACTUALLY OURS. "Yard management is mainly about smart planning" — and the input that
   * planning needs, which a yard cannot get for itself, is what is coming and when. We have it because
   * the leg home is on the board.
   */
  it('tells the yard what is on its way, which is the planning input it cannot get', () => {
    depots.declare(yardId, { placeLabel: 'Athi River empty yard', country: 'KE' }, 'Amina');
    heading('CSQU3054383', yardId, 'arrived');
    heading('MSCU1234566', yardId, 'moving');
    heading('TGHU7654320', yardId, 'posted');

    const register = depots.registerOf(yardId);
    expect(register.derived.map((d) => d.containerNo)).toEqual(['CSQU3054383']);
    expect(register.inbound.map((i) => `${i.containerNo}:${i.state}`)).toEqual(['MSCU1234566:moving', 'TGHU7654320:posted']);
    // Empty or not is on the row, because a yard plans differently for an empty than for one that still
    // has to be stripped. That is as far as the planning help goes, deliberately.
    expect(register.inbound.every((i) => i.empty)).toBe(true);
  });

  it('puts a box on the yard that was NAMED, never on one that matches a label', () => {
    depots.declare(yardId, { placeLabel: 'Athi River empty yard', country: 'KE' }, 'Amina');
    depots.declare(otherYardId, { placeLabel: 'Athi River empty yard', country: 'KE' }, 'Amina');
    heading('CSQU3054383', otherYardId, 'arrived');
    // Two yards calling themselves the same thing is ordinary, and a guess would put somebody else's box
    // on somebody else's register.
    expect(depots.registerOf(yardId).derived).toHaveLength(0);
    expect(depots.registerOf(otherYardId).derived).toHaveLength(1);
  });

  it('finds yards alphabetically, never ranked, and counts without numbering', () => {
    depots.declare(otherYardId, { placeLabel: 'Mombasa Road yard', country: 'KE' }, 'Amina');
    depots.declare(yardId, { placeLabel: 'Athi River empty yard', country: 'KE' }, 'Amina');
    heading('CSQU3054383', yardId, 'arrived');
    depots.say(yardId, 'MSCU1234566', {}, 'Gate');

    const found = depots.list({ country: 'ke' });
    expect(found.map((d) => d.placeLabel)).toEqual(['Athi River empty yard', 'Mombasa Road yard']);
    const athi = found[0];
    // Counts travel; the numbers do not. Which boxes stand in a yard is a map of another company's
    // assets, and a haulier deciding where to drive needs the yard, not its inventory.
    expect(athi).toMatchObject({ saidCount: 1, derivedCount: 1, inboundCount: 0 });
    expect(JSON.stringify(found)).not.toContain('CSQU3054383');
    expect(depots.list({ country: 'ET' })).toHaveLength(0);
    expect(depots.list({ text: 'athi' }).map((d) => d.entityId)).toEqual([yardId]);
  });

  it('drops out of the finder when it closes, and keeps what it held', () => {
    depots.declare(yardId, { placeLabel: 'Athi River empty yard', country: 'KE' }, 'Amina');
    depots.say(yardId, 'CSQU3054383', { position: 'C-12' }, 'Gate');
    depots.close(yardId, 'Amina');
    expect(depots.list()).toHaveLength(0);
    // Marked, never deleted: it held those boxes last month, and the register still says so.
    expect(depots.registerOf(yardId)).toMatchObject({ closed: true });
    expect(depots.registerOf(yardId).said).toHaveLength(1);
    // And a yard that comes back is the same yard, with its boxes where it left them.
    depots.declare(yardId, { placeLabel: 'Athi River empty yard', country: 'KE' }, 'Amina');
    expect(depots.registerOf(yardId)).toMatchObject({ closed: false });
    expect(depots.registerOf(yardId).said).toHaveLength(1);
  });

  it('refuses a register for a company that never said it holds empties', () => {
    expect(() => depots.registerOf(otherYardId)).toThrow(/has not said it holds empties/);
    expect(() => depots.say(otherYardId, 'CSQU3054383', {}, 'Gate')).toThrow(/has not said it holds empties/);
  });
});

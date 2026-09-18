import { Test } from '@nestjs/testing';
import { ContainerClockService } from './container-clock.service';
import { ContainerBoxService } from './container-box.service';
import { DispatchService } from './dispatch.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { DidService } from '../../foundation/did/did.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { EventBus } from '../../foundation/events/event-bus.service';
import { NotificationService } from './notification.service';

const DAY = 86_400_000;

/**
 * Y1's other half — TELL THEM BEFORE THE DATE.
 *
 * A detention charge that first appears on an invoice is the two-weeks-at-customs story in different
 * clothes: the cost was knowable and nobody said it. So what these tests defend is the warning going to
 * BOTH parties (the agent who owes the return can act; the importer who pays cannot be left to find out),
 * going out ONCE, and never mentioning money.
 */
describe('warning about a box before its date, and never about what it costs', () => {
  let clocks: ContainerClockService;
  let boxes: ContainerBoxService;
  let entities: EntityService;
  let sent: Array<{ did: string; kind: string; title: string; body: string }>;
  let pickups: Record<string, string>;
  let importerId: string;
  let agentId: string;

  const NO = 'CSQU3054383';

  beforeEach(async () => {
    sent = [];
    pickups = {};
    const moduleRef = await Test.createTestingModule({
      providers: [
        ContainerClockService,
        ContainerBoxService,
        EntityService,
        DidService,
        LedgerService,
        EventBus,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        { provide: DispatchService, useValue: { requireFreightPublic: (freightId: string) => ({ freightId, pickedUpAt: pickups[freightId] }) } },
        {
          provide: NotificationService,
          useValue: {
            notify: (did: string, payload: { kind: string; title: string; body: string }) => {
              sent.push({ did, ...payload });
              return Promise.resolve({ id: `ntf_${sent.length}` });
            },
          },
        },
      ],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    boxes = moduleRef.get(ContainerBoxService);
    clocks = moduleRef.get(ContainerClockService);
    importerId = entities.createCompany({ kind: 'partner', jurisdiction: 'et', name: 'Yukel Trading' }, 'Amina').entityId;
    agentId = entities.createCompany({ kind: 'partner', jurisdiction: 'et', name: 'Addis Clearing' }, 'Amina').entityId;
  });

  /** A box out of the gate `daysOut` ago, with a claim of `free` days on it. */
  const boxOut = (daysOut: number, free: number, now: number) => {
    pickups['frt_1'] = new Date(now - daysOut * DAY).toISOString();
    boxes.see(
      NO,
      { importId: 'imp_1', importCode: 'IMP-001', importerEntityId: importerId, owedByEntityId: agentId, owedByName: 'Addis Clearing', roadFreightId: 'frt_1' },
      now,
    );
    if (free >= 0) boxes.claimFreeDays(NO, 'detention', free, { entityId: importerId, by: 'Hans' }, { importId: 'imp_1' }, now);
  };

  it('warns both the agent who owes the return and the importer who pays', async () => {
    const now = Date.now();
    boxOut(12, 14, now);
    expect(await clocks.sweep(now)).toBe(2);
    expect(new Set(sent.map((s) => s.did))).toEqual(new Set([entities.get(agentId).did, entities.get(importerId).did]));
    expect(sent[0].kind).toBe('box_due');
    expect(sent[0].title).toContain(NO);
    // The one who can act is named in the body, because a warning nobody owns is a warning nobody acts on.
    expect(sent[0].body).toContain('Addis Clearing booked the box');
    expect(sent[0].body).toContain('2 days of the 14 free days Hans recorded');
  });

  it('says nothing about money, overdue or not', async () => {
    const now = Date.now();
    boxOut(20, 14, now);
    await clocks.sweep(now);
    expect(sent).toHaveLength(2);
    expect(sent[0].title).toContain('past its free days');
    // We count days. What a day costs is in a contract we have never seen, and the sentence says so.
    expect(sent[0].body).toContain('between you and the line');
    for (const s of sent) expect(s.body).not.toMatch(/\$|USD|ETB|per day|amount|total/i);
  });

  it('warns once, and again only when the date itself moves', async () => {
    const now = Date.now();
    boxOut(12, 14, now);
    expect(await clocks.sweep(now)).toBe(2);
    // A second sweep an hour later says nothing: a reminder that repeats is one people learn to dismiss.
    expect(await clocks.sweep(now + 3_600_000)).toBe(0);
    // A CORRECTED claim moves the due date, and that is a different fact — so it earns a fresh warning.
    boxes.claimFreeDays(NO, 'detention', 13, { entityId: importerId, by: 'Hans' }, { importId: 'imp_1' }, now);
    expect(await clocks.sweep(now + 7_200_000)).toBe(2);
  });

  it('says nothing at all about a box nobody has claimed free days for', async () => {
    const now = Date.now();
    boxOut(40, -1, now);
    // Forty days out and no date to count to. Warning anybody here would mean inventing the free days,
    // and the screen already says plainly that nobody has stated them.
    expect(await clocks.sweep(now)).toBe(0);
  });

  it('says nothing about a box that came back, or one that was sold', async () => {
    const now = Date.now();
    boxOut(20, 14, now);
    boxes.end(NO, 'returned', { where: 'Modjo depot' }, 'Selam', { importId: 'imp_1' }, now);
    expect(await clocks.sweep(now)).toBe(0);

    pickups['frt_2'] = new Date(now - 60 * DAY).toISOString();
    boxes.see('MSCU1234566', { importId: 'imp_2', importerEntityId: importerId, owedByEntityId: agentId, owedByName: 'Addis Clearing', roadFreightId: 'frt_2' }, now);
    boxes.claimFreeDays('MSCU1234566', 'detention', 7, { entityId: importerId, by: 'Hans' }, { importId: 'imp_2' }, now);
    boxes.end('MSCU1234566', 'bought', { note: 'Sold on' }, 'Hans', { importId: 'imp_2' }, now);
    // Containers are traded goods. A box that was sold owes nobody a return, so warning about it would be
    // the false alarm that teaches somebody to ignore the true one.
    expect(await clocks.sweep(now)).toBe(0);
  });
});

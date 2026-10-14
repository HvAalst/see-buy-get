import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ScoringService } from './scoring.service';
import { BadgeService } from './badge.service';
import { FraudService } from './fraud.service';
import { TransactionRegistry } from './transaction-registry.service';
import { ReputationStore } from './reputation-store.service';
import { RatingService } from './rating.service';
import { CredentialService } from '../../foundation/credentials/credential.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';

describe('M5 reputation flow', () => {
  let ratings: RatingService;
  let store: ReputationStore;
  let registry: TransactionRegistry;
  let core: OperationalStore;
  let credentials: CredentialService;

  const shipper = 'did:glos:shipper';
  const carrier = 'did:glos:carrier';

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RatingService, ReputationStore, ScoringService, BadgeService, FraudService, TransactionRegistry,
        CredentialService, OperationalStore, LedgerService, EventBus,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    ratings = moduleRef.get(RatingService);
    store = moduleRef.get(ReputationStore);
    registry = moduleRef.get(TransactionRegistry);
    core = moduleRef.get(OperationalStore);
    credentials = moduleRef.get(CredentialService);

    // A completed transaction (normally from match.confirmed + tracking.delivered).
    registry.register('S1', shipper, carrier);
    registry.markComplete('S1');
    // Carrier has an operational profile so the composite can be written back (feeds M3).
    core.upsert({ did: carrier, tier: 2, status: 'active', capabilities: [] });
  });

  it('verification-anchors ratings: only a participant in a completed txn, once (M5-021)', () => {
    expect(() => ratings.submit({ glosShipmentId: 'UNKNOWN', raterDid: shipper, onTime: 'yes' })).toThrow(BadRequestException);
    expect(() => ratings.submit({ glosShipmentId: 'S1', raterDid: 'did:glos:stranger', onTime: 'yes' })).toThrow(BadRequestException);

    ratings.submit({ glosShipmentId: 'S1', raterDid: shipper, onTime: 'yes', cargoCare: 'pristine' });
    expect(() => ratings.submit({ glosShipmentId: 'S1', raterDid: shipper, onTime: 'yes' })).toThrow(BadRequestException); // no double
  });

  it('updates the composite and writes it back to the Operational Core (feeds M3)', () => {
    ratings.submit({ glosShipmentId: 'S1', raterDid: shipper, onTime: 'yes', cargoCare: 'pristine', documentation: 'accurate', equipment: 'compliant', communication: 5 });
    const view = store.view(carrier);
    expect(view.composite).toBeGreaterThan(3.0);
    expect(view.explanation).toContain('Trust Score');
    // The score is now in the Operational Core where M3 reads it.
    expect(core.get(carrier)?.reputationScore).toBe(view.composite);
  });

  it('issues a trust badge VC once a dimension clears its threshold (M5-030)', () => {
    for (let i = 0; i < 3; i += 1) {
      registry.register(`SB${i}`, shipper, carrier);
      registry.markComplete(`SB${i}`);
      ratings.submit({ glosShipmentId: `SB${i}`, raterDid: shipper, onTime: 'yes' });
    }
    const view = store.view(carrier);
    expect(view.badges).toContain('Elite On-Time');
    expect(credentials.listForSubject(carrier, 'Elite On-Time').length).toBe(1);
  });

  it('hides toxic comments (M5-024) and supports private ratings (M5-022)', () => {
    ratings.submit({ glosShipmentId: 'S1', raterDid: shipper, onTime: 'yes', comment: 'you scam artist', private: true });
    const dash = store.dashboard(carrier);
    expect(dash.history[0].comment).toBeUndefined(); // hidden (toxic) + private
  });

  it('applies dispute outcomes to the correct dimension and escalates sanctions (M5-050/051/053)', () => {
    store.applyDispute(carrier, 'damage', true, 'crushed pallet');
    const view = store.view(carrier);
    expect(view.dimensions.cargoCare?.value).toBe(0); // damage → cargo care
    expect(view.disputeSummary.atFault).toBe(1);
    expect(view.sanction).toBe('training');
  });
});

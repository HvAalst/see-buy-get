import { Test } from '@nestjs/testing';
import { EntityService } from './entity.service';
import { DidService } from '../did/did.service';
import { LedgerService } from '../ledger/ledger.service';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { EventBus } from '../events/event-bus.service';
import { NETWORK_JURISDICTION, PLATFORM_FEE_PCT } from '../../modules/pudo/pudo.config';

describe('entities (the group and its sisters)', () => {
  let entities: EntityService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [EntityService, DidService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
  });

  it('seeds a group and a sister per operating jurisdiction, each with a real DID', () => {
    const group = entities.group();
    expect(group.kind).toBe('group');
    expect(group.did).toMatch(/^did:glos:/);

    const sisters = entities.sisters();
    expect(sisters.length).toBeGreaterThan(0);
    for (const s of sisters) {
      expect(s.did).toMatch(/^did:glos:/);
      expect(s.parentEntityId).toBe(group.entityId);
      expect(s.jurisdiction).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('gives Kenya a sister that settles in shillings', () => {
    const ke = entities.requireForJurisdiction('KE');
    expect(ke.kind).toBe('sister');
    expect(ke.currency).toBe('KES');
    expect(entities.requireForJurisdiction('ke').entityId).toBe(ke.entityId); // case-insensitive
  });

  it('has a sister for the jurisdiction this deployment operates in', () => {
    // Keeps the entity seed and the network's own config honest with each other without coupling them.
    expect(entities.forJurisdiction(NETWORK_JURISDICTION)).toBeDefined();
  });

  describe('the mother is isolated', () => {
    it('holds no custody and settles in no currency', () => {
      const group = entities.group();
      expect(entities.canHoldCustody(group.entityId)).toBe(false);
      expect(group.currency).toBeUndefined();
      expect(group.jurisdiction).toBeUndefined();
    });

    it('cannot be named as a party to a transaction', () => {
      // The whole point of the sister structure: an entity that is not registered in a jurisdiction must
      // never become a counterparty there, or one country's problem reaches every other company.
      expect(() => entities.requireTransacting(entities.group().entityId)).toThrow(/holding company/);
    });

    it('lets a sister transact, and lets it hold custody', () => {
      const ke = entities.requireForJurisdiction('KE');
      expect(entities.requireTransacting(ke.entityId).entityId).toBe(ke.entityId);
      expect(entities.canHoldCustody(ke.entityId)).toBe(true);
    });
  });

  it('refuses a jurisdiction with no daughter company rather than falling back to another', () => {
    // Silently settling a Dutch vendor through Nairobi would put revenue, tax and liability in the wrong
    // company — the same class of error as the missing KE currency, and far more expensive.
    expect(entities.forJurisdiction('NL')).toBeUndefined();
    expect(() => entities.requireForJurisdiction('NL')).toThrow(/No daughter company operates in NL/);
    expect(() => entities.requireForJurisdiction(undefined)).toThrow(/that jurisdiction/);
  });

  it('keeps an entity DID stable across re-seeds — other records point at it', () => {
    const before = entities.group().did;
    entities.seed();
    entities.seed();
    expect(entities.group().did).toBe(before);
    expect(entities.list().filter((e) => e.kind === 'group')).toHaveLength(1);
  });

  it('refuses to resolve an unknown entity', () => {
    expect(() => entities.get('sbg-zz')).toThrow(/No such entity/);
    expect(entities.find(undefined)).toBeUndefined();
  });

  describe('the three rate knobs', () => {
    const sister = () => entities.sisters()[0].entityId;

    it('a sister that has never touched them prices exactly as it always did', () => {
      // The whole point of shipping this without repricing anything: layers absent means margin is the
      // network default and the other two are zero.
      const r = entities.ratesFor(sister());
      expect(r).toMatchObject({ costOfRiskPct: 0, profitOnRiskPct: 0, marginPct: PLATFORM_FEE_PCT, totalPct: PLATFORM_FEE_PCT });
    });

    it('reads the OLD single knob as the margin it always was', () => {
      // `feePct` predates the layers. It is read as margin rather than migrated on write — a value that
      // rewrites itself the first time something reads it makes the record's history unreadable.
      entities.setFeePct(sister(), 0.05);
      const r = entities.ratesFor(sister());
      expect(r.marginPct).toBe(0.05);
      expect(r.totalPct).toBe(0.05);
    });

    it('ADDS the layers — it does not compound them', () => {
      // 5 + 5 + 5 applied in sequence is 15.76%. A knob whose effect an admin cannot predict in their head
      // is not a knob worth having.
      entities.setRates(sister(), { costOfRiskPct: 0.05, profitOnRiskPct: 0.05, marginPct: 0.05 });
      expect(entities.ratesFor(sister()).totalPct).toBe(0.15);
    });

    it('prices a lane differently without disturbing the rest', () => {
      // A letter through the shop network and a dedicated truck haul are different businesses carrying
      // different risk. Setting one must not silently reset the other.
      entities.setRates(sister(), { marginPct: 0.03 });
      entities.setRates(sister(), { lane: 'dedicated', profitOnRiskPct: 0.06 });

      expect(entities.ratesFor(sister(), 'dedicated')).toMatchObject({ profitOnRiskPct: 0.06, marginPct: 0.03, totalPct: 0.09 });
      expect(entities.ratesFor(sister(), 'pudo')).toMatchObject({ profitOnRiskPct: 0, marginPct: 0.03, totalPct: 0.03 });
      expect(entities.ratesFor(sister()).totalPct).toBe(0.03); // the default is untouched
    });

    it('resolves each layer independently, so a partial override keeps the rest', () => {
      // The trap: treating the lane override as a whole object would drop this sister's own 3% margin the
      // moment it set a cost of risk on one lane, and quietly reprice that lane to the network default.
      entities.setRates(sister(), { marginPct: 0.03, costOfRiskPct: 0.01 });
      entities.setRates(sister(), { lane: 'mdp', costOfRiskPct: 0.04 });
      expect(entities.ratesFor(sister(), 'mdp')).toMatchObject({ costOfRiskPct: 0.04, marginPct: 0.03 });
    });

    it('leaves unmentioned knobs alone, and clears one only when told to', () => {
      entities.setRates(sister(), { costOfRiskPct: 0.02, marginPct: 0.03 });
      entities.setRates(sister(), { costOfRiskPct: 0.04 }); // margin not mentioned
      expect(entities.ratesFor(sister())).toMatchObject({ costOfRiskPct: 0.04, marginPct: 0.03 });

      entities.setRates(sister(), { costOfRiskPct: null }); // explicitly back to the fallback
      expect(entities.ratesFor(sister()).costOfRiskPct).toBe(0);
    });

    it('bounds the SUM, not just each layer', () => {
      // Three innocent-looking numbers, each inside its own range, that together price a market out of
      // existence. The ceiling has to be on what the customer would actually be charged.
      expect(() => entities.setRates(sister(), { costOfRiskPct: 0.1, profitOnRiskPct: 0.1, marginPct: 0.1 })).toThrow(/ADD UP/);
      expect(() => entities.setRates(sister(), { marginPct: 0.9 })).toThrow(/between/);
    });

    it('does not apply a rejected rate', () => {
      // Validating a record we had already mutated would refuse the change and apply it at the same time.
      entities.setRates(sister(), { marginPct: 0.04 });
      expect(() => entities.setRates(sister(), { costOfRiskPct: 0.2, profitOnRiskPct: 0.2 })).toThrow();
      expect(entities.ratesFor(sister())).toMatchObject({ costOfRiskPct: 0, profitOnRiskPct: 0, marginPct: 0.04 });
    });
  });

  describe('the tax a sister collects', () => {
    const sister = () => entities.requireForJurisdiction('KE').entityId;

    it('charges nothing until somebody says otherwise', () => {
      // The one rate in this system that is not ours to choose. There is no network default worth having,
      // so the default is none — which is the honest state of a sister nobody has registered anywhere.
      expect(entities.taxFor(sister())).toMatchObject({ ratePct: 0, registration: undefined });
    });

    it('refuses a rate above zero from a sister that is not registered to collect one', () => {
      // Not an arithmetic guard. Charging tax you are not registered to collect is money taken from a
      // customer in the name of an authority that has never heard of you.
      expect(() => entities.setTax(sister(), { ratePct: 0.16 })).toThrow(/no tax registration/);
      expect(entities.taxFor(sister()).ratePct).toBe(0); // and the rejected rate is NOT sitting in the record
    });

    it('takes the rate and the authority to charge it in one act', () => {
      entities.setTax(sister(), { ratePct: 0.16, label: 'VAT', registration: 'P051234567X' });
      expect(entities.taxFor(sister())).toEqual({ ratePct: 0.16, label: 'VAT', registration: 'P051234567X' });
    });

    it('will not let a sister drop its registration by editing a different lane', () => {
      // The trap a per-lane rule opens: clear the registration while editing `dedicated` and the standing
      // 16% on everything else is suddenly being charged by nobody. The guard reads EVERY rule it would
      // hold, not the one in front of it.
      entities.setTax(sister(), { ratePct: 0.16, registration: 'P051234567X' });
      expect(() => entities.setTax(sister(), { lane: 'dedicated', ratePct: 0.08, registration: null })).toThrow(/no tax registration/);
      expect(entities.taxFor(sister()).ratePct).toBe(0.16);
      expect(entities.taxFor(sister(), 'dedicated').ratePct).toBe(0.16); // the refused override never landed
    });

    it('zero-rates one lane without disturbing the rest', () => {
      // Rates vary by what is SUPPLIED, and lane is the only supply-type axis this system has. A
      // jurisdiction that zero-rates one kind of transport can say so.
      entities.setTax(sister(), { ratePct: 0.16, label: 'VAT', registration: 'P051234567X' });
      entities.setTax(sister(), { lane: 'mdp', ratePct: 0 });
      expect(entities.taxFor(sister(), 'mdp').ratePct).toBe(0);
      expect(entities.taxFor(sister(), 'pudo').ratePct).toBe(0.16);
      expect(entities.taxFor(sister()).ratePct).toBe(0.16);
    });

    it('resolves a rule WHOLE — never half of one jurisdiction and half of another', () => {
      // The deliberate difference from the rate stack, which resolves field by field. A rate and the name
      // it is charged under are one statement; splicing two of them makes a rule no authority would know.
      entities.setTax(sister(), { ratePct: 0.16, label: 'VAT', registration: 'P051234567X' });
      entities.setTax(sister(), { lane: 'dedicated', ratePct: 0.08 });
      expect(entities.taxFor(sister(), 'dedicated')).toMatchObject({ ratePct: 0.08, label: 'Tax' });
    });

    it('states the registration only where something is actually collected', () => {
      // A registration number on a zero-rated receipt is noise, and an implied claim nobody made.
      entities.setTax(sister(), { ratePct: 0.16, registration: 'P051234567X' });
      entities.setTax(sister(), { lane: 'mdp', ratePct: 0 });
      expect(entities.taxFor(sister(), 'mdp').registration).toBeUndefined();
      expect(entities.taxFor(sister(), 'pudo').registration).toBe('P051234567X');
    });

    it('catches the one typo that matters', () => {
      // `16` where `0.16` was meant charges sixteen hundred percent. The ceiling is loose on purpose —
      // tighter would be this codebase having an opinion about somebody else's law.
      expect(() => entities.setTax(sister(), { ratePct: 16, registration: 'X' })).toThrow(/fraction/);
    });

    it('lets a sister be cleared back to charging nothing', () => {
      entities.setTax(sister(), { ratePct: 0.16, registration: 'P051234567X' });
      entities.setTax(sister(), { ratePct: null });
      expect(entities.taxFor(sister()).ratePct).toBe(0);
    });

    it('refuses the group, which is the merchant of record nowhere', () => {
      expect(() => entities.setTax(entities.group().entityId, { ratePct: 0.16, registration: 'X' })).toThrow(/holding company/);
    });

    it('is NOT a fourth layer of the rate stack', () => {
      // The distinction the whole separation exists for: the stack is what the sister EARNS and tax is
      // money it never owns for a moment. Folding it in would make every margin figure wrong by the rate.
      entities.setTax(sister(), { ratePct: 0.16, registration: 'P051234567X' });
      expect(entities.ratesFor(sister()).totalPct).toBe(PLATFORM_FEE_PCT);
    });
  });

  describe('the pricing read model — what a sister charges, and where each answer came from', () => {
    // The screen that turns these knobs is only honest if it can tell an inherited number from a decided
    // one. They look identical on screen and behave completely differently when edited: clearing an
    // inherited value does nothing, and re-typing the value it already shows converts an inheritance into
    // a decision somebody now owns.
    const LANES = ['pudo', 'mdp', 'dedicated'];
    const ke = () => entities.requireForJurisdiction('KE').entityId;

    it('names the LANE when the lane is what holds the number', () => {
      entities.setRates(ke(), { marginPct: 0.03 });
      entities.setRates(ke(), { lane: 'dedicated', marginPct: 0.07 });
      expect(EntityService.rateOrigins(entities.get(ke()), 'dedicated').marginPct).toBe('lane');
      expect(entities.ratesFor(ke(), 'dedicated').marginPct).toBe(0.07);
    });

    it('names the SISTER when the lane has no opinion of its own', () => {
      entities.setRates(ke(), { marginPct: 0.03, costOfRiskPct: 0.01 });
      entities.setRates(ke(), { lane: 'pudo', costOfRiskPct: 0.02 });
      const origin = EntityService.rateOrigins(entities.get(ke()), 'pudo');
      // A partial lane override leaves the other layers where they were — the resolution is per LAYER,
      // and the provenance has to say so or the screen implies the whole row is overridden.
      expect(origin.costOfRiskPct).toBe('lane');
      expect(origin.marginPct).toBe('sister');
      expect(origin.profitOnRiskPct).toBe('network');
    });

    it('names the pre-layers knob for what it always was: a MARGIN', () => {
      entities.setFeePct(ke(), 0.05);
      const origin = EntityService.rateOrigins(entities.get(ke()), 'pudo');
      expect(origin.marginPct).toBe('legacy-fee');
      expect(entities.ratesFor(ke(), 'pudo').marginPct).toBe(0.05);
      // And it is the only layer with that extra step. There was never an old knob for the other two.
      expect(origin.costOfRiskPct).toBe('network');
      expect(origin.profitOnRiskPct).toBe('network');
    });

    it('names the NETWORK where nobody has ever decided anything', () => {
      const fresh = entities.requireForJurisdiction('KE');
      const origin = EntityService.rateOrigins(fresh, 'pudo');
      expect(origin).toEqual({ costOfRiskPct: 'network', profitOnRiskPct: 'network', marginPct: 'network' });
      expect(entities.ratesFor(fresh.entityId, 'pudo').marginPct).toBe(PLATFORM_FEE_PCT);
    });

    it('stays IN STEP with the resolution it describes, whatever is set where', () => {
      // The label is worse than useless if it disagrees with the arithmetic: it would tell an operator a
      // number is inherited at the moment they own it. So this checks the two against each other across
      // every combination rather than asserting labels by inspection — clearing the level a label names
      // MUST move the number, and clearing any other level must not.
      const combos = [
        { sister: {}, lane: {} },
        { sister: { marginPct: 0.03 }, lane: {} },
        { sister: { marginPct: 0.03 }, lane: { marginPct: 0.06 } },
        { sister: { costOfRiskPct: 0.01, profitOnRiskPct: 0.02, marginPct: 0.03 }, lane: { costOfRiskPct: 0.04 } },
        { sister: {}, lane: { profitOnRiskPct: 0.05 } },
      ];
      for (const combo of combos) {
        const id = ke();
        // Start from nothing every time, so one combination cannot leave a rate behind for the next.
        entities.setRates(id, { costOfRiskPct: null, profitOnRiskPct: null, marginPct: null });
        for (const lane of LANES) entities.setRates(id, { lane, costOfRiskPct: null, profitOnRiskPct: null, marginPct: null });
        entities.setRates(id, combo.sister);
        entities.setRates(id, { lane: 'pudo', ...combo.lane });

        const before = entities.ratesFor(id, 'pudo');
        const origin = EntityService.rateOrigins(entities.get(id), 'pudo');
        for (const layer of ['costOfRiskPct', 'profitOnRiskPct', 'marginPct'] as const) {
          // Clear the LANE and see whether this layer moved. It must move exactly when the label said the
          // lane was holding it.
          entities.setRates(id, { lane: 'pudo', [layer]: null });
          const after = entities.ratesFor(id, 'pudo');
          expect(after[layer] === before[layer]).toBe(origin[layer] !== 'lane');
          // Put it back so the next layer is judged against the same starting state.
          entities.setRates(id, { lane: 'pudo', ...combo.lane });
        }
      }
    });

    it('reports tax and cover WHOLE, because that is how they resolve', () => {
      const id = ke();
      expect(EntityService.taxOrigin(entities.get(id))).toBe('none');
      entities.setTax(id, { ratePct: 0.16, label: 'VAT', registration: 'KE-VAT-1' });
      expect(EntityService.taxOrigin(entities.get(id), 'pudo')).toBe('sister');
      entities.setTax(id, { lane: 'dedicated', ratePct: 0 });
      expect(EntityService.taxOrigin(entities.get(id), 'dedicated')).toBe('lane');

      expect(EntityService.insuranceOrigin(entities.get(id))).toBe('none');
      entities.setInsurance(id, { freeLimit: 5000 });
      expect(EntityService.insuranceOrigin(entities.get(id), 'pudo')).toBe('sister');
      entities.setInsurance(id, { lane: 'dedicated', freeLimit: 50000 });
      expect(EntityService.insuranceOrigin(entities.get(id), 'dedicated')).toBe('lane');
    });

    it('hands back the default row FIRST, then one row per lane', () => {
      const pricing = entities.pricingFor(ke(), LANES);
      expect(pricing.lanes.map((l) => l.lane)).toEqual([undefined, 'pudo', 'mdp', 'dedicated']);
      expect(pricing.transacting).toBe(true);
      expect(pricing.currency).toBe('KES');
    });

    it('includes the group, and says it cannot transact rather than hiding it', () => {
      // Hiding it is the easier answer and the wrong one: an operator who goes looking for the mother's
      // rates should find it and be told why it has none, not wonder whether the screen is broken.
      const pricing = entities.pricingFor(entities.group().entityId, LANES);
      expect(pricing.transacting).toBe(false);
      expect(() => entities.setRates(entities.group().entityId, { marginPct: 0.02 })).toThrow();
    });

    it('publishes the bounds it will actually enforce', () => {
      // A form validating against numbers it holds privately will one day accept what the server refuses.
      const { bounds } = entities.pricingFor(ke(), LANES);
      expect(() => entities.setRates(ke(), { marginPct: bounds.maxRatePct + 0.001 })).toThrow();
      expect(() => entities.setRates(ke(), { marginPct: bounds.maxRatePct })).not.toThrow();
      expect(() => entities.setTax(ke(), { ratePct: bounds.maxTaxPct + 0.001 })).toThrow();
      expect(() => entities.setInsurance(ke(), { premiumPct: bounds.maxPremiumPct + 0.001 })).toThrow();
    });
  });
});

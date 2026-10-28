import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { enTowerBusiness } from '../../shared/i18n/catalogs/en.tower-business';
import { RailNotePanel, type RailNoteView } from './screens/RailNotePanel';

/*
 * THE RAILWAY'S NOTE, HELD (the user, 2026-10-28: "for now we hold the note but we should be able to see whether it is
 * valid"). Read back: complete or not for the rules of its lane, as printed; what is missing and under which rule; what
 * can only be asked; the box's number against ours; what a gap costs. Never "valid" on our word.
 */
const calls = { railways: async () => ({ data: { items: [] } }), check: async () => ({ data: null }), keep: async () => ({}) };
const held = (over: Partial<RailNoteView> = {}): RailNoteView =>
  ({
    railway: 'krc',
    railwayName: 'Kenya Railways',
    from: { name: 'Nairobi Inland Container Depot', country: 'KE' },
    to: { name: 'Mombasa Port Reitz', country: 'KE' },
    noteNumber: 'KRC-SGR-44120',
    madeOutOn: '2026-10-28',
    load: 'container',
    printed: [],
    recordedAt: '2026-10-28T10:00:00Z',
    recordedBy: 'Wanjiku',
    recordedByEntityId: 'ent_1',
    replaced: 0,
    matches: [{ field: 'containerNo', printed: 'MSCU1234567', ours: 'MSCU1234566', agrees: false }],
    check: {
      regime: 'national',
      rules: ['Kenya Railways Tariff Book, Appendix II'],
      checkedOn: '2026-10-28',
      sources: ['https://krc.co.ke/wp-content/uploads/2026/06/Kenya-Railways-Tariff-Book.pdf'],
      findings: [
        { key: 'consignorSigned', rule: 'Conditions cl. 7', kind: 'missing' },
        { key: 'documents', rule: 'Conditions cl. 8', kind: 'ask', unless: 'no_documents' },
      ],
      asked: ['consignorSigned', 'documents'],
      complete: false,
      electronic: [],
      limits: ['The declared value is the most the railway pays; with no value declared, KSh 20,000 (cl. 9).'],
      claims: [],
      caveats: [],
    },
    ...over,
  }) as RailNoteView;
const render = (rail?: RailNoteView, canKeep = true) =>
  renderToString(<RailNotePanel code="EXP-001" {...(rail ? { rail } : {})} canKeep={canKeep} documents={[]} defaults={{ fromCountry: 'KE', toCountry: 'KE' }} calls={calls} onKept={() => undefined} />);

describe('the railway’s note on an export or an import', () => {
  it('with none kept, says so and offers to keep one — to whoever may', () => {
    // Folded: most boxes never go by rail, and a fold that says so is skipped at a glance.
    expect(render()).toContain(t('tower.rail.fold.none'));
    expect(render(held())).toContain(t('tower.rail.keepNew'));
    expect(render(held(), false)).not.toContain(t('tower.rail.keepNew'));
  });

  it('a kept note: what is missing and under which rule, what is only asked, the box against ours, and what a gap costs', () => {
    const html = render(held());
    expect(html).toContain(t('tower.rail.incomplete'));
    expect(html).toContain(t('tower.rail.p.consignorSigned'));
    expect(html).toContain('Conditions cl. 7');
    expect(html).toContain(t('tower.rail.neededIf', { when: t('tower.rail.unless.no_documents') }));
    expect(html).toContain(t('tower.rail.match.differs'));
    expect(html).toContain('KSh 20,000');
    expect(html).toContain('krc.co.ke');
  });

  it('a railway whose rules we have not read is said so, never “complete”', () => {
    const html = render(held({ check: { ...held().check, rules: [], findings: [], complete: false, notChecked: 'What Transnet Freight Rail’s note must carry was not checked.' } as RailNoteView['check'] }));
    expect(html).toContain('was not checked');
    expect(html).not.toContain(t('tower.rail.complete'));
  });

  it('has words for every particular a rule can ask for', () => {
    const keys = ['madeOut', 'consignor', 'consignee', 'carrier', 'from', 'takenOverOn', 'to', 'borderStations', 'goods', 'goodsCode', 'packing', 'dangerous', 'packages', 'marks', 'mass', 'massMethod', 'wagon', 'container', 'seals', 'documents', 'charges', 'transitPeriod', 'dates', 'noteNumber', 'statement', 'consignorSigned', 'carrierSigned'];
    for (const k of keys) expect((enTowerBusiness as Record<string, string>)[`tower.rail.p.${k}`]).toBeTruthy();
  });
});

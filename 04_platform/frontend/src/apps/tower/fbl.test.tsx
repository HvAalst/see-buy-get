import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { enTowerBusiness } from '../../shared/i18n/catalogs/en.tower-business';
import { FblPanel, FiataDirectoryHint, FIATA_DIRECTORY, type FblView } from './screens/FblPanel';

/*
 * THE FORWARDER'S BILL, HELD AND EXPLAINED (the user, 2026-10-28/29). Read back: what the form asks and lacks, what agrees
 * with our papers — and that agreeing proves nothing; where to check it yourself; what the holder saw on FIATA's page, as
 * their record; and what the bill means. "We do not check, but users can check": FIATA's directory is linked.
 */
const calls = { keep: async () => ({}), verified: async () => ({}) };
const held = (over: Partial<FblView> = {}): FblView =>
  ({
    form: 'fbl',
    number: 'KE-114',
    issuer: { name: 'Pwani Forwarders Ltd', country: 'KE' },
    issuedOn: '2026-10-29',
    electronic: true,
    seaLeg: true,
    printed: [],
    recordedAt: '2026-10-29T06:00:00Z',
    recordedBy: 'Wanjiku',
    recordedByEntityId: 'ent_1',
    replaced: 0,
    verified: 'not_checked',
    matches: [{ field: 'packages', printed: '790', ours: '800', agrees: false }],
    check: {
      form: 'FIATA Multimodal Transport Bill of Lading (FBL)',
      conditions: 'FBL Standard Conditions (1992)',
      negotiable: true,
      findings: [{ key: 'signature', rule: 'UCP 600 Art. 19(a)(i)', kind: 'missing' }],
      asked: ['signature'],
      complete: false,
      meaning: ['Negotiable: it is title to the goods.'],
      limits: ['At most 666.67 SDR a package (about US$901) or 2 SDR a kilogram of gross weight (about US$2.70), whichever is higher.'],
      claims: ['Suit within 9 months after delivery.'],
      country: [{ country: 'KE', says: 'Kenya has no FIATA association.', source: 'https://example.org' }],
      genuine: { where: 'https://fiata.org/document-verification/', says: 'FIATA’s page says whether the electronic bill was registered.', directory: FIATA_DIRECTORY },
      sdrRate: { usd: 1.35178, on: '2026-10-28', source: 'https://www.imf.org/external/np/fin/data/rms_sdrv.aspx' },
      sources: ['https://fiata.org/x.pdf', 'SeeBuyGet research, not an address'],
    },
    ...over,
  }) as FblView;
const render = (fbl: FblView | undefined, canVerify = true, documents = [{ documentId: 'doc_1', title: 'FIATA result' }]) =>
  renderToString(<FblPanel code="EXP-001" {...(fbl ? { fbl } : {})} canKeep canVerify={canVerify} documents={documents} defaults={{}} calls={calls} onKept={() => undefined} />);

describe('the forwarder’s bill on an export or an import', () => {
  it('a kept bill: what the form lacks, what differs from ours — and that agreeing proves nothing', () => {
    const html = render(held());
    expect(html).toContain(t('tower.fbl.incomplete'));
    expect(html).toContain(t('tower.fbl.box.signature'));
    expect(html).toContain(t('tower.fbl.match.differs'));
    expect(html).toContain(t('tower.fbl.match.provesNothing'));
    expect(html).toContain('about US$901');
  });

  it('an electronic bill links FIATA’s page, and asks the holder to record what it showed, with the result attached', () => {
    const html = render(held());
    expect(html).toContain('https://fiata.org/document-verification/');
    expect(html).toContain(t('tower.fbl.recordCheck'));
    expect(render(held(), false)).not.toContain(t('tower.fbl.recordCheck'));
  });

  it('a clearing agent with none of the importer’s papers can still upload its own: the result of the check, and the copy', () => {
    const upload = async () => ({ documentId: 'doc_new' });
    const html = renderToString(<FblPanel code="IMP-001" fbl={held()} canKeep canVerify documents={[]} upload={upload} defaults={{}} calls={calls} onKept={() => undefined} />);
    expect(html).toContain(t('tower.fbl.f.uploadProof'));
    expect(html).toContain(t('tower.fbl.recordCheck'));
    // Without papers and without an upload, nothing to attach: nothing is offered.
    expect(render(held(), true, [])).not.toContain(t('tower.fbl.recordCheck'));
  });

  it('what the holder saw is shown as their record, never as a check by us', () => {
    const html = render(held({ verified: 'registered', verification: { registered: true, by: 'Wanjiku', byEntityId: 'ent_1', at: '2026-10-29T07:00:00Z', proofDocumentId: 'doc_1', proofTitle: 'FIATA result', fiataId: 'FBL-KE-000114' } as FblView['verification'] }));
    expect(html).toContain(t('tower.fbl.checkedBy', { by: 'Wanjiku', day: '2026-10-29', proof: 'FIATA result' }));
    expect(html).toContain('not a check by SeeBuyGet');
  });

  it('a source that is not an address is never drawn as a link', () => {
    expect(render(held())).not.toContain('SeeBuyGet research, not an address');
  });

  it('we check nobody’s membership: the hint points to FIATA’s own directory', () => {
    const html = renderToString(<FiataDirectoryHint />);
    expect(html).toContain('https://fiata.org/directory/');
    expect(html).toContain('checks nobody’s membership');
  });

  it('has words for every box of the form', () => {
    const boxes = ['consignor', 'consignedTo', 'notify', 'placeOfReceipt', 'vessel', 'portOfLoading', 'portOfDischarge', 'placeOfDelivery', 'marks', 'packages', 'description', 'grossWeight', 'measurement', 'freightPayableAt', 'originals', 'placeDateOfIssue', 'signature', 'deliveryAgent'];
    for (const b of boxes) expect((enTowerBusiness as Record<string, string>)[`tower.fbl.box.${b}`]).toBeTruthy();
  });
});

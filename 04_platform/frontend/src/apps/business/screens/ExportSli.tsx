import { useState } from 'preact/hooks';
import { abbrName } from '../../../shared/abbr';
import { DocumentButton } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { BusinessClient } from '../api';
import { dayWords, emptySliLine, SLI_INCOTERMS, sliBody, sliForm, utcWords, type ExportDetail, type SliForm, type SliLineForm } from '../exports';

type Problem = { detail?: string; title: string } | null | undefined;

/**
 * THE SHIPPER'S LETTER OF INSTRUCTION (the user, 2026-10-28: "not just take the reference, but rather the form fields"):
 * what the exporter tells its forwarder, from which the bill of lading is drafted. Most of it comes from the export
 * itself; the form asks the rest. Signed, it is kept exactly as signed — a change is a new version. The exporter fills
 * it in; its agent and staff read the signed versions.
 */
export function ExportSli({ d, client, mine, signatory, onDetail }: { d: ExportDetail; client: BusinessClient; mine: boolean; signatory: string; onDetail: (next: ExportDetail) => void | Promise<void> }) {
  const t = useT();
  const c = d.consignment;
  const sli = d.sli;
  const last = sli.versions[sli.versions.length - 1];
  const [editing, setEditing] = useState(!last);
  const [form, setForm] = useState<SliForm>(() => sliForm(sli.draft, c.goodsDescription));
  const [who, setWho] = useState(signatory);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async (fn: () => Promise<{ data?: ExportDetail | null; error?: Problem }>, note: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    const r = await fn();
    setBusy(false);
    if (r.error) return false;
    if (r.data) await onDetail(r.data);
    setDone(note);
    return true;
  };
  const say = async (fn: () => Promise<{ data?: ExportDetail | null; error?: Problem }>) => {
    const r = await fn();
    if (r.error) setError(r.error.detail || r.error.title);
    return r;
  };
  const save = () => run(() => say(() => client.exports.saveSli(c.exportId, sliBody(form))), t('business.exports.sli.saved'));
  const sign = async () => {
    // What is on the screen is what is signed: saved first, then signed.
    const saved = await say(() => client.exports.saveSli(c.exportId, sliBody(form)));
    if (saved.error) return;
    if (await run(() => say(() => client.exports.signSli(c.exportId, who.trim())), t('business.exports.sli.signedNote', { n: sli.versions.length + 1 }))) setEditing(false);
  };

  const set = (patch: Partial<SliForm>) => setForm({ ...form, ...patch });
  const line = (i: number, patch: Partial<SliLineForm>) => set({ lines: form.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) });
  const input = (label: string, value: string, onInput: (v: string) => void, opts: { max?: number; type?: string; placeholder?: string } = {}) => (
    <label class="cfield">
      <span class="cfield__label">{label}</span>
      <input class="cinput" type={opts.type ?? 'text'} maxLength={opts.max ?? 120} placeholder={opts.placeholder} value={value} onInput={(e) => onInput((e.target as HTMLInputElement).value)} />
    </label>
  );
  const area = (label: string, value: string, onInput: (v: string) => void, max = 300) => (
    <label class="cfield">
      <span class="cfield__label">{label}</span>
      <textarea class="cinput" rows={2} maxLength={max} value={value} onInput={(e) => onInput((e.target as HTMLTextAreaElement).value)} />
    </label>
  );

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.exports.sli.title')}</span>
        <span class={`ctag ctag--${last ? (sli.stale ? 'warn' : 'ok') : 'warn'}`}>{t(last ? (sli.stale ? 'business.exports.sli.tagStale' : 'business.exports.sli.tagSigned') : 'business.exports.sli.tagNone')}</span>
      </div>
      <p class="chint">{t(mine ? 'business.exports.sli.lede' : 'business.exports.sli.ledeRead')}</p>
      {done ? <p class="cnote">{done}</p> : null}
      {error ? <p class="cerr">{error}</p> : null}
      {sli.stale && last ? <p class="cerr">{t('business.exports.sli.stale', { n: last.version })}</p> : null}

      {sli.versions.length ? (
        <div class="crows">
          {[...sli.versions].reverse().map((v) => (
            <div class="crow" key={v.version}>
              <span class="crow__body">
                <span class="crow__top">
                  <span class="crow__name">{t('business.exports.sli.version', { n: v.version })}</span>
                  {v.version === last?.version ? <span class="ctag ctag--ok">{t('business.exports.sli.current')}</span> : <span class="ctag ctag--quiet">{t('business.exports.sli.earlier')}</span>}
                </span>
                <span class="crow__sub">{t('business.exports.sli.signedBy', { who: v.signedBy, when: utcWords(v.signedAt) })}</span>
                <span class="twr-panelend">
                  <DocumentButton label={t('business.exports.sli.open')} title={t('business.exports.sli.version', { n: v.version })} fetch={() => client.exports.sliPage(c.exportId, { version: v.version })} />
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : !mine ? (
        <p class="cons__empty">{t('business.exports.sli.noneYet')}</p>
      ) : null}

      {mine && !editing ? (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setEditing(true)}>
            {t('business.exports.sli.change')}
          </button>
        </div>
      ) : null}

      {mine && editing ? (
        <>
          <h3 class="cons__sub">{t('business.exports.sli.parties')}</h3>
          <p class="chint">{t('business.exports.sli.fromExport', { shipper: d.exporterName, forwarder: c.booking.partyName, booking: c.booking.reference })}</p>
          {input(t('business.exports.sli.shipperContact'), form.shipperContact, (v) => set({ shipperContact: v }), { max: 160 })}
          <label class="cfield">
            <span class="cfield__label">{t('business.exports.sli.consigneeKind')}</span>
            <select class="cinput" value={form.consigneeKind} onChange={(e) => set({ consigneeKind: (e.target as HTMLSelectElement).value as SliForm['consigneeKind'] })}>
              <option value="named">{t('business.exports.sli.kind.named')}</option>
              <option value="to_order">{t('business.exports.sli.kind.to_order')}</option>
              <option value="to_order_of_bank">{t('business.exports.sli.kind.to_order_of_bank')}</option>
            </select>
          </label>
          {form.consigneeKind === 'named' ? (
            <div class="biz-two">
              {input(t('business.exports.sli.consigneeName'), form.consignee.name, (v) => set({ consignee: { ...form.consignee, name: v } }))}
              {input(t('business.exports.sli.contact'), form.consignee.contact, (v) => set({ consignee: { ...form.consignee, contact: v } }))}
            </div>
          ) : null}
          {form.consigneeKind === 'named' ? area(t('business.exports.sli.consigneeAddress'), form.consignee.address, (v) => set({ consignee: { ...form.consignee, address: v } })) : null}
          {form.consigneeKind === 'to_order_of_bank' ? input(t('business.exports.sli.bank'), form.orderOfBank, (v) => set({ orderOfBank: v })) : null}
          {form.consigneeKind === 'named' ? (
            <label class="cfield--check">
              <input type="checkbox" checked={form.notifySame} onChange={() => set({ notifySame: !form.notifySame })} />
              <span>{t('business.exports.sli.notifySame')}</span>
            </label>
          ) : null}
          {form.consigneeKind !== 'named' || !form.notifySame ? (
            <>
              <div class="biz-two">
                {input(t('business.exports.sli.notifyName'), form.notify.name, (v) => set({ notify: { ...form.notify, name: v } }))}
                {input(t('business.exports.sli.contact'), form.notify.contact, (v) => set({ notify: { ...form.notify, contact: v } }))}
              </div>
              {area(t('business.exports.sli.notifyAddress'), form.notify.address, (v) => set({ notify: { ...form.notify, address: v } }))}
            </>
          ) : null}

          <h3 class="cons__sub">{t('business.exports.sli.voyage')}</h3>
          <div class="biz-two">
            {input(t('business.exports.sli.dischargePort'), form.dischargePort, (v) => set({ dischargePort: v }), { max: 80, placeholder: 'Rotterdam' })}
            {input(t('business.exports.sli.placeOfDelivery'), form.placeOfDelivery, (v) => set({ placeOfDelivery: v }), { max: 80 })}
          </div>
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.sli.incoterm')}</span>
              <select class="cinput" value={form.incoterm} onChange={(e) => set({ incoterm: (e.target as HTMLSelectElement).value })}>
                <option value="">{t('business.exports.sli.incotermNone')}</option>
                {SLI_INCOTERMS.map((code) => (
                  <option key={code} value={code}>
                    {`${code} — ${t(abbrName(code))}`}
                  </option>
                ))}
              </select>
            </label>
            {form.incoterm ? input(t('business.exports.sli.incotermPlace'), form.incotermPlace, (v) => set({ incotermPlace: v }), { max: 80, placeholder: c.loadingPort }) : <span />}
          </div>
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.sli.freight')}</span>
              <select class="cinput" value={form.freight} onChange={(e) => set({ freight: (e.target as HTMLSelectElement).value })}>
                <option value="">{t('business.exports.sli.choose')}</option>
                <option value="prepaid">{t('business.exports.sli.prepaid')}</option>
                <option value="collect">{t('business.exports.sli.collect')}</option>
              </select>
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('business.exports.sli.release')}</span>
              <select class="cinput" value={form.blRelease} onChange={(e) => set({ blRelease: (e.target as HTMLSelectElement).value })}>
                <option value="">{t('business.exports.sli.choose')}</option>
                <option value="originals">{t('business.exports.sli.release.originals')}</option>
                <option value="sea_waybill">{t('business.exports.sli.release.sea_waybill')}</option>
                <option value="telex_release">{t('business.exports.sli.release.telex_release')}</option>
              </select>
            </label>
          </div>
          <div class="biz-two">
            {form.blRelease === 'originals' ? input(t('business.exports.sli.originals'), form.originals, (v) => set({ originals: v }), { type: 'number' }) : <span />}
            {input(t('business.exports.sli.copies'), form.copies, (v) => set({ copies: v }), { type: 'number' })}
          </div>

          <h3 class="cons__sub">{t('business.exports.sli.goods')}</h3>
          {sli.fromPacking ? (
            <>
              <p class="chint">{t('business.exports.sli.goodsFromPacking')}</p>
              <div class="crows">
                {(sli.goods ?? []).map((g, i) => (
                  <div class="crow" key={i}>
                    <span class="crow__body">
                      <span class="crow__top">
                        <span class="crow__name">{g.description}</span>
                      </span>
                      <span class="crow__sub">{t('business.exports.sli.goodsLine', { packages: g.packages.toLocaleString('en'), kind: g.packageKind, gross: g.grossKg.toLocaleString('en', { maximumFractionDigits: 1 }), marks: g.marks ?? '—', hs: g.hsCode ?? '—' })}</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {sli.fromPacking ? null : <p class="chint">{t('business.exports.sli.goodsHint')}</p>}
          {sli.fromPacking ? null : form.lines.map((l, i) => (
            <div class="biz-sliline" key={i}>
              <div class="biz-two">
                {input(t('business.exports.sli.description'), l.description, (v) => line(i, { description: v }), { max: 300 })}
                {input(t('business.exports.sli.marks'), l.marks, (v) => line(i, { marks: v }))}
              </div>
              <div class="biz-two">
                {input(t('business.exports.sli.packages'), l.packages, (v) => line(i, { packages: v }), { type: 'number' })}
                {input(t('business.exports.sli.packageKind'), l.packageKind, (v) => line(i, { packageKind: v }), { max: 40, placeholder: t('business.exports.sli.packageKindPh') })}
              </div>
              <div class="biz-two">
                {input(t('business.exports.sli.hsCode'), l.hsCode, (v) => line(i, { hsCode: v }), { max: 16, placeholder: '0902.40' })}
                {input(t('business.exports.sli.grossKg'), l.grossKg, (v) => line(i, { grossKg: v }), { type: 'number' })}
              </div>
              <div class="biz-two">
                {input(t('business.exports.sli.netKg'), l.netKg, (v) => line(i, { netKg: v }), { type: 'number' })}
                {input(t('business.exports.sli.volume'), l.volumeM3, (v) => line(i, { volumeM3: v }), { type: 'number' })}
              </div>
              {form.lines.length > 1 ? (
                <div class="twr-panelend">
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => set({ lines: form.lines.filter((_, n) => n !== i) })}>
                    {t('business.exports.sli.removeLine')}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          {sli.fromPacking ? null : (
            <div class="twr-panelend">
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={form.lines.length >= 30} onClick={() => set({ lines: [...form.lines, emptySliLine()] })}>
                {t('business.exports.sli.addLine')}
              </button>
            </div>
          )}

          {sli.hazardous ? (
            <>
              <h3 class="cons__sub">{t('business.exports.sli.dangerous')}</h3>
              <div class="biz-two">
                {input(t('business.exports.sli.unNumber'), form.dangerous.unNumber, (v) => set({ dangerous: { ...form.dangerous, unNumber: v } }), { max: 8, placeholder: 'UN1263' })}
                {input(t('business.exports.sli.hazardClass'), form.dangerous.hazardClass, (v) => set({ dangerous: { ...form.dangerous, hazardClass: v } }), { max: 8, placeholder: '3' })}
              </div>
              <div class="biz-two">
                {input(t('business.exports.sli.shippingName'), form.dangerous.properShippingName, (v) => set({ dangerous: { ...form.dangerous, properShippingName: v } }))}
                {input(t('business.exports.sli.packingGroup'), form.dangerous.packingGroup, (v) => set({ dangerous: { ...form.dangerous, packingGroup: v } }), { max: 4, placeholder: 'II' })}
              </div>
            </>
          ) : null}

          <h3 class="cons__sub">{t('business.exports.sli.more')}</h3>
          {input(t('business.exports.sli.letterOfCredit'), form.letterOfCredit, (v) => set({ letterOfCredit: v }), { max: 60 })}
          {area(t('business.exports.sli.instructions'), form.instructions, (v) => set({ instructions: v }), 1000)}

          {sli.gaps.length ? <p class="chint">{t('business.exports.sli.gaps', { what: sli.gaps.join('; ') })}</p> : null}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => void save()}>
              {t('business.exports.sli.save')}
            </button>
            {sli.draft ? <DocumentButton label={t('business.exports.sli.preview')} title={t('business.exports.sli.preview')} fetch={() => client.exports.sliPage(c.exportId, { draft: true })} /> : null}
          </div>
          <div class="biz-two">
            {input(t('business.exports.sli.signatory'), who, setWho)}
            <div class="twr-panelend">
              <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy || who.trim().length < 2} onClick={() => void sign()}>
                {t('business.exports.sli.sign', { n: sli.versions.length + 1 })}
              </button>
            </div>
          </div>
          {last ? <p class="chint">{t('business.exports.sli.signHint', { n: last.version, when: dayWords(last.signedAt) })}</p> : null}
        </>
      ) : null}
    </section>
  );
}

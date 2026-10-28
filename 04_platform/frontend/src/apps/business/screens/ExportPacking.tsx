import { useState } from 'preact/hooks';
import { DocumentButton } from '../../../shared/ui';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { useT, type MessageKey } from '../../../shared/i18n';
import type { BusinessClient } from '../api';
import { PACKING_FIELDS, packingTotalsLine, utcWords, type ExportDetail, type PackingCheck, type PackingColumnUse, type PackingInput, type PackingTotals } from '../exports';

type Problem = { detail?: string; title: string } | null | undefined;

const USE_WORD: Record<PackingColumnUse, MessageKey> = {
  marks: 'business.exports.packing.use.marks',
  itemCode: 'business.exports.packing.use.itemCode',
  description: 'business.exports.packing.use.description',
  hsCode: 'business.exports.packing.use.hsCode',
  quantity: 'business.exports.packing.use.quantity',
  unit: 'business.exports.packing.use.unit',
  packages: 'business.exports.packing.use.packages',
  packageKind: 'business.exports.packing.use.packageKind',
  netKg: 'business.exports.packing.use.netKg',
  grossKg: 'business.exports.packing.use.grossKg',
  volumeM3: 'business.exports.packing.use.volumeM3',
  lengthCm: 'business.exports.packing.use.lengthCm',
  widthCm: 'business.exports.packing.use.widthCm',
  heightCm: 'business.exports.packing.use.heightCm',
  unitPrice: 'business.exports.packing.use.unitPrice',
  lineValue: 'business.exports.packing.use.lineValue',
  originCountry: 'business.exports.packing.use.originCountry',
  keep: 'business.exports.packing.use.keep',
  ignore: 'business.exports.packing.use.ignore',
};
const BECAUSE_WORD: Record<'heading' | 'remembered' | 'chosen' | 'kept', MessageKey> = {
  heading: 'business.exports.packing.because.heading',
  remembered: 'business.exports.packing.because.remembered',
  chosen: 'business.exports.packing.because.chosen',
  kept: 'business.exports.packing.because.kept',
};

/** Base64 of a file's bytes, for a workbook. */
const base64Of = (buffer: ArrayBuffer) => {
  let s = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * THE PACKING LIST, FROM THE SHIPPER'S OWN FILE (the user, 2026-10-28: "a shipper doesn't want to import by hand
 * especially if the packing list is long and detailed, that should be dynamic and adaptable"). Upload the file its
 * system exports, or paste its cells; see how each heading was read, match any we did not know (remembered for next
 * time), check, import, sign. The letter of instruction's goods are worked out from it.
 */
export function ExportPacking({ d, client, mine, signatory, onDetail }: { d: ExportDetail; client: BusinessClient; mine: boolean; signatory: string; onDetail: (next: ExportDetail) => void | Promise<void> }) {
  const t = useT();
  const c = d.consignment;
  const p = d.packing;
  const last = p?.versions[p.versions.length - 1];
  const [input, setInput] = useState<PackingInput | null>(null);
  const [pasted, setPasted] = useState('');
  const [pasting, setPasting] = useState(false);
  const [check, setCheck] = useState<PackingCheck | null>(null);
  const [mapping, setMapping] = useState<Record<string, PackingColumnUse>>({});
  // A heading matched by hand since the last check: check again before importing, so what is imported is what was seen.
  const [dirty, setDirty] = useState(false);
  const [who, setWho] = useState(signatory);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const words = { lines: t('business.exports.packing.lines'), packages: t('business.exports.packing.packages'), gross: t('business.exports.packing.gross'), net: t('business.exports.packing.net'), volume: t('business.exports.packing.volume') };
  const totals = (x: PackingTotals) => packingTotalsLine(x, words);

  const runCheck = async (next: PackingInput) => {
    setDirty(false);
    setBusy(true);
    setError(null);
    setDone(null);
    const r = await client.exports.checkPacking(c.exportId, next);
    setBusy(false);
    if (r.error) return setError((r.error as Problem)?.detail || (r.error as Problem)?.title || '');
    setInput(next);
    setCheck(r.data ?? null);
  };
  const choose = (file: File) => {
    const reader = new FileReader();
    const workbook = /\.xlsx$/i.test(file.name);
    reader.onload = () => {
      setMapping({});
      void runCheck(workbook ? { workbook: base64Of(reader.result as ArrayBuffer), sourceName: file.name } : { text: String(reader.result), sourceName: file.name });
    };
    if (workbook) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  };
  const recheck = () => {
    if (!input) return;
    setDirty(false);
    void runCheck({ ...input, mapping });
  };
  const importIt = async () => {
    if (!input) return;
    setBusy(true);
    setError(null);
    const r = await client.exports.importPacking(c.exportId, { ...input, mapping });
    setBusy(false);
    if (r.error) return setError((r.error as Problem)?.detail || (r.error as Problem)?.title || '');
    setCheck(null);
    setInput(null);
    setPasted('');
    setPasting(false);
    setDone(t('business.exports.packing.importedNote', { n: (r.data as ExportDetail | undefined)?.packing?.lineCount ?? 0 }));
    if (r.data) await onDetail(r.data as ExportDetail);
  };
  const sign = async () => {
    setBusy(true);
    setError(null);
    const r = await client.exports.signPacking(c.exportId, who.trim());
    setBusy(false);
    if (r.error) return setError((r.error as Problem)?.detail || (r.error as Problem)?.title || '');
    setDone(t('business.exports.packing.signedNote', { n: (p?.versions.length ?? 0) + 1 }));
    if (r.data) await onDetail(r.data as ExportDetail);
  };

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.exports.packing.title')}</span>
        <span class={`ctag ctag--${!p ? 'warn' : p.unsigned ? 'warn' : 'ok'}`}>{t(!p ? 'business.exports.packing.tagNone' : p.unsigned ? 'business.exports.packing.tagUnsigned' : 'business.exports.packing.tagSigned')}</span>
      </div>
      <p class="chint">{t(mine ? 'business.exports.packing.lede' : 'business.exports.packing.ledeRead')}</p>
      {done ? <p class="cnote">{done}</p> : null}
      {error ? <p class="cerr">{error}</p> : null}

      {p ? (
        <>
          <p class="cons__lede">{totals(p.totals)}</p>
          <p class="chint">{t('business.exports.packing.from', { source: p.sourceName ?? t('business.exports.packing.yourFile'), who: p.importedBy, when: utcWords(p.importedAt) })}</p>
          {p.notes.map((n) => (
            <p class="cerr" key={n}>
              {n}
            </p>
          ))}
          <div class="biz-packtable">
            <table class="ctable">
              <thead>
                <tr>
                  <th>{t('business.exports.packing.use.marks')}</th>
                  <th>{t('business.exports.packing.use.description')}</th>
                  <th class="r">{t('business.exports.packing.use.packages')}</th>
                  <th class="r">{t('business.exports.packing.use.grossKg')}</th>
                  {p.extraColumns.slice(0, 2).map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.preview.map((l, i) => (
                  <tr key={i}>
                    <td>{l.marks ?? ''}</td>
                    <td>{l.description}</td>
                    <td class="r">{`${l.packages.toLocaleString('en')}${l.packageKind ? ` ${l.packageKind}` : ''}`}</td>
                    <td class="r">{l.grossKg != null ? l.grossKg.toLocaleString('en', { maximumFractionDigits: 1 }) : ''}</td>
                    {p.extraColumns.slice(0, 2).map((h) => (
                      <td key={h}>{l.extra?.[h] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {p.lineCount > p.preview.length ? <p class="chint">{t('business.exports.packing.more', { n: p.lineCount - p.preview.length })}</p> : null}
          <div class="twr-panelend">
            {mine ? <DocumentButton label={t('business.exports.packing.previewAll')} title={t('business.exports.packing.title')} fetch={() => client.exports.packingPage(c.exportId, { draft: true })} /> : null}
          </div>
          {p.versions.length ? (
            <div class="crows">
              {[...p.versions].reverse().map((v) => (
                <div class="crow" key={v.version}>
                  <span class="crow__body">
                    <span class="crow__top">
                      <span class="crow__name">{t('business.exports.sli.version', { n: v.version })}</span>
                      {v.version === last?.version && !p.unsigned ? <span class="ctag ctag--ok">{t('business.exports.sli.current')}</span> : <span class="ctag ctag--quiet">{t('business.exports.sli.earlier')}</span>}
                    </span>
                    <span class="crow__sub">{t('business.exports.packing.versionLine', { who: v.signedBy, when: utcWords(v.signedAt), lines: v.lines.toLocaleString('en'), packages: v.packages.toLocaleString('en') })}</span>
                    <span class="twr-panelend">
                      <DocumentButton label={t('business.exports.sli.open')} title={t('business.exports.sli.version', { n: v.version })} fetch={() => client.exports.packingPage(c.exportId, { version: v.version })} />
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {mine && p.unsigned ? (
            <div class="biz-two">
              <label class="cfield">
                <span class="cfield__label">{t('business.exports.sli.signatory')}</span>
                <input class="cinput" maxLength={120} value={who} onInput={(e) => setWho((e.target as HTMLInputElement).value)} />
              </label>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy || who.trim().length < 2} onClick={() => void sign()}>
                  {t('business.exports.packing.sign', { n: p.versions.length + 1 })}
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : !mine ? (
        <p class="cons__empty">{t('business.exports.packing.noneYet')}</p>
      ) : null}

      {mine ? (
        <>
          <h3 class="cons__sub">{t(p ? 'business.exports.packing.replace' : 'business.exports.packing.bring')}</h3>
          <div class="twr-panelend">
            <label class="cbtn cbtn--ghost cbtn--sm twr-quote__file">
              {t('business.exports.packing.upload')}
              <input
                type="file"
                accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={busy}
                onChange={(e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) choose(file);
                  (e.target as HTMLInputElement).value = '';
                }}
              />
            </label>
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setPasting(!pasting)}>
              {t('business.exports.packing.paste')}
            </button>
          </div>
          {pasting ? (
            <>
              <label class="cfield">
                <span class="cfield__label">{t('business.exports.packing.pasteLabel')}</span>
                <textarea class="cinput" rows={5} value={pasted} onInput={(e) => setPasted((e.target as HTMLTextAreaElement).value)} />
              </label>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy || !pasted.trim()} onClick={() => { setMapping({}); void runCheck({ text: pasted }); }}>
                  {t('business.exports.packing.check')}
                </button>
              </div>
            </>
          ) : null}
          <p class="chint"><Abbreviated text={t('business.exports.packing.fileHint')} /></p>
          <p class="chint">{t('business.exports.packing.ownSystem')}</p>
        </>
      ) : null}

      {mine && check ? (
        <div class="biz-packcheck">
          {check.refusal ? <p class="cerr">{check.refusal}</p> : <p class="cons__lede">{t('business.exports.packing.read', { totals: totals(check.totals), row: check.headingRow })}</p>}
          {check.columns.length ? (
            <>
              <h3 class="cons__sub">{t('business.exports.packing.columns')}</h3>
              <p class="chint">{t('business.exports.packing.columnsHint')}</p>
              <div class="crows">
                {check.columns.map((col) => (
                  <div class="crow" key={col.heading}>
                    <span class="crow__body">
                      <span class="crow__top">
                        <span class="crow__name">{col.heading}</span>
                        <span class="ctag ctag--quiet">{t(BECAUSE_WORD[col.because])}</span>
                      </span>
                      {col.convertedFrom ? <span class="crow__sub">{t('business.exports.packing.converted', { from: col.convertedFrom })}</span> : null}
                      <span class="biz-paperline">
                        <select class="cinput" value={mapping[col.heading] ?? col.use} onChange={(e) => {
                            setMapping({ ...mapping, [col.heading]: (e.target as HTMLSelectElement).value as PackingColumnUse });
                            setDirty(true);
                          }}>
                          {[...PACKING_FIELDS, 'keep' as const, 'ignore' as const].map((u) => (
                            <option key={u} value={u}>
                              {t(USE_WORD[u])}
                            </option>
                          ))}
                        </select>
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {check.notes.map((n) => (
            <p class="chint" key={n}>
              {n}
            </p>
          ))}
          {check.problems.length ? (
            <>
              <p class="cerr">{t('business.exports.packing.problems', { n: check.problems.length })}</p>
              <ul class="twr-checklist">
                {check.problems.slice(0, 20).map((pr) => (
                  <li key={`${pr.row}-${pr.says}`}>{t('business.exports.packing.problem', { row: pr.row, says: pr.says })}</li>
                ))}
              </ul>
            </>
          ) : null}
          <div class="twr-panelend">
            {dirty ? (
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={recheck}>
                {t('business.exports.packing.checkAgain')}
              </button>
            ) : null}
            <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy || Boolean(check.refusal) || check.problems.length > 0 || dirty} onClick={() => void importIt()}>
              {t('business.exports.packing.import', { n: check.totals.lines })}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

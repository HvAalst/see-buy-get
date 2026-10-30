import { useState } from 'preact/hooks';
import type { components } from '../../../lib/sbg/schema';
import { useT, type MessageKey } from '../../../shared/i18n';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { ConsoleFold } from '../ConsoleFold';
import { ConsolePick } from '../ConsolePick';

export type FblView = components['schemas']['FblView'];
type Box = FblView['printed'][number];
type Result = Promise<{ error?: { detail?: string; title?: string } | null }>;

export interface FblInput {
  form: 'fbl' | 'fwb';
  number: string;
  issuer: { name: string; country: string };
  issuedOn: string;
  electronic: boolean;
  seaLeg: boolean;
  printed: Box[];
  documentId?: string;
  containerNo?: string;
  seals?: string[];
  packages?: number;
  grossWeightKg?: number;
  portOfLoading?: string;
  portOfDischarge?: string;
  consignedTo?: string;
  originals?: number;
}

export interface FblCalls {
  keep(input: FblInput): Result;
  verified(input: { registered: boolean; fiataId?: string; issuerShown?: string; proofDocumentId: string }): Result;
}

/** FIATA's own directory of its members: we check nobody's membership — anybody can look a forwarder up there. */
export const FIATA_DIRECTORY = 'https://fiata.org/directory/';

const BOXES: Box[] = ['consignor', 'consignedTo', 'notify', 'placeOfReceipt', 'vessel', 'portOfLoading', 'portOfDischarge', 'placeOfDelivery', 'marks', 'packages', 'description', 'grossWeight', 'measurement', 'freightPayableAt', 'originals', 'placeDateOfIssue', 'signature', 'deliveryAgent'];
const SEA_ONLY: Box[] = ['vessel', 'portOfLoading', 'portOfDischarge'];
const FBL_ONLY: Box[] = ['originals', 'deliveryAgent'];
const today = () => new Date().toISOString().slice(0, 10);
const isUrl = (s: string) => /^https:\/\//.test(s);
const MATCH_WORD: Record<string, MessageKey> = { containerNo: 'tower.fbl.match.containerNo', seals: 'tower.fbl.match.seals', packages: 'tower.fbl.match.packages', grossWeight: 'tower.fbl.match.grossWeight', port: 'tower.fbl.match.port' };

/**
 * THE FORWARDER'S BILL, HELD AND EXPLAINED — never issued (the user, 2026-10-28: "if we optimize for FBL, we must know and
 * report for our users"; 2026-10-29: the holder records FIATA's check with the result attached; limits in SDR plus
 * about-dollars; "we do not check, but users can check, so we put a fiata link to their directory"). Read back: complete or
 * not for the 1992 form, what agrees with our papers, where to check it is genuine and what the holder saw there, and what
 * the bill means. Never "valid": a forged bill can copy our container number exactly.
 */
export function FblPanel({ code, fbl, canKeep, canVerify, documents, upload, defaults, calls, onKept }: {
  code: string;
  fbl?: FblView;
  canKeep: boolean;
  canVerify: boolean;
  documents: Array<{ documentId: string; title: string }>;
  /**
   * A file of the holder's own, uploaded right here among its papers (2026-10-29: a clearing agent on an import holds no
   * papers of the importer's to choose from). Returns the new paper's id.
   */
  upload?: (file: File, kind: 'bill_of_lading' | 'other', title: string) => Promise<{ documentId?: string; error?: string }>;
  defaults: { containerNo?: string; issuerCountry?: string };
  calls: FblCalls;
  onKept: () => void | Promise<void>;
}) {
  const t = useT();
  const word = (b: Box) => t(`tower.fbl.box.${b}` as MessageKey);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ form: 'fbl' as 'fbl' | 'fwb', number: '', issuer: '', country: defaults.issuerCountry ?? '', issuedOn: today(), electronic: false, seaLeg: true, documentId: '', containerNo: defaults.containerNo ?? '', seals: '', packages: '', gross: '', pol: '', pod: '', consignedTo: '', originals: '' });
  const [printed, setPrinted] = useState<Box[]>([]);
  const [check, setCheck] = useState({ registered: true, fiataId: '', issuerShown: '', proof: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Papers uploaded here, offered at once beside the ones the screen already knew.
  const [added, setAdded] = useState<Array<{ documentId: string; title: string }>>([]);
  const papers = [...documents, ...added.filter((a) => !documents.some((d) => d.documentId === a.documentId))];
  const send = async (file: File | undefined, kind: 'bill_of_lading' | 'other', title: string, use: (documentId: string) => void) => {
    if (!file || !upload) return;
    setBusy(true);
    setError(null);
    const r = await upload(file, kind, title);
    setBusy(false);
    if (!r.documentId) return setError(r.error || t('tower.fbl.uploadFailed'));
    setAdded((list) => [...list, { documentId: r.documentId!, title }]);
    use(r.documentId);
  };

  const act = async (fn: () => Result, after?: () => void) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.error) return setError(r.error.detail || r.error.title || t('tower.fbl.failed'));
    after?.();
    await onKept();
  };
  const boxes = BOXES.filter((b) => (form.form === 'fbl' || !FBL_ONLY.includes(b)) && (form.seaLeg || !SEA_ONLY.includes(b)));
  const num = (v: string) => (v.trim() && Number(v) >= 0 ? Number(v) : undefined);
  const ready = Boolean(form.number.trim().length >= 3 && form.issuer.trim() && /^[A-Za-z]{2}$/.test(form.country) && (form.electronic || form.documentId));

  const c = fbl?.check;
  const missing = c?.findings.filter((f) => f.kind === 'missing') ?? [];
  const asks = c?.findings.filter((f) => f.kind === 'ask') ?? [];
  const differs = fbl?.matches.filter((m) => !m.agrees) ?? [];
  const hint = !fbl ? t('tower.fbl.fold.none') : missing.length || differs.length || fbl.verified === 'not_registered' ? t('tower.fbl.fold.gaps', { n: missing.length + differs.length + (fbl.verified === 'not_registered' ? 1 : 0) }) : t('tower.fbl.fold.complete', { number: fbl.number });

  return (
    <ConsoleFold title={<>{code} · {t('tower.fbl.title')}</>} hint={hint} defaultOpen={Boolean(fbl && (missing.length || differs.length || fbl.verified === 'not_registered'))}>
      <p class="cons__lede"><Abbreviated text={t('tower.fbl.lede')} /></p>
      {fbl && c ? (
        <>
          <p class="cons__lede">
            {t('tower.fbl.held', { form: c.form, number: fbl.number, issuer: fbl.issuer.name, country: fbl.issuer.country, day: fbl.issuedOn })}{' '}
            {fbl.electronic ? t('tower.fbl.electronic') : fbl.documentTitle ? t('tower.fbl.copy', { title: fbl.documentTitle }) : ''}
          </p>
          <p class="chint">
            <span class={`ctag ctag--${c.complete ? 'ok' : 'warn'}`}>{t(c.complete ? 'tower.fbl.complete' : 'tower.fbl.incomplete')}</span>{' '}
            <Abbreviated text={t('tower.fbl.against', { conditions: c.conditions })} />
          </p>
          {missing.map((f) => (
            <div class="crow" key={`m-${f.key}`}>
              <span class="crow__body">
                <span class="crow__top"><span class="crow__name">{word(f.key)}</span><span class="ctag ctag--warn">{t('tower.fbl.missing')}</span></span>
                <span class="crow__sub"><Abbreviated text={f.rule} /></span>
              </span>
            </div>
          ))}
          {asks.map((f) => (
            <div class="crow" key={`a-${f.key}`}>
              <span class="crow__body">
                <span class="crow__top"><span class="crow__name">{word(f.key)}</span><span class="ctag ctag--quiet">{t('tower.fbl.ask')}</span></span>
                <span class="crow__sub"><Abbreviated text={f.rule} /></span>
              </span>
            </div>
          ))}
          {fbl.matches.map((m) => (
            <div class="crow" key={m.field}>
              <span class="crow__body">
                <span class="crow__top">
                  <span class="crow__name">{t(MATCH_WORD[m.field])}</span>
                  <span class={`ctag ctag--${m.agrees ? 'ok' : 'warn'}`}>{t(m.agrees ? 'tower.fbl.match.agrees' : 'tower.fbl.match.differs')}</span>
                </span>
                <span class="crow__sub">{t('tower.fbl.match.line', { printed: m.printed, ours: m.ours || t('tower.fbl.match.oursNone') })}</span>
                {m.why ? <span class="crow__sub">{m.why}</span> : null}
              </span>
            </div>
          ))}
          {fbl.matches.length ? <p class="chint">{t('tower.fbl.match.provesNothing')}</p> : null}

          <p class="cfield__label">{t('tower.fbl.genuineTitle')}</p>
          <p class="chint">
            <Abbreviated text={c.genuine.says} />{' '}
            <a href={c.genuine.where} target="_blank" rel="noopener noreferrer">{t(fbl.electronic ? 'tower.fbl.verifyLink' : 'tower.fbl.directoryLink')}</a>
          </p>
          {fbl.verification ? (
            <p class="chint">
              <span class={`ctag ctag--${fbl.verification.registered ? 'ok' : 'warn'}`}>{t(fbl.verification.registered ? 'tower.fbl.registered' : 'tower.fbl.notRegistered')}</span>{' '}
              <Abbreviated text={t('tower.fbl.checkedBy', { by: fbl.verification.by, day: fbl.verification.at.slice(0, 10), proof: fbl.verification.proofTitle })} />
              {fbl.verification.fiataId ? ` ${t('tower.fbl.fiataId', { id: fbl.verification.fiataId })}` : ''}
              {fbl.verification.issuerShown ? ` ${t('tower.fbl.issuerShown', { issuer: fbl.verification.issuerShown })}` : ''}
            </p>
          ) : null}
          {fbl.electronic && canVerify && (papers.length || upload) ? (
            <div class="twr-knobs">
              <p class="chint"><Abbreviated text={t('tower.fbl.recordHint')} /></p>
              <label class="cfield cfield--check">
                <input type="checkbox" checked={check.registered} onChange={(e) => setCheck({ ...check, registered: (e.target as HTMLInputElement).checked })} />
                <span>{t('tower.fbl.f.registered')}</span>
              </label>
              <div class="twr-knobs__row">
                <label class="twr-knob cfield">
                  <span class="cfield__label">{t('tower.fbl.f.fiataId')}</span>
                  <input class="cinput" maxLength={80} value={check.fiataId} onInput={(e) => setCheck({ ...check, fiataId: (e.target as HTMLInputElement).value })} />
                </label>
                <label class="twr-knob cfield">
                  <span class="cfield__label">{t('tower.fbl.f.issuerShown')}</span>
                  <input class="cinput" maxLength={160} value={check.issuerShown} onInput={(e) => setCheck({ ...check, issuerShown: (e.target as HTMLInputElement).value })} />
                </label>
              </div>
              {papers.length ? <ConsolePick label={t('tower.fbl.f.proof')} value={check.proof} onChange={(proof) => setCheck({ ...check, proof })} options={papers.map((d) => ({ value: d.documentId, label: d.title }))} /> : null}
              {upload ? (
                <label class="cfield">
                  <span class="cfield__label">{t('tower.fbl.f.uploadProof')}</span>
                  <input class="cinput" type="file" accept="image/*,application/pdf" disabled={busy} onChange={(e) => void send((e.target as HTMLInputElement).files?.[0], 'other', t('tower.fbl.proofTitle', { number: fbl.number }), (proof) => setCheck((c0) => ({ ...c0, proof })))} />
                </label>
              ) : null}
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy || !check.proof} onClick={() => void act(() => calls.verified({ registered: check.registered, ...(check.fiataId.trim() ? { fiataId: check.fiataId.trim() } : {}), ...(check.issuerShown.trim() ? { issuerShown: check.issuerShown.trim() } : {}), proofDocumentId: check.proof }))}>
                  {t('tower.fbl.recordCheck')}
                </button>
              </div>
            </div>
          ) : null}

          <p class="cfield__label">{t('tower.fbl.meaningTitle')}</p>
          <ul class="twr-checklist">
            {[...c.meaning, ...c.limits, ...c.claims].map((line, i) => (
              <li key={`l-${i}`}><span><Abbreviated text={line} /></span></li>
            ))}
            {c.country.map((n) => (
              <li key={`c-${n.country}`}><span><Abbreviated text={n.says} /></span></li>
            ))}
          </ul>
          <p class="chint"><Abbreviated text={t('tower.fbl.rate', { usd: c.sdrRate.usd, day: c.sdrRate.on })} /></p>
          <p class="chint">
            {t('tower.fbl.sources')}{' '}
            {c.sources.filter(isUrl).map((s, i) => (
              <a key={s} href={s} target="_blank" rel="noopener noreferrer">{i ? ', ' : ''}{new URL(s).hostname}</a>
            ))}
          </p>
          {fbl.replaced ? <p class="chint">{t('tower.fbl.replaced', { n: fbl.replaced })}</p> : null}
        </>
      ) : null}

      {canKeep && !open ? (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setOpen(true)}>{t(fbl ? 'tower.fbl.keepNew' : 'tower.fbl.keep')}</button>
        </div>
      ) : null}
      {canKeep && open ? (
        <div class="twr-knobs">
          <div class="twr-knobs__row">
            <ConsolePick label={t('tower.fbl.f.form')} value={form.form} onChange={(f) => setForm({ ...form, form: f as 'fbl' | 'fwb' })} options={[{ value: 'fbl', label: t('tower.fbl.form.fbl') }, { value: 'fwb', label: t('tower.fbl.form.fwb') }]} />
            <label class="twr-knob cfield">
              <span class="cfield__label">{t('tower.fbl.f.number')}</span>
              <input class="cinput" maxLength={60} value={form.number} onInput={(e) => setForm({ ...form, number: (e.target as HTMLInputElement).value })} />
            </label>
          </div>
          <div class="twr-knobs__row">
            <label class="twr-knob cfield">
              <span class="cfield__label">{t('tower.fbl.f.issuer')}</span>
              <input class="cinput" maxLength={120} value={form.issuer} onInput={(e) => setForm({ ...form, issuer: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="twr-knob cfield">
              <span class="cfield__label">{t('tower.fbl.f.country')}</span>
              <input class="cinput" maxLength={2} value={form.country} onInput={(e) => setForm({ ...form, country: (e.target as HTMLInputElement).value.toUpperCase() })} />
            </label>
            <label class="twr-knob cfield">
              <span class="cfield__label">{t('tower.fbl.f.issuedOn')}</span>
              <input class="cinput" type="date" max={today()} value={form.issuedOn} onInput={(e) => setForm({ ...form, issuedOn: (e.target as HTMLInputElement).value })} />
            </label>
          </div>
          <label class="cfield cfield--check">
            <input type="checkbox" checked={form.electronic} onChange={(e) => setForm({ ...form, electronic: (e.target as HTMLInputElement).checked })} />
            <span>{t('tower.fbl.f.electronic')}</span>
          </label>
          <label class="cfield cfield--check">
            <input type="checkbox" checked={form.seaLeg} onChange={(e) => setForm({ ...form, seaLeg: (e.target as HTMLInputElement).checked })} />
            <span>{t('tower.fbl.f.seaLeg')}</span>
          </label>
          {papers.length ? (
            <ConsolePick label={t('tower.fbl.f.copy')} value={form.documentId} onChange={(documentId) => setForm({ ...form, documentId })} options={[{ value: '', label: t('tower.fbl.f.noCopy') }, ...papers.map((d) => ({ value: d.documentId, label: d.title }))]} />
          ) : null}
          {upload ? (
            <label class="cfield">
              <span class="cfield__label">{t('tower.fbl.f.uploadCopy')}</span>
              <input class="cinput" type="file" accept="image/*,application/pdf" disabled={busy} onChange={(e) => void send((e.target as HTMLInputElement).files?.[0], 'bill_of_lading', t('tower.fbl.copyTitle', { number: form.number.trim() || code }), (documentId) => setForm((f0) => ({ ...f0, documentId })))} />
            </label>
          ) : null}
          <div class="cfield">
            <span class="cfield__label">{t('tower.fbl.f.printed')}</span>
            <span class="chint">{t('tower.fbl.f.printedHint')}</span>
            <div role="group" aria-label={t('tower.fbl.f.printed')} style="display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:6px">
              {boxes.map((b) => (
                <label class="cfield cfield--check" key={b}>
                  <input type="checkbox" checked={printed.includes(b)} onChange={(e) => setPrinted((e.target as HTMLInputElement).checked ? [...printed.filter((x) => x !== b), b] : printed.filter((x) => x !== b))} />
                  <span>{word(b)}</span>
                </label>
              ))}
            </div>
          </div>
          <span class="cfield__label">{t('tower.fbl.f.asPrinted')}</span>
          <div class="twr-knobs__row">
            <label class="twr-knob cfield"><span class="cfield__label">{t('tower.fbl.f.containerNo')}</span><input class="cinput" maxLength={20} value={form.containerNo} onInput={(e) => setForm({ ...form, containerNo: (e.target as HTMLInputElement).value })} /></label>
            <label class="twr-knob cfield"><span class="cfield__label">{t('tower.fbl.f.seals')}</span><input class="cinput" maxLength={200} value={form.seals} onInput={(e) => setForm({ ...form, seals: (e.target as HTMLInputElement).value })} /></label>
          </div>
          <div class="twr-knobs__row">
            <label class="twr-knob cfield"><span class="cfield__label">{t('tower.fbl.f.packages')}</span><input class="cinput" type="number" min={0} value={form.packages} onInput={(e) => setForm({ ...form, packages: (e.target as HTMLInputElement).value })} /></label>
            <label class="twr-knob cfield"><span class="cfield__label">{t('tower.fbl.f.gross')}</span><input class="cinput" type="number" min={0} value={form.gross} onInput={(e) => setForm({ ...form, gross: (e.target as HTMLInputElement).value })} /></label>
            {form.form === 'fbl' ? (
              <label class="twr-knob cfield"><span class="cfield__label">{t('tower.fbl.f.originals')}</span><input class="cinput" type="number" min={1} value={form.originals} onInput={(e) => setForm({ ...form, originals: (e.target as HTMLInputElement).value })} /></label>
            ) : null}
          </div>
          <div class="twr-knobs__row">
            <label class="twr-knob cfield"><span class="cfield__label">{t('tower.fbl.f.pol')}</span><input class="cinput" maxLength={80} value={form.pol} onInput={(e) => setForm({ ...form, pol: (e.target as HTMLInputElement).value })} /></label>
            <label class="twr-knob cfield"><span class="cfield__label">{t('tower.fbl.f.pod')}</span><input class="cinput" maxLength={80} value={form.pod} onInput={(e) => setForm({ ...form, pod: (e.target as HTMLInputElement).value })} /></label>
            <label class="twr-knob cfield"><span class="cfield__label">{t('tower.fbl.f.consignedTo')}</span><input class="cinput" maxLength={160} value={form.consignedTo} onInput={(e) => setForm({ ...form, consignedTo: (e.target as HTMLInputElement).value })} /></label>
          </div>
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setOpen(false)}>{t('tower.fbl.cancel')}</button>
            <button
              type="button"
              class="cbtn cbtn--primary cbtn--sm"
              disabled={busy || !ready}
              onClick={() =>
                void act(
                  () =>
                    calls.keep({
                      form: form.form,
                      number: form.number.trim(),
                      issuer: { name: form.issuer.trim(), country: form.country.toUpperCase() },
                      issuedOn: form.issuedOn,
                      electronic: form.electronic,
                      seaLeg: form.seaLeg,
                      printed: printed.filter((b) => boxes.includes(b)),
                      ...(form.documentId ? { documentId: form.documentId } : {}),
                      ...(form.containerNo.trim() ? { containerNo: form.containerNo.trim() } : {}),
                      ...(form.seals.trim() ? { seals: form.seals.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
                      ...(num(form.packages) != null ? { packages: Math.round(num(form.packages)!) } : {}),
                      ...(num(form.gross) != null ? { grossWeightKg: num(form.gross)! } : {}),
                      ...(form.pol.trim() ? { portOfLoading: form.pol.trim() } : {}),
                      ...(form.pod.trim() ? { portOfDischarge: form.pod.trim() } : {}),
                      ...(form.consignedTo.trim() ? { consignedTo: form.consignedTo.trim() } : {}),
                      ...(form.form === 'fbl' && num(form.originals) ? { originals: Math.round(num(form.originals)!) } : {}),
                    }),
                  () => {
                    setOpen(false);
                    setPrinted([]);
                  },
                )
              }
            >
              {t('tower.fbl.save')}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
    </ConsoleFold>
  );
}

/** A picked file as a data URL, for an upload among the company's papers. */
export const fileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** Where anybody can look up whether a forwarder or agent is a FIATA member — we check nobody's (2026-10-29). */
export function FiataDirectoryHint() {
  const t = useT();
  return (
    <p class="chint">
      <Abbreviated text={t('tower.fbl.directoryHint')} />{' '}
      <a href={FIATA_DIRECTORY} target="_blank" rel="noopener noreferrer">{t('tower.fbl.directoryLink')}</a>
    </p>
  );
}

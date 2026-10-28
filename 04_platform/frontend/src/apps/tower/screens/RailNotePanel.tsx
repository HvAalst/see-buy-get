import { useEffect, useState } from 'preact/hooks';
import type { components } from '../../../lib/sbg/schema';
import { useT, type MessageKey } from '../../../shared/i18n';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { ConsoleFold } from '../ConsoleFold';
import { ConsolePick } from '../ConsolePick';

export type RailNoteView = components['schemas']['RailNoteView'];
export type RailNoteCheck = components['schemas']['RailNoteCheckView'];
export type RailwayRow = components['schemas']['RailwayRow'];
type Particular = RailNoteCheck['asked'][number];
type Load = RailNoteView['load'];

/** What is kept: the railway's note as its holder read it (rail-note.types.ts, RailNoteDto). */
export interface RailNoteInput {
  railway: string;
  railwayName?: string;
  from: { name: string; country: string };
  to: { name: string; country: string };
  noteNumber?: string;
  madeOutOn: string;
  load: Load;
  dangerous?: boolean;
  printed: Particular[];
  electronic?: { reference?: string; printoutLine?: boolean };
  documentId?: string;
  containerNo?: string;
  seals?: string[];
}

/** A draft, checked against the law of its lane before anything is kept (rail/check). */
export interface RailCheckInput {
  railway?: string;
  from: string;
  to: string;
  madeOutOn: string;
  load: Load;
  dangerous?: boolean;
  printed: Particular[];
  electronic?: { reference?: string; printoutLine?: boolean };
}

type Result<T> = Promise<{ data?: T | null; error?: { detail?: string; title?: string } | null }>;

export interface RailNoteCalls {
  railways(): Result<{ items: RailwayRow[] }>;
  check(draft: RailCheckInput): Result<RailNoteCheck>;
  keep(input: RailNoteInput): Result<unknown>;
}

const UNLESS: Record<string, MessageKey> = { no_documents: 'tower.rail.unless.no_documents', no_seals: 'tower.rail.unless.no_seals', nothing_to_pay: 'tower.rail.unless.nothing_to_pay' };
const LOADS: Load[] = ['container', 'wagon', 'packages'];
const today = () => new Date().toISOString().slice(0, 10);

/**
 * THE RAILWAY'S NOTE, HELD (the user, 2026-10-28: "for now we hold the note but we should be able to see whether it is
 * valid … reduce mistakes and delays … where road and rail comes together"). The railway issued it; whoever holds it keeps
 * a copy here and ticks what is printed on it — asked only what the law of its lane asks (rail/check). Read back: complete
 * or not for those rules, as printed; what a gap costs; the box's number and seals against ours. Never "valid" on our word.
 *
 * Shared by an export (Business app) and an import (console screen the Business app hosts): the note is the same thing.
 */
export function RailNotePanel({ code, rail, canKeep, documents, defaults, calls, onKept }: {
  code: string;
  rail?: RailNoteView;
  canKeep: boolean;
  documents: Array<{ documentId: string; title: string }>;
  defaults: { fromCountry: string; toCountry: string; containerNo?: string; dangerous?: boolean };
  calls: RailNoteCalls;
  onKept: () => void | Promise<void>;
}) {
  const t = useT();
  const word = (p: Particular) => t(`tower.rail.p.${p}` as MessageKey);
  const [open, setOpen] = useState(false);
  const [railways, setRailways] = useState<RailwayRow[]>([]);
  const [form, setForm] = useState({
    railway: '',
    railwayName: '',
    fromName: '',
    fromCountry: defaults.fromCountry,
    toName: '',
    toCountry: defaults.toCountry,
    noteNumber: '',
    madeOutOn: today(),
    load: (defaults.containerNo ? 'container' : 'wagon') as Load,
    dangerous: Boolean(defaults.dangerous),
    electronic: false,
    reference: '',
    printoutLine: true,
    documentId: '',
    containerNo: defaults.containerNo ?? '',
    seals: '',
  });
  const [printed, setPrinted] = useState<Particular[]>([]);
  const [asked, setAsked] = useState<RailNoteCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || railways.length) return;
    void calls.railways().then((r) => setRailways(r.data?.items ?? []));
  }, [open]);

  // What the lane asks, read again whenever the lane, the load or the day changes: only those are ticked.
  const countriesOk = /^[A-Za-z]{2}$/.test(form.fromCountry) && /^[A-Za-z]{2}$/.test(form.toCountry);
  useEffect(() => {
    if (!open || !countriesOk || !form.railway) return setAsked(null);
    let stale = false;
    void calls
      .check({ ...(form.railway !== 'other' ? { railway: form.railway } : {}), from: form.fromCountry.toUpperCase(), to: form.toCountry.toUpperCase(), madeOutOn: form.madeOutOn, load: form.load, ...(form.dangerous ? { dangerous: true } : {}), printed: [] })
      .then((r) => !stale && setAsked(r.data ?? null));
    return () => {
      stale = true;
    };
  }, [open, form.railway, form.fromCountry, form.toCountry, form.madeOutOn, form.load, form.dangerous]);

  const ready = Boolean(form.railway && (form.railway !== 'other' || form.railwayName.trim()) && form.fromName.trim() && form.toName.trim() && countriesOk && (form.noteNumber.trim() || form.documentId || (form.electronic && form.reference.trim())));

  const keep = async () => {
    setBusy(true);
    setError(null);
    const seals = form.seals.split(',').map((s) => s.trim()).filter(Boolean);
    const r = await calls.keep({
      railway: form.railway,
      ...(form.railway === 'other' ? { railwayName: form.railwayName.trim() } : {}),
      from: { name: form.fromName.trim(), country: form.fromCountry.toUpperCase() },
      to: { name: form.toName.trim(), country: form.toCountry.toUpperCase() },
      ...(form.noteNumber.trim() ? { noteNumber: form.noteNumber.trim() } : {}),
      madeOutOn: form.madeOutOn,
      load: form.load,
      ...(form.dangerous ? { dangerous: true } : {}),
      printed: printed.filter((p) => asked?.asked.includes(p)),
      ...(form.electronic ? { electronic: { ...(form.reference.trim() ? { reference: form.reference.trim() } : {}), printoutLine: form.printoutLine } } : {}),
      ...(form.documentId ? { documentId: form.documentId } : {}),
      ...(form.containerNo.trim() ? { containerNo: form.containerNo.trim() } : {}),
      ...(seals.length ? { seals } : {}),
    });
    setBusy(false);
    if (r.error) return setError(r.error.detail || r.error.title || t('tower.rail.failed'));
    setOpen(false);
    setPrinted([]);
    await onKept();
  };

  const check = rail?.check;
  const missing = check?.findings.filter((f) => f.kind === 'missing') ?? [];
  const asks = check?.findings.filter((f) => f.kind === 'ask') ?? [];
  const differs = rail?.matches.filter((m) => !m.agrees) ?? [];
  const hint = !rail
    ? t('tower.rail.fold.none')
    : check?.notChecked
      ? t('tower.rail.fold.notChecked', { number: rail.noteNumber ?? rail.railwayName })
      : missing.length || differs.length || check?.electronic.length
        ? t('tower.rail.fold.gaps', { n: missing.length + differs.length + (check?.electronic.length ?? 0) })
        : t('tower.rail.fold.complete');

  return (
    <ConsoleFold title={<>{code} · {t('tower.rail.title')}</>} hint={hint} defaultOpen={Boolean(rail && (missing.length || differs.length))}>
      <p class="cons__lede">{t('tower.rail.lede')}</p>
      {rail && check ? (
        <>
          <p class="cons__lede">
            {t('tower.rail.held', { railway: rail.railwayName, from: rail.from.name, to: rail.to.name, day: rail.madeOutOn })}
            {rail.noteNumber ? ` ${t('tower.rail.number', { number: rail.noteNumber })}` : ''}
            {rail.electronic?.reference ? ` ${t('tower.rail.reference', { reference: rail.electronic.reference })}` : ''}
            {rail.documentTitle ? ` ${t('tower.rail.copy', { title: rail.documentTitle })}` : ''}
          </p>
          {check.notChecked ? (
            <p class="chint"><Abbreviated text={check.notChecked} /></p>
          ) : (
            <p class="chint">
              <span class={`ctag ctag--${check.complete ? 'ok' : 'warn'}`}>{t(check.complete ? 'tower.rail.complete' : 'tower.rail.incomplete')}</span>{' '}
              <Abbreviated text={t('tower.rail.against', { rules: check.rules.join('; '), day: check.checkedOn })} />
            </p>
          )}
          {missing.map((f) => (
            <div class="crow" key={`m-${f.key}`}>
              <span class="crow__body">
                <span class="crow__top"><span class="crow__name">{word(f.key)}</span><span class="ctag ctag--warn">{t('tower.rail.missing')}</span></span>
                <span class="crow__sub"><Abbreviated text={f.rule} /></span>
              </span>
            </div>
          ))}
          {asks.map((f) => (
            <div class="crow" key={`a-${f.key}`}>
              <span class="crow__body">
                <span class="crow__top"><span class="crow__name">{word(f.key)}</span><span class="ctag ctag--quiet">{t('tower.rail.ask')}</span></span>
                <span class="crow__sub">{t('tower.rail.neededIf', { when: f.unless ? t(UNLESS[f.unless]) : '' })} — <Abbreviated text={f.rule} /></span>
              </span>
            </div>
          ))}
          {check.electronic.map((e) => (
            <p class="chint" key={e.code}><span class="ctag ctag--warn">{t('tower.rail.electronic')}</span> <Abbreviated text={e.detail} /></p>
          ))}
          {rail.matches.map((m) => (
            <div class="crow" key={m.field}>
              <span class="crow__body">
                <span class="crow__top">
                  <span class="crow__name">{t(m.field === 'containerNo' ? 'tower.rail.match.box' : 'tower.rail.match.seals')}</span>
                  <span class={`ctag ctag--${m.agrees ? 'ok' : 'warn'}`}>{t(m.agrees ? 'tower.rail.match.agrees' : 'tower.rail.match.differs')}</span>
                </span>
                <span class="crow__sub">{t('tower.rail.match.line', { printed: m.printed, ours: m.ours ?? t('tower.rail.match.oursNone') })}</span>
                {m.why ? <span class="crow__sub">{m.why}</span> : null}
              </span>
            </div>
          ))}
          {check.caveats.map((c, i) => (
            <p class="chint" key={`c-${i}`}><Abbreviated text={c} /></p>
          ))}
          {check.limits.length || check.claims.length ? (
            <>
              <p class="cfield__label">{t('tower.rail.wrong')}</p>
              <ul class="twr-checklist">
                {[...check.limits, ...check.claims].map((line, i) => (
                  <li key={`l-${i}`}><span><Abbreviated text={line} /></span></li>
                ))}
              </ul>
            </>
          ) : null}
          {check.sources.length ? (
            <p class="chint">
              {t('tower.rail.sources')}{' '}
              {check.sources.map((s, i) => (
                <a key={s} href={s} target="_blank" rel="noopener noreferrer">{i ? ', ' : ''}{new URL(s).hostname}</a>
              ))}
            </p>
          ) : null}
          {rail.replaced ? <p class="chint">{t('tower.rail.replaced', { n: rail.replaced })}</p> : null}
        </>
      ) : null}

      {canKeep && !open ? (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setOpen(true)}>{t(rail ? 'tower.rail.keepNew' : 'tower.rail.keep')}</button>
        </div>
      ) : null}
      {canKeep && open ? (
        <div class="twr-knobs">
          <div class="twr-knobs__row">
            <ConsolePick
              label={t('tower.rail.f.railway')}
              value={form.railway}
              onChange={(railway) => setForm({ ...form, railway })}
              options={[
                ...[...railways].sort((a, b) => Number(b.countries.includes(form.fromCountry.toUpperCase()) || b.countries.includes(form.toCountry.toUpperCase())) - Number(a.countries.includes(form.fromCountry.toUpperCase()) || a.countries.includes(form.toCountry.toUpperCase()))).map((r) => ({ value: r.key, label: r.name, sub: r.particularsChecked ? r.countries.join(', ') : t('tower.rail.f.notRead', { countries: r.countries.join(', ') }) })),
                { value: 'other', label: t('tower.rail.f.other') },
              ]}
            />
            {form.railway === 'other' ? (
              <label class="twr-knob cfield">
                <span class="cfield__label">{t('tower.rail.f.railwayName')}</span>
                <input class="cinput" maxLength={80} value={form.railwayName} onInput={(e) => setForm({ ...form, railwayName: (e.target as HTMLInputElement).value })} />
              </label>
            ) : null}
          </div>
          <div class="twr-knobs__row">
            <label class="twr-knob cfield">
              <span class="cfield__label">{t('tower.rail.f.from')}</span>
              <input class="cinput" maxLength={80} value={form.fromName} onInput={(e) => setForm({ ...form, fromName: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="twr-knob cfield">
              <span class="cfield__label">{t('tower.rail.f.country')}</span>
              <input class="cinput" maxLength={2} value={form.fromCountry} onInput={(e) => setForm({ ...form, fromCountry: (e.target as HTMLInputElement).value.toUpperCase() })} />
            </label>
          </div>
          <div class="twr-knobs__row">
            <label class="twr-knob cfield">
              <span class="cfield__label">{t('tower.rail.f.to')}</span>
              <input class="cinput" maxLength={80} value={form.toName} onInput={(e) => setForm({ ...form, toName: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="twr-knob cfield">
              <span class="cfield__label">{t('tower.rail.f.country')}</span>
              <input class="cinput" maxLength={2} value={form.toCountry} onInput={(e) => setForm({ ...form, toCountry: (e.target as HTMLInputElement).value.toUpperCase() })} />
            </label>
          </div>
          <div class="twr-knobs__row">
            <label class="twr-knob cfield">
              <span class="cfield__label">{t('tower.rail.f.number')}</span>
              <input class="cinput" maxLength={60} value={form.noteNumber} onInput={(e) => setForm({ ...form, noteNumber: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="twr-knob cfield">
              <span class="cfield__label">{t('tower.rail.f.madeOut')}</span>
              <input class="cinput" type="date" max={today()} value={form.madeOutOn} onInput={(e) => setForm({ ...form, madeOutOn: (e.target as HTMLInputElement).value })} />
            </label>
          </div>
          <div class="twr-knobs__row">
            <ConsolePick label={t('tower.rail.f.load')} value={form.load} onChange={(load) => setForm({ ...form, load: load as Load })} options={LOADS.map((l) => ({ value: l, label: t(`tower.rail.load.${l}` as MessageKey) }))} />
            {documents.length ? (
              <ConsolePick label={t('tower.rail.f.copy')} value={form.documentId} onChange={(documentId) => setForm({ ...form, documentId })} options={[{ value: '', label: t('tower.rail.f.noCopy') }, ...documents.map((d) => ({ value: d.documentId, label: d.title }))]} />
            ) : null}
          </div>
          <div class="twr-knobs__row">
            <label class="twr-knob cfield">
              <span class="cfield__label">{t('tower.rail.f.box')}</span>
              <input class="cinput" maxLength={20} value={form.containerNo} onInput={(e) => setForm({ ...form, containerNo: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="twr-knob cfield">
              <span class="cfield__label">{t('tower.rail.f.seals')}</span>
              <input class="cinput" maxLength={200} value={form.seals} onInput={(e) => setForm({ ...form, seals: (e.target as HTMLInputElement).value })} />
            </label>
          </div>
          <label class="cfield cfield--check">
            <input type="checkbox" checked={form.dangerous} onChange={(e) => setForm({ ...form, dangerous: (e.target as HTMLInputElement).checked })} />
            <span>{t('tower.rail.f.dangerous')}</span>
          </label>
          <label class="cfield cfield--check">
            <input type="checkbox" checked={form.electronic} onChange={(e) => setForm({ ...form, electronic: (e.target as HTMLInputElement).checked })} />
            <span>{t('tower.rail.f.electronic')}</span>
          </label>
          {form.electronic ? (
            <div class="twr-knobs__row">
              <label class="twr-knob cfield">
                <span class="cfield__label">{t('tower.rail.f.reference')}</span>
                <input class="cinput" maxLength={80} value={form.reference} onInput={(e) => setForm({ ...form, reference: (e.target as HTMLInputElement).value })} />
              </label>
              <label class="cfield cfield--check">
                <input type="checkbox" checked={form.printoutLine} onChange={(e) => setForm({ ...form, printoutLine: (e.target as HTMLInputElement).checked })} />
                <span>{t('tower.rail.f.printoutLine')}</span>
              </label>
            </div>
          ) : null}

          {asked ? (
            <div class="cfield">
              <span class="cfield__label">{t('tower.rail.f.printed')}</span>
              {asked.notChecked ? (
                <span class="chint"><Abbreviated text={asked.notChecked} /></span>
              ) : (
                <>
                  <span class="chint"><Abbreviated text={t('tower.rail.f.printedHint', { rules: asked.rules.join('; ') })} /></span>
                  <div role="group" aria-label={t('tower.rail.f.printed')} style="display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:6px">
                    {asked.asked.map((p) => (
                      <label class="cfield cfield--check" key={p}>
                        <input type="checkbox" checked={printed.includes(p)} onChange={(e) => setPrinted((e.target as HTMLInputElement).checked ? [...printed.filter((x) => x !== p), p] : printed.filter((x) => x !== p))} />
                        <span>{word(p)}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
              {asked.caveats.map((c, i) => (
                <span class="chint" key={`ac-${i}`}><Abbreviated text={c} /></span>
              ))}
            </div>
          ) : null}
          {error ? <p class="cerr" role="alert">{error}</p> : null}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setOpen(false)}>{t('tower.rail.cancel')}</button>
            <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy || !ready} onClick={() => void keep()}>{t('tower.rail.save')}</button>
          </div>
        </div>
      ) : null}
    </ConsoleFold>
  );
}

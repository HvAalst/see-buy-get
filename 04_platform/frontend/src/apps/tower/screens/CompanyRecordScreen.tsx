import { Abbreviated } from '../../../shared/ui/Abbr';
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { ConsolePick } from '../ConsolePick';
import { ConsoleFold } from '../ConsoleFold';
import { useT } from '../../../shared/i18n';
import { paperForUpload } from '../../../shared/media';
import { uploadFailureSentence } from '../../../shared/ui/ErrorNote';
import { UPLOAD_LIMITS, refusalWords, uploadHint } from '../../../shared/upload';
import { tabAtTheTap } from '../../../shared/openPage';
import {
  DOCUMENT_KINDS,
  DOCUMENT_LABEL,
  INSURANCE_LABEL,
  LEGAL_FORMS,
  LEGAL_FORM_LABEL,
  LICENCE_LABEL,
  PAPER_KINDS_FOR,
  PRESENCE_CAPABILITIES,
  REFERENCE_FIELD,
  SECTION_FIELDS,
  SECTION_TITLE,
  declarationBody,
  declareBlocker,
  declareFields,
  documentBlocker,
  emptyRow,
  fromEditRows,
  isPaperBound,
  itemLine,
  mayTakeOff,
  needsRelatesTo,
  readinessCounts,
  openWarnings,
  recordHands,
  recordLede,
  relatesToChoices,
  runningOutHint,
  shortFingerprint,
  toEditRows,
  uploadBlocker,
  type CompanyAddress,
  type CompanyDocument,
  type CompanyRecord,
  type CompanyRecordView,
  type DocumentKind,
  type EditRow,
  type ListSection,
  type PaperBoundSection,
} from '../company';
import { CAPABILITY_LABEL, type PresenceCapability } from '../presence';
import type { TowerActions, TowerState } from '../useTowerApp';
import { holds } from '../staffRoles';
import { addressesHint, changesHint, documentsFold, lapsesFold, legalHint, listHint, obligationsHint, partsStillToDo, readinessFold, runningOutFold, type RecordPart } from '../folds';
import { LapsingPapers } from './LapsingPapers';
import { CATEGORY_LABEL, REPORT_CATEGORIES, lastDecidedOf, mayReport, openCaseOf, reportBlocker, type PaperCase, type ReportCategory } from '../paperReports';

/**
 * CA3–CA8 — ONE COMPANY, RECORDED PROPERLY.
 *
 * Everything that makes a company of ours (or a partner) real, entered from the network side before its country is
 * switched on: the legal form and registration, who may sign, who owns it, its tax numbers, its bank, its licences
 * and insurance, what its country requires — and the papers behind all of it, fingerprinted and verified by a
 * second person. The checklist at the top is the server's, so the screen can never call a company ready that is not.
 */
export function CompanyRecordScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const entityId = state.companyId;
  const who = state.who?.name;
  // WHOSE HANDS THE RECORD IS IN (the user, 2026-10-09): staff's until the company is switched on, the company's own
  // from then — and the server refuses the other every change. So the screen offers a change only to whoever keeps
  // it; the other reads every field and is offered none. A Save that can only answer "not allowed" is how this
  // screen read to a company's administrator before, and how it would now read to staff.
  const reader = state.who?.mode === 'operator' ? ('operator' as const) : ('company' as const);
  const [view, setView] = useState<CompanyRecordView | null>(null);
  // Round 38 — among staff, the record's fields are administration's to keep and its papers vetting's to judge. Somebody
  // holding only the other reads it all and is offered neither. A company is not held to roles.
  const keeps = holds(state.who?.roles, 'admin');
  const papers = holds(state.who?.roles, 'vetting');
  const hands = { ...recordHands(view, reader), ...(keeps ? {} : { mine: false }) };
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client || !entityId) return;
    const r = await client.api.companyRecord(entityId);
    if (r.error) {
      setError(r.error.detail || r.error.title);
      return;
    }
    setView(r.data as unknown as CompanyRecordView);
  }, [client, entityId]);

  useEffect(() => {
    setView(null);
    setError(null);
    setDone(null);
    void load();
  }, [load]);

  /** Every write goes through here: one busy flag, the refusal shown as the server said it, the record re-read after. */
  const run = async (key: string, write: () => Promise<{ error?: { detail?: string; title?: string } | null }>, message: string) => {
    setBusy(key);
    setError(null);
    setDone(null);
    const r = await write();
    setBusy(null);
    if (r.error) {
      // A file refused by the server is said in words, with its size and the most (2026-11-02).
      setError(refusalWords(r.error) ?? (r.error.detail || r.error.title || ''));
      return false;
    }
    setDone(message);
    await load();
    // A renewed licence is no longer running out, and a reported paper waits on staff: the numbers in the menu are counted again.
    actions.recordChanged();
    return true;
  };
  const saveRecord = (key: string, patch: Record<string, unknown>) =>
    client && entityId ? run(key, () => client.api.saveCompanyRecord(entityId, { ...patch, ...(who ? { by: who } : {}) }), t('tower.company.saved')) : Promise.resolve(false);

  const companies = (state.entities ?? []).filter((e) => e.kind !== 'group');
  // Which sections open themselves: those with an item of the switch-on checklist still to do. One clock for the screen.
  const today = new Date().toISOString().slice(0, 10);
  const toDo: Set<RecordPart> = view ? partsStillToDo(view, today) : new Set();
  const locked = !hands.mine;

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{view ? view.entity.name : t('tower.company.title')}</h1>
        {view || reader === 'operator' ? <p class="cons__lede">{t(view ? recordLede(hands, reader) : 'tower.company.lede')}</p> : null}
      </header>

      <section class="cons__panel">
        <div class="twr-corridorform">
          <ConsolePick
            label={t('tower.company.choose')}
            value={entityId ?? ''}
            onChange={(v) => actions.openCompany(v)}
            placeholder={t('tower.company.f.choose')}
            options={companies.map((c) => ({ value: c.entityId, label: c.name, tag: c.jurisdiction }))}
          />
        </div>
      </section>

      {done ? (
        <p class="twr-done">
          <Icon name="check" size={16} />
          {done}
        </p>
      ) : null}
      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}

      {!entityId ? null : !view ? (
        <p class="cons__empty">{t('tower.company.loading')}</p>
      ) : view.entity.kind === 'group' ? (
        <p class="cons__empty">{t('tower.company.groupNoRecord')}</p>
      ) : (
        <>
          <Readiness view={view} />
          <RunningOut view={view} hint={runningOutHint(hands, reader)} />
          {/* Each section disabled for whoever does not keep it — every field inside reads, and tower.css takes the
              buttons away. Inside each fold, not around them all: a disabled fieldset disables every button in it,
              and the fold's own headline is the button that opens it. */}
          <LegalSection view={view} locked={locked} open={toDo.has('legal')} busy={busy === 'legal'} onSave={(patch) => saveRecord('legal', patch)} />
          <AddressSection view={view} locked={locked} open={toDo.has('addresses')} busy={busy === 'addresses'} onSave={(patch) => saveRecord('addresses', patch)} />
          {(['representatives', 'beneficialOwners', 'taxRegistrations', ...(view.entity.kind === 'sister' ? (['bankAccounts'] as ListSection[]) : []), 'licences', 'insurance'] as ListSection[]).map((section) =>
            // In the company's own hands, the parts that switch something have no list to save: each item changes
            // by itself, with its paper.
            hands.keeper === 'company' && hands.mine && isPaperBound(section) ? (
              <PaperBoundEditor
                key={section}
                section={section}
                view={view}
                hint={listHint(section, view.record, today, t)}
                open={toDo.has(section)}
                busy={busy === section}
                onDeclare={(body) => (client && entityId ? run(section, () => client.api.declareCompanyChange(entityId, body), t(body.item ? 'tower.company.declare.done' : 'tower.company.declare.takenOff')) : Promise.resolve(false))}
              />
            ) : (
              <ListEditor
                key={section}
                section={section}
                view={view}
                locked={locked}
                hint={listHint(section, view.record, today, t)}
                open={toDo.has(section)}
                busy={busy === section}
                onSave={(rows) => saveRecord(section, { [section]: rows })}
              />
            ),
          )}
          <ObligationsSection view={view} locked={locked} open={toDo.has('obligations')} busy={busy === 'obligations'} onSave={(rows) => saveRecord('obligations', { obligations: rows })} />
          <Documents
            view={view}
            toDo={toDo}
            who={who}
            named={Boolean(state.who?.named)}
            canVerify={reader === 'operator' && papers}
            canUpload={reader === 'company' || (hands.keeper === 'staff' && papers)}
            papers={papers}
            reader={reader}
            onReport={(documentId, body) => (client && entityId ? run(`report:${documentId}`, () => client.api.reportCompanyPaper(entityId, documentId, { ...body, ...(who ? { by: who } : {}) }), t('tower.paperReport.sent')) : Promise.resolve(false))}
            onAnswer={(caseId, body) => (client ? run(`answer:${caseId}`, () => client.api.answerPaperReport(caseId, body), t('tower.paperReport.answerSent')) : Promise.resolve(false))}
            busy={busy}
            onUpload={(body) => (client && entityId ? run('upload', () => client.api.uploadCompanyDocument(entityId, { ...body, ...(who ? { by: who } : {}) }), t('tower.company.doc.uploaded')) : Promise.resolve(false))}
            onVerify={(documentId) => (client && entityId ? run(documentId, () => client.api.verifyCompanyDocument(entityId, documentId, who), t('tower.company.doc.verified')) : Promise.resolve(false))}
            onReject={(documentId, reason) => (client && entityId ? run(documentId, () => client.api.rejectCompanyDocument(entityId, documentId, reason, who), t('tower.company.doc.rejected')) : Promise.resolve(false))}
            onOpen={async (document) => {
              if (!client || !entityId) return;
              const tab = tabAtTheTap();
              try {
                const r = await client.api.companyDocumentFile(entityId, document.documentId);
                const blob = r.error ? null : (r.data as unknown as Blob | null);
                if (blob) tab.show(blob);
              } finally {
                tab.cancel();
              }
            }}
          />
          <Lapses view={view} />
          <Changes view={view} />
        </>
      )}
    </>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * CA5 — this company's licences and policies that are running out, and what its administrators were told. At the top
 * of the record, because it is the one thing on it with a date coming. The hint says whose hands the new date is in.
 */
function RunningOut({ view, hint }: { view: CompanyRecordView; hint: Parameters<ReturnType<typeof useT>>[0] }) {
  const t = useT();
  const items = view.expiring ?? [];
  if (!items.length) return null;
  // Open of itself once a paper has lapsed or has two weeks left — the ones shown loudly.
  const fold = runningOutFold(items, t);
  return (
    <ConsoleFold title={t('tower.company.s.runningOut')} hint={fold.hint} defaultOpen={fold.open}>
      <p class="chint">{t(hint)}</p>
      <LapsingPapers items={items} />
    </ConsoleFold>
  );
}

function Readiness({ view }: { view: CompanyRecordView }) {
  const t = useT();
  const readiness = view.readiness;
  const { met, total } = readinessCounts(readiness);
  const level = view.entity.kind === 'partner' ? t('tower.company.level.partnered') : t('tower.company.level.established');
  const fold = readinessFold(view, t);

  return (
    <ConsoleFold
      title={t(view.keeper === 'company' ? 'tower.company.readyTitleOn' : 'tower.company.readyTitle')}
      hint={fold.hint}
      defaultOpen={fold.open}
      aside={
        <>
          <span class={`ctag ${view.entity.status === 'draft' ? 'ctag--warn' : 'ctag--ok'}`}>{t(view.entity.status === 'draft' ? 'tower.company.status.draft' : 'tower.company.status.active')}</span>
          <span class="ctag ctag--quiet">
            {t(view.entity.kind === 'partner' ? 'tower.company.kind.partner' : 'tower.company.kind.sister')} · {view.entity.jurisdiction} · {view.entity.currency}
          </span>
        </>
      }
    >
      {view.keeper === 'company' ? (
        // The checklist is how a company is switched ON. Shown to one that is on, it would ask for "its paper verified
        // by a second person" against a paper that now counts without one.
        <p class="chint" style="margin:12px 0">
          {t('tower.company.readyOn')}
        </p>
      ) : readiness?.ready ? (
        <p class="chint" style="margin:12px 0">
          {t('tower.company.readyYes', { level })}
        </p>
      ) : (
        <div style="margin:12px 0">
          <p class="chint">{t('tower.company.readyNo', { met, total })}</p>
          <ul class="twr-checklist">
            {(readiness?.items ?? []).map((item) => (
              <li key={item.key} class={item.met ? 'is-met' : 'is-missing'}>
                <Icon name={item.met ? 'check' : 'warning'} size={14} /> {item.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* 2026-11-12 — warnings (the owner: "a warning … rather than a hard block"): on or not, never stopping a switch-on. */}
      {openWarnings(readiness).length ? (
        <div style="margin:12px 0">
          <p class="chint">{t('tower.company.warningsTitle')}</p>
          <ul class="twr-checklist">
            {openWarnings(readiness).map((w) => (
              <li key={w.key} class="is-missing">
                <Icon name="warning" size={14} /> {w.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </ConsoleFold>
  );
}

/** The record's fields, read-only for whoever does not keep it: the fieldset disables them, tower.css hides the buttons. */
function Locked({ locked, children }: { locked: boolean; children: ComponentChildren }) {
  return (
    <fieldset class="twr-locked" disabled={locked}>
      {children}
    </fieldset>
  );
}

function LegalSection({ view, locked, open, busy, onSave }: { view: CompanyRecordView; locked: boolean; open: boolean; busy: boolean; onSave: (patch: Record<string, unknown>) => Promise<boolean> }) {
  const t = useT();
  const r = view.record;
  const [form, setForm] = useState({
    legalName: r.legalName ?? '',
    tradingName: r.tradingName ?? '',
    legalForm: r.legalForm ?? '',
    registrationNumber: r.registrationNumber ?? '',
    registrationDate: r.registrationDate ?? '',
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const patch = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()));

  return (
    <ConsoleFold title={t('tower.company.s.legal')} hint={legalHint(r, t)} defaultOpen={open}>
      <Locked locked={locked}>
        <div class="twr-corridorform">
          <Text label={t('tower.company.f.legalName')} value={form.legalName} onInput={(v) => set({ legalName: v })} />
          <Text label={t('tower.company.f.tradingName')} value={form.tradingName} onInput={(v) => set({ tradingName: v })} />
          <ConsolePick
            label={t('tower.company.f.legalForm')}
            value={form.legalForm}
            onChange={(v) => set({ legalForm: v })}
            placeholder={t('tower.company.f.choose')}
            options={LEGAL_FORMS.map((f) => ({ value: f, label: t(LEGAL_FORM_LABEL[f]) }))}
          />
          <Text label={t('tower.company.f.registrationNumber')} value={form.registrationNumber} onInput={(v) => set({ registrationNumber: v })} />
          <Text label={t('tower.company.f.registrationDate')} value={form.registrationDate} type="date" onInput={(v) => set({ registrationDate: v })} />
        </div>
        <div class="twr-corridorsave">
          <button type="button" class="cbtn cbtn--primary" disabled={busy || Object.keys(patch).length === 0} onClick={() => void onSave(patch)}>
            {t('tower.company.save')}
          </button>
        </div>
      </Locked>
    </ConsoleFold>
  );
}

const ADDRESS_KEYS = ['line1', 'line2', 'city', 'region', 'postalCode', 'country'] as const;

function AddressSection({ view, locked, open, busy, onSave }: { view: CompanyRecordView; locked: boolean; open: boolean; busy: boolean; onSave: (patch: Record<string, unknown>) => Promise<boolean> }) {
  const t = useT();
  const fromRecord = (a?: CompanyAddress) => Object.fromEntries(ADDRESS_KEYS.map((k) => [k, (a?.[k] as string | undefined) ?? (k === 'country' ? (view.entity.jurisdiction ?? '') : '')])) as Record<(typeof ADDRESS_KEYS)[number], string>;
  const [registered, setRegistered] = useState(fromRecord(view.record.registeredAddress));
  const [operating, setOperating] = useState(fromRecord(view.record.operatingAddress));
  const clean = (a: Record<string, string>) => Object.fromEntries(Object.entries(a).filter(([, v]) => v.trim()));
  const filled = (a: Record<string, string>) => Boolean(a.line1.trim() && a.city.trim());
  const patch = { ...(filled(registered) ? { registeredAddress: clean(registered) } : {}), ...(filled(operating) ? { operatingAddress: clean(operating) } : {}) };
  const labels: Record<(typeof ADDRESS_KEYS)[number], string> = {
    line1: t('tower.company.f.line1'),
    line2: t('tower.company.f.line2'),
    city: t('tower.company.f.city'),
    region: t('tower.company.f.region'),
    postalCode: t('tower.company.f.postalCode'),
    country: t('tower.company.f.addressCountry'),
  };

  return (
    <ConsoleFold title={t('tower.company.s.addresses')} hint={addressesHint(view.record, t)} defaultOpen={open}>
      <Locked locked={locked}>
        {(
          [
            ['tower.company.f.registeredAddress', registered, setRegistered],
            ['tower.company.f.operatingAddress', operating, setOperating],
          ] as const
        ).map(([title, value, setValue]) => (
          <div key={title} style="margin:8px 0">
            <p class="cfield__label">{t(title)}</p>
            <div class="twr-corridorform">
              {ADDRESS_KEYS.map((k) => (
                <Text key={k} label={labels[k]} value={value[k]} onInput={(v) => setValue({ ...value, [k]: k === 'country' ? v.toUpperCase().slice(0, 2) : v })} />
              ))}
            </div>
          </div>
        ))}
        <div class="twr-corridorsave">
          <button type="button" class="cbtn cbtn--primary" disabled={busy || Object.keys(patch).length === 0} onClick={() => void onSave(patch)}>
            {t('tower.company.save')}
          </button>
        </div>
      </Locked>
    </ConsoleFold>
  );
}

/** One list section — representatives, owners, tax numbers, bank accounts, licences, insurance — edited as rows. */
function ListEditor({
  section,
  view,
  locked,
  hint,
  open,
  busy,
  onSave,
}: {
  section: ListSection;
  view: CompanyRecordView;
  locked: boolean;
  hint: string;
  open: boolean;
  busy: boolean;
  onSave: (rows: Array<Record<string, unknown>>) => Promise<boolean>;
}) {
  const t = useT();
  const fields = SECTION_FIELDS[section];
  const [rows, setRows] = useState<EditRow[]>(() => toEditRows(section, view.record));
  const [touched, setTouched] = useState<boolean[]>(() => rows.map(() => false));
  const update = (i: number, key: string, value: string | PresenceCapability[]) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  return (
    <ConsoleFold title={t(SECTION_TITLE[section])} hint={hint} defaultOpen={open}>
      <Locked locked={locked}>
        {rows.length === 0 ? <p class="cons__empty">{t('tower.company.none')}</p> : null}
        {rows.map((row, i) => (
          <div key={i} class="twr-corridorform" style="border-bottom:1px solid var(--line, #eee);padding-bottom:8px">
            {fields.map((f) =>
              f.type === 'select' ? (
                <ConsolePick
                  key={f.key}
                  label={t(f.labelKey)}
                  value={row[f.key] as string}
                  onChange={(v) => update(i, f.key, v)}
                  options={(f.options ?? []).map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                />
              ) : f.type === 'caps' ? (
                <fieldset key={f.key} class="cfield">
                  <legend class="cfield__label">{t(f.labelKey)}</legend>
                  <span class="twr-caps">
                    {PRESENCE_CAPABILITIES.filter((c) => c !== 'takeIn').map((c) => {
                      const on = (row[f.key] as PresenceCapability[]).includes(c);
                      return (
                        <label key={c} class="checkline">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => {
                              const current = row[f.key] as PresenceCapability[];
                              update(i, f.key, on ? current.filter((x) => x !== c) : [...current, c]);
                              setTouched((ts) => ts.map((v, j) => (j === i ? true : v)));
                            }}
                          />
                          <span>{t(CAPABILITY_LABEL[c])}</span>
                        </label>
                      );
                    })}
                  </span>
                </fieldset>
              ) : (
                <Text key={f.key} label={t(f.labelKey)} value={row[f.key] as string} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} onInput={(v) => update(i, f.key, v)} />
              ),
            )}
            <button
              type="button"
              class="cbtn cbtn--ghost cbtn--sm"
              onClick={() => {
                setRows((rs) => rs.filter((_, j) => j !== i));
                setTouched((ts) => ts.filter((_, j) => j !== i));
              }}
            >
              {t('tower.company.remove')}
            </button>
          </div>
        ))}
        <div class="twr-corridorsave">
          <button
            type="button"
            class="cbtn cbtn--ghost"
            onClick={() => {
              setRows((rs) => [...rs, emptyRow(fields)]);
              setTouched((ts) => [...ts, false]);
            }}
          >
            {t('tower.company.add')}
          </button>
          <button type="button" class="cbtn cbtn--primary" disabled={busy} onClick={() => void onSave(fromEditRows(section, rows, touched))}>
            {t('tower.company.save')}
          </button>
        </div>
      </Locked>
    </ConsoleFold>
  );
}

/**
 * A PART THAT SWITCHES SOMETHING, IN THE COMPANY'S OWN HANDS. Each item is read, and changed ONE AT A TIME, WITH THE
 * PAPER BEHIND IT. There is no Save for the list: that is the shape in which a date could move with no paper. What a
 * licence or policy permits is not among the fields, and one that permits something has no "take off".
 */
function PaperBoundEditor({
  section,
  view,
  hint,
  open,
  busy,
  onDeclare,
}: {
  section: PaperBoundSection;
  view: CompanyRecordView;
  hint: string;
  open: boolean;
  busy: boolean;
  onDeclare: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const t = useT();
  const items = view.record[section] as unknown as Array<Record<string, unknown>>;
  const reference = (item: Record<string, unknown>) => String(item[REFERENCE_FIELD[section]] ?? '');
  const [form, setForm] = useState<{ was?: string; row: EditRow } | null>(null);
  const [paper, setPaper] = useState<{ dataUrl: string; name: string } | null>(null);
  const [fileSaid, setFileSaid] = useState<string | null>(null);
  const [paperKind, setPaperKind] = useState<DocumentKind>(PAPER_KINDS_FOR[section][0]);
  const [removing, setRemoving] = useState<string | null>(null);
  const blocker = form ? declareBlocker(section, form.row, Boolean(paper)) : null;
  const start = (item?: Record<string, unknown>) => {
    setPaper(null);
    setRemoving(null);
    setPaperKind(PAPER_KINDS_FOR[section][0]);
    setForm(item ? { was: reference(item), row: toEditRows(section, { ...view.record, [section]: [item] } as CompanyRecord)[0] } : { row: emptyRow(SECTION_FIELDS[section]) });
  };
  const set = (key: string, value: string) => setForm((f) => (f ? { ...f, row: { ...f.row, [key]: value } } : f));

  return (
    <ConsoleFold title={t(SECTION_TITLE[section])} hint={hint} defaultOpen={open}>
      <p class="chint">{t('tower.company.declare.hint')}</p>
      {items.length === 0 ? (
        <p class="cons__empty">{t('tower.company.none')}</p>
      ) : (
        <table class="ctbl">
          <tbody>
            {items.map((item) => {
              const line = itemLine(section, item, t);
              const caps = (Array.isArray(item.supports) ? (item.supports as PresenceCapability[]) : []).map((c) => t(CAPABILITY_LABEL[c])).join(', ');
              return (
                <tr key={reference(item)}>
                  <td>
                    <div class="ctbl__strong">{line.title}</div>
                    <div class="ctbl__sub">{line.detail}</div>
                    {caps ? <div class="ctbl__sub">{t('tower.company.declare.permits', { caps })}</div> : null}
                  </td>
                  <td class="ctbl__num">
                    {removing === reference(item) ? (
                      <span class="twr-panelend">
                        <span class="ctbl__sub">{t('tower.company.declare.takeOffSure', { what: reference(item) })}</span>
                        <button
                          type="button"
                          class="cbtn cbtn--primary cbtn--sm"
                          disabled={busy}
                          onClick={async () => {
                            await onDeclare({ section, was: reference(item) });
                            setRemoving(null);
                          }}
                        >
                          {t('tower.company.declare.takeOffYes')}
                        </button>
                        <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setRemoving(null)}>
                          {t('tower.company.declare.keep')}
                        </button>
                      </span>
                    ) : (
                      <span class="twr-panelend">
                        <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => start(item)}>
                          {t('tower.company.declare.change')}
                        </button>
                        {mayTakeOff(section, item) ? (
                          <button
                            type="button"
                            class="cbtn cbtn--ghost cbtn--sm"
                            disabled={busy}
                            onClick={() => {
                              setForm(null);
                              setRemoving(reference(item));
                            }}
                          >
                            {t('tower.company.declare.takeOff')}
                          </button>
                        ) : null}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {form ? (
        <div class="twr-declare">
          <p class="cfield__label">{form.was ? t('tower.company.declare.changing', { what: form.was }) : t('tower.company.declare.adding')}</p>
          <div class="twr-corridorform">
            {declareFields(section, Boolean(form.was)).map((f) =>
              f.type === 'select' ? (
                <ConsolePick
                  key={f.key}
                  label={t(f.labelKey)}
                  value={form.row[f.key] as string}
                  onChange={(v) => set(f.key, v)}
                  options={(f.options ?? []).map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                />
              ) : (
                <Text key={f.key} label={t(f.labelKey)} value={form.row[f.key] as string} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} onInput={(v) => set(f.key, v)} />
              ),
            )}
            {PAPER_KINDS_FOR[section].length > 1 ? (
              <ConsolePick
                label={t('tower.company.doc.kind')}
                value={paperKind}
                onChange={(v) => setPaperKind(v as DocumentKind)}
                options={PAPER_KINDS_FOR[section].map((k) => ({ value: k, label: t(DOCUMENT_LABEL[k]) }))}
              />
            ) : null}
            <label class="cfield">
              <span class="cfield__label">{t('tower.company.declare.paper')}</span>
              <input
                class="cinput"
                type="file"
                data-upload="document"
                accept="application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif"
                onChange={async (e) => {
                  const input = e.currentTarget;
                  const file = input.files?.[0];
                  setFileSaid(null);
                  if (!file) return setPaper(null);
                  // Checked here first, and said beside the picker (2026-11-02): a PDF over the most, a photo this
                  // computer could not open. A photo of the paper is made smaller to fit.
                  try {
                    const dataUrl = await paperForUpload(file);
                    setPaper({ dataUrl, name: file.name });
                  } catch (err) {
                    setPaper(null);
                    setFileSaid(uploadFailureSentence(err));
                    input.value = '';
                  }
                }}
              />
              {fileSaid ? <span class="cerr">{fileSaid}</span> : <span class="chint">{uploadHint('document')}</span>}
            </label>
          </div>
          <div class="twr-corridorsave">
            <button
              type="button"
              class="cbtn cbtn--primary"
              disabled={busy || blocker !== null}
              onClick={async () => {
                if (!paper) return;
                const ok = await onDeclare(declarationBody(section, form.was, form.row, { dataUrl: paper.dataUrl, kind: paperKind }));
                if (ok) {
                  setForm(null);
                  setPaper(null);
                }
              }}
            >
              {t('tower.company.declare.put')}
            </button>
            <button type="button" class="cbtn cbtn--ghost" onClick={() => setForm(null)}>
              {t('tower.company.declare.cancel')}
            </button>
            {blocker ? <span class="chint">{t(blocker)}</span> : null}
          </div>
        </div>
      ) : (
        <div class="twr-corridorsave">
          <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => start()}>
            {t('tower.company.declare.add')}
          </button>
        </div>
      )}
    </ConsoleFold>
  );
}

/** CA8 — what the company's country requires of it, one row per obligation in the catalogue. */
function ObligationsSection({ view, locked, open, busy, onSave }: { view: CompanyRecordView; locked: boolean; open: boolean; busy: boolean; onSave: (rows: Array<Record<string, unknown>>) => Promise<boolean> }) {
  const t = useT();
  const [values, setValues] = useState<Record<string, { reference: string; registeredAt: string }>>(() =>
    Object.fromEntries(
      view.obligations.map((o) => {
        const held = view.record.obligations.find((r) => r.key === o.key);
        return [o.key, { reference: held?.reference ?? '', registeredAt: held?.registeredAt ?? '' }];
      }),
    ),
  );
  const rows = view.obligations
    .filter((o) => values[o.key]?.reference.trim())
    .map((o) => ({ key: o.key, reference: values[o.key].reference.trim(), ...(values[o.key].registeredAt ? { registeredAt: values[o.key].registeredAt } : {}) }));

  return (
    <ConsoleFold title={t('tower.company.s.obligations', { country: view.entity.jurisdiction ?? '' })} hint={obligationsHint(view, t)} defaultOpen={open}>
      <Locked locked={locked}>
        {view.obligations.map((o) => (
          <div key={o.key} style="margin:8px 0">
            <p class="cfield__label">
              {o.name}
              {o.authority ? ` — ${o.authority}` : ''}
            </p>
            <div class="twr-corridorform">
              <Text label={t('tower.company.f.reference')} value={values[o.key]?.reference ?? ''} onInput={(v) => setValues((s) => ({ ...s, [o.key]: { ...s[o.key], reference: v } }))} />
              <Text label={t('tower.company.f.registeredAt')} type="date" value={values[o.key]?.registeredAt ?? ''} onInput={(v) => setValues((s) => ({ ...s, [o.key]: { ...s[o.key], registeredAt: v } }))} />
            </div>
          </div>
        ))}
        <div class="twr-corridorsave">
          <button type="button" class="cbtn cbtn--primary" disabled={busy} onClick={() => void onSave(rows)}>
            {t('tower.company.save')}
          </button>
        </div>
      </Locked>
    </ConsoleFold>
  );
}

/**
 * CA4 — the papers: put on record, fingerprinted, verified by somebody else, every version kept. The one part of the
 * record that holds WORK — a paper waiting for a second person, a paper reported — so its fold opens for whoever that
 * work waits on, and never hides it from them.
 */
function Documents({
  view,
  toDo,
  who,
  named,
  canVerify,
  canUpload,
  papers,
  reader,
  busy,
  onUpload,
  onVerify,
  onReject,
  onOpen,
  onReport,
  onAnswer,
}: {
  view: CompanyRecordView;
  /** The parts with an item of the switch-on checklist still to do: a paper still needed opens this fold. */
  toDo: Set<RecordPart>;
  who: string | undefined;
  /** Signed in with an account of their own: the server says which papers are theirs, whatever anybody is called. */
  named: boolean;
  /** Network staff verify and reject the papers of a company not switched on yet. */
  canVerify: boolean;
  /** A company's administrator always; staff only while the record is still theirs to enter. */
  canUpload: boolean;
  /** Round 38 — opening a paper and reporting one: a company's own, and among staff vetting's. */
  papers: boolean;
  reader: 'operator' | 'company';
  /** Say a paper that counts is not right, with what shows it. Anybody who can read this record may. */
  onReport: (documentId: string, body: { category: string; note: string; evidenceDataUrl: string }) => Promise<boolean>;
  /** The company's own answer to what was said. */
  onAnswer: (caseId: string, body: { note: string; evidenceDataUrl?: string }) => Promise<boolean>;
  busy: string | null;
  onUpload: (body: { kind: string; title: string; dataUrl: string; relatesTo?: string; expiresAt?: string }) => Promise<boolean>;
  onVerify: (documentId: string) => Promise<boolean>;
  onReject: (documentId: string, reason: string) => Promise<boolean>;
  onOpen: (document: CompanyDocument) => Promise<void>;
}) {
  const t = useT();
  const fold = documentsFold(view, { company: reader === 'company', canVerify, who, named }, toDo, t);

  return (
    <ConsoleFold title={t('tower.company.s.documents')} hint={fold.hint} defaultOpen={fold.open}>
      {view.documents.length === 0 ? (
        <p class="cons__empty">{t('tower.company.none')}</p>
      ) : (
        <table class="ctbl">
          <tbody>
            {view.documents.map((d) => (
              <DocumentRow
                key={d.documentId}
                document={d}
                who={who}
                named={named}
                canVerify={canVerify}
                reader={reader}
                reportable={papers && mayReport(d, view.keeper)}
                opens={papers}
                asked={openCaseOf(view.reports, d.documentId)}
                decided={lastDecidedOf(view.reports, d.documentId)}
                busy={busy === d.documentId || busy === `report:${d.documentId}`}
                onVerify={onVerify}
                onReject={onReject}
                onOpen={onOpen}
                onReport={onReport}
                onAnswer={onAnswer}
              />
            ))}
          </tbody>
        </table>
      )}

      {canUpload ? <PutOnRecord view={view} busy={busy} onUpload={onUpload} /> : null}
    </ConsoleFold>
  );
}

/** Put a paper on record: which paper, what it is for, and the file. */
function PutOnRecord({
  view,
  busy,
  onUpload,
}: {
  view: CompanyRecordView;
  busy: string | null;
  onUpload: (body: { kind: string; title: string; dataUrl: string; relatesTo?: string; expiresAt?: string }) => Promise<boolean>;
}) {
  const t = useT();
  const empty = { kind: 'certificate_of_incorporation', relatesTo: '', title: '', expiresAt: '', dataUrl: '', fileName: '' };
  const [form, setForm] = useState(empty);
  const [fileSaid, setFileSaid] = useState<string | null>(null);
  const blocker = uploadBlocker(form);
  const choices = relatesToChoices(form.kind, view.record, view.obligations);

  return (
    <>
      <div class="twr-corridorform" style="margin-top:12px">
        <ConsolePick
          label={t('tower.company.doc.kind')}
          value={form.kind}
          onChange={(v) => setForm({ ...form, kind: v, relatesTo: '' })}
          options={DOCUMENT_KINDS.map((k) => ({ value: k, label: t(DOCUMENT_LABEL[k]) }))}
        />
        {needsRelatesTo(form.kind) ? (
          <ConsolePick
            label={t('tower.company.doc.relatesTo')}
            value={form.relatesTo}
            onChange={(v) => setForm({ ...form, relatesTo: v })}
            placeholder={t('tower.company.f.choose')}
            options={choices.map((c) => ({ value: c.value, label: c.label }))}
          />
        ) : null}
        <Text label={t('tower.company.doc.title')} value={form.title} onInput={(v) => setForm({ ...form, title: v })} />
        <Text label={t('tower.company.f.expiresAt')} type="date" value={form.expiresAt} onInput={(v) => setForm({ ...form, expiresAt: v })} />
        <label class="cfield">
          <span class="cfield__label">{t('tower.company.doc.file')}</span>
          <input
            class="cinput"
            type="file"
            data-upload="document"
            accept="application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif"
            onChange={async (e) => {
              const input = e.currentTarget;
              const file = input.files?.[0];
              setFileSaid(null);
              if (!file) return;
              // Checked here first, and said beside the picker (2026-11-02): a PDF over the most, a photo this
              // computer could not open. A photo of the paper is made smaller to fit.
              try {
                const dataUrl = await paperForUpload(file);
                setForm((f) => ({ ...f, dataUrl, fileName: file.name, title: f.title || file.name }));
              } catch (err) {
                setForm((f) => ({ ...f, dataUrl: '', fileName: '' }));
                setFileSaid(uploadFailureSentence(err));
                input.value = '';
              }
            }}
          />
          {fileSaid ? <span class="cerr">{fileSaid}</span> : <span class="chint">{uploadHint('document')}</span>}
        </label>
      </div>
      <div class="twr-corridorsave">
        <button
          type="button"
          class="cbtn cbtn--primary"
          disabled={blocker !== null || busy === 'upload'}
          onClick={async () => {
            const ok = await onUpload({
              kind: form.kind,
              title: form.title.trim(),
              dataUrl: form.dataUrl,
              ...(form.relatesTo ? { relatesTo: form.relatesTo } : {}),
              ...(form.expiresAt ? { expiresAt: form.expiresAt } : {}),
            });
            if (ok) setForm(empty);
          }}
        >
          {t('tower.company.doc.upload')}
        </button>
        {blocker ? <span class="chint">{t(blocker)}</span> : null}
      </div>
    </>
  );
}

function DocumentRow({
  document: d,
  who,
  named,
  canVerify,
  reader,
  reportable,
  opens,
  asked,
  decided,
  busy,
  onVerify,
  onReject,
  onOpen,
  onReport,
  onAnswer,
}: {
  document: CompanyDocument;
  who: string | undefined;
  named: boolean;
  canVerify: boolean;
  reader: 'operator' | 'company';
  /** It counts, on a record the company keeps itself: anybody reading it may say it is not right. */
  reportable: boolean;
  /** Round 38 — the paper itself may be opened: a company's own, and among staff vetting's. */
  opens: boolean;
  /** The open question about this paper, if somebody has reported it. */
  asked?: PaperCase;
  /** The last thing decided about it. */
  decided?: PaperCase;
  busy: boolean;
  onVerify: (documentId: string) => Promise<boolean>;
  onReject: (documentId: string, reason: string) => Promise<boolean>;
  onOpen: (document: CompanyDocument) => Promise<void>;
  onReport: (documentId: string, body: { category: string; note: string; evidenceDataUrl: string }) => Promise<boolean>;
  onAnswer: (caseId: string, body: { note: string; evidenceDataUrl?: string }) => Promise<boolean>;
}) {
  const t = useT();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [panel, setPanel] = useState<'report' | 'answer' | null>(null);
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const blocker = documentBlocker(d, who, named);
  const status =
    d.status === 'verified'
      ? t('tower.company.doc.status.verified', { who: d.verifiedBy ?? '' })
      : d.status === 'rejected'
        ? t('tower.company.doc.status.rejected', { who: d.rejectedBy ?? '', reason: d.rejectionReason ?? '' })
        : d.status === 'superseded'
          ? t('tower.company.doc.status.superseded')
          : d.status === 'declared'
            ? t('tower.company.doc.status.declared', { who: d.uploadedBy })
            : d.status === 'struck'
              ? t('tower.company.doc.status.struck')
              : t('tower.company.doc.status.awaiting');

  return (
    <>
    <tr class={d.status === 'superseded' ? 'is-quiet' : undefined}>
      <td>
        <div class="ctbl__strong">{d.title}</div>
        <div class="ctbl__sub">
          {t(DOCUMENT_LABEL[d.kind])}
          {d.relatesTo ? ` · ${d.relatesTo}` : ''} · {t('tower.company.doc.version', { n: d.version })}
        </div>
        {/* SOMEBODY HAS SAID THIS PAPER IS NOT RIGHT. It keeps counting; the company reads what was said (never by
            whom) and until when it may answer; staff read that it waits under Reported papers. */}
        {asked ? <div class="ctbl__sub ctbl__sub--warn">{t(reader === 'company' ? 'tower.paperReport.row.openOwn' : 'tower.paperReport.row.open', { n: asked.reports.length, when: day(asked.answerBy) })}</div> : null}
        {asked && reader === 'company'
          ? asked.reports.map((r) => (
              <div key={r.reportId} class="ctbl__sub">
                {t('tower.paperReport.row.said', { what: t(CATEGORY_LABEL[r.category]), note: r.note })}
              </div>
            ))
          : null}
        {asked?.answer ? <div class="ctbl__sub">{t('tower.paperReport.row.answered', { who: asked.answer.by, when: day(asked.answer.at) })}</div> : null}
        {!asked && decided?.decision ? (
          <div class="ctbl__sub">
            {t(decided.state === 'struck' ? 'tower.paperReport.row.struck' : 'tower.paperReport.row.dismissed', { when: day(decided.decision.at), reason: decided.decision.reason })}
            {decided.decision.effect ? ` ${decided.decision.effect}` : ''}
          </div>
        ) : null}
      </td>
      <td class="ctbl__sub">
        <div>
          <code>{t('tower.company.doc.fingerprint', { fp: shortFingerprint(d.fingerprint) })}</code>
        </div>
        <div>{t('tower.company.doc.by', { who: d.uploadedBy, when: when(d.uploadedAt) })}</div>
      </td>
      <td>
        <span class={`ctag ${d.status === 'verified' || d.status === 'declared' ? 'ctag--ok' : d.status === 'rejected' || d.status === 'struck' ? 'ctag--warn' : d.status === 'superseded' ? 'ctag--quiet' : 'ctag--info'}`}>{status}</span>
      </td>
      <td class="ctbl__num">
        <span class="twr-panelend">
          {d.fileDeletedAt ? (
            <span class="chint">{t('tower.company.doc.deleted', { date: d.fileDeletedAt.slice(0, 10) })}</span>
          ) : opens ? (
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void onOpen(d)}>
              {t('tower.company.doc.open')}
            </button>
          ) : null}
          {asked && reader === 'company' ? (
            <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={() => setPanel(panel === 'answer' ? null : 'answer')}>
              {t(asked.answer ? 'tower.paperReport.answerAgainCta' : 'tower.paperReport.answerCta')}
            </button>
          ) : null}
          {reportable ? (
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => setPanel(panel === 'report' ? null : 'report')}>
              {t('tower.paperReport.reportCta')}
            </button>
          ) : null}
          {canVerify && d.status === 'awaiting_verification' ? (
            rejecting ? (
              <>
                <input class="cinput" value={reason} placeholder={t('tower.company.doc.rejectReason')} aria-label={t('tower.company.doc.rejectReason')} onInput={(e) => setReason(e.currentTarget.value)} />
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy || !reason.trim()} onClick={() => void onReject(d.documentId, reason.trim())}>
                  {t('tower.company.doc.reject')}
                </button>
              </>
            ) : (
              <>
                <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy || blocker !== null} onClick={() => void onVerify(d.documentId)}>
                  {t('tower.company.doc.verify')}
                </button>
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => setRejecting(true)}>
                  {t('tower.company.doc.reject')}
                </button>
              </>
            )
          ) : null}
        </span>
        {canVerify && blocker && d.status === 'awaiting_verification' && !rejecting ? <div class="chint">{t(blocker)}</div> : null}
      </td>
    </tr>
    {panel === 'report' && reportable ? (
      <tr>
        <td colSpan={4}>
          <SayForm
            kind="report"
            busy={busy}
            onCancel={() => setPanel(null)}
            onSend={async (body) => {
              const ok = await onReport(d.documentId, { category: body.category, note: body.note, evidenceDataUrl: body.evidenceDataUrl ?? '' });
              if (ok) setPanel(null);
            }}
          />
        </td>
      </tr>
    ) : null}
    {panel === 'answer' && asked ? (
      <tr>
        <td colSpan={4}>
          <SayForm
            kind="answer"
            busy={busy}
            onCancel={() => setPanel(null)}
            onSend={async (body) => {
              const ok = await onAnswer(asked.caseId, { note: body.note, ...(body.evidenceDataUrl ? { evidenceDataUrl: body.evidenceDataUrl } : {}) });
              if (ok) setPanel(null);
            }}
          />
        </td>
      </tr>
    ) : null}
    </>
  );
}

/**
 * WORDS, AND WHAT SHOWS THEM — the one form behind both halves of a dispute. A REPORT says what is wrong with a paper
 * and must attach what shows it (a screenshot of the regulator's register, a photograph); an ANSWER says what is
 * right, and may attach something.
 */
function SayForm({ kind, busy, onSend, onCancel }: { kind: 'report' | 'answer'; busy: boolean; onSend: (body: { category: ReportCategory; note: string; evidenceDataUrl?: string }) => Promise<void>; onCancel: () => void }) {
  const t = useT();
  const [category, setCategory] = useState<ReportCategory>('expired');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<{ dataUrl: string; name: string } | null>(null);
  const [fileSaid, setFileSaid] = useState<string | null>(null);
  const blocker = kind === 'report' ? reportBlocker({ note, hasEvidence: Boolean(file) }) : note.trim() ? null : ('tower.paperReport.needAnswer' as const);

  return (
    <div class="twr-declare">
      <p class="chint">{t(kind === 'report' ? 'tower.paperReport.form.reportHint' : 'tower.paperReport.form.answerHint')}</p>
      <div class="twr-corridorform">
        {kind === 'report' ? (
          <ConsolePick
            label={t('tower.paperReport.form.category')}
            value={category}
            onChange={(v) => setCategory(v as ReportCategory)}
            options={REPORT_CATEGORIES.map((c) => ({ value: c, label: t(CATEGORY_LABEL[c]) }))}
          />
        ) : null}
        <label class="cfield" style="grid-column: span 2">
          <span class="cfield__label">{t(kind === 'report' ? 'tower.paperReport.form.note' : 'tower.paperReport.form.answerNote')}</span>
          <textarea class="cinput" rows={3} maxLength={kind === 'report' ? 1000 : 2000} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
        </label>
        <label class="cfield">
          <span class="cfield__label">{t(kind === 'report' ? 'tower.paperReport.form.evidence' : 'tower.paperReport.form.answerEvidence')}</span>
          <input
            class="cinput"
            type="file"
            data-upload="document"
            accept="image/png,image/jpeg,image/webp,image/heic,image/heif,application/pdf"
            onChange={async (e) => {
              const input = e.currentTarget;
              const file = input.files?.[0];
              setFileSaid(null);
              if (!file) return setFile(null);
              // Checked here first, and said beside the picker (2026-11-02): a PDF over the most, a photo this
              // computer could not open. A photo of the paper is made smaller to fit.
              try {
                const dataUrl = await paperForUpload(file, UPLOAD_LIMITS.evidence);
                setFile({ dataUrl, name: file.name });
              } catch (err) {
                setFile(null);
                setFileSaid(uploadFailureSentence(err));
                input.value = '';
              }
            }}
          />
          {fileSaid ? <span class="cerr">{fileSaid}</span> : <span class="chint">{uploadHint('document', UPLOAD_LIMITS.evidence)}</span>}
        </label>
      </div>
      <div class="twr-corridorsave">
        <button type="button" class="cbtn cbtn--primary" disabled={busy || blocker !== null} onClick={() => void onSend({ category, note: note.trim(), ...(file ? { evidenceDataUrl: file.dataUrl } : {}) })}>
          {t(kind === 'report' ? 'tower.paperReport.form.send' : 'tower.paperReport.form.sendAnswer')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" onClick={onCancel}>
          {t('tower.company.declare.cancel')}
        </button>
        {blocker ? <span class="chint">{t(blocker)}</span> : null}
      </div>
    </div>
  );
}

/** CA5 — what a lapsed licence or policy switched off, and which paper did it. */
function Lapses({ view }: { view: CompanyRecordView }) {
  const t = useT();
  if (!view.lapses.length) return null;
  const kindLabel = (source: string, kind: string) =>
    source === 'licence' ? t(LICENCE_LABEL[kind as keyof typeof LICENCE_LABEL] ?? 'tower.company.licence.other') : t(INSURANCE_LABEL[kind as keyof typeof INSURANCE_LABEL] ?? 'tower.company.insurance.other');
  const fold = lapsesFold(view, t);
  return (
    <ConsoleFold title={t('tower.company.s.lapses')} hint={fold.hint} defaultOpen={fold.open}>
      <ul class="twr-checklist" style="margin:12px 0">
        {view.lapses.map((l, i) => (
          <li key={i} class="is-missing">
            <Icon name="warning" size={14} /> {t('tower.company.lapse.line', { caps: t(CAPABILITY_LABEL[l.capability]), kind: kindLabel(l.source, l.kind), reference: l.reference, date: l.expiredAt })}
          </li>
        ))}
      </ul>
    </ConsoleFold>
  );
}

function Changes({ view }: { view: CompanyRecordView }) {
  const t = useT();
  if (!view.changes.length) return null;
  return (
    <ConsoleFold title={t('tower.company.s.changes')} hint={changesHint(view.changes, when, t)}>
      <table class="ctbl">
        <tbody>
          {view.changes.map((c, i) => (
            <tr key={i}>
              <td class="ctbl__sub">{t('tower.company.change.by', { who: c.by, when: when(c.at) })}</td>
              <td>{t('tower.company.change.line', { what: c.what, to: c.to })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ConsoleFold>
  );
}

function Text({ label, value, onInput, type = 'text' }: { label: string; value: string; onInput: (v: string) => void; type?: 'text' | 'number' | 'date' }) {
  return (
    <label class="cfield">
      <span class="cfield__label">{label}</span>
      <input class="cinput" type={type} value={value} onInput={(e) => onInput(e.currentTarget.value)} />
    </label>
  );
}

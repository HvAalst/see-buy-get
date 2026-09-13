import { useCallback, useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import {
  DOCUMENT_KINDS,
  DOCUMENT_LABEL,
  INSURANCE_LABEL,
  LEGAL_FORMS,
  LEGAL_FORM_LABEL,
  LICENCE_LABEL,
  PRESENCE_CAPABILITIES,
  SECTION_FIELDS,
  SECTION_TITLE,
  documentBlocker,
  emptyRow,
  fromEditRows,
  needsRelatesTo,
  readinessCounts,
  relatesToChoices,
  shortFingerprint,
  toEditRows,
  uploadBlocker,
  type CompanyAddress,
  type CompanyDocument,
  type CompanyRecordView,
  type EditRow,
  type ListSection,
} from '../company';
import { CAPABILITY_LABEL, type PresenceCapability } from '../presence';
import type { TowerActions, TowerState } from '../useTowerApp';

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
  const [view, setView] = useState<CompanyRecordView | null>(null);
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
      setError(r.error.detail || r.error.title || '');
      return false;
    }
    setDone(message);
    await load();
    return true;
  };
  const saveRecord = (key: string, patch: Record<string, unknown>) =>
    client && entityId ? run(key, () => client.api.saveCompanyRecord(entityId, { ...patch, ...(who ? { by: who } : {}) }), t('tower.company.saved')) : Promise.resolve(false);

  const companies = (state.entities ?? []).filter((e) => e.kind !== 'group');

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{view ? view.entity.name : t('tower.company.title')}</h1>
        <p class="cons__lede">{t('tower.company.lede')}</p>
      </header>

      <section class="cons__panel">
        <div class="twr-corridorform">
          <label class="cfield">
            <span class="cfield__label">{t('tower.company.choose')}</span>
            <select class="cinput" value={entityId ?? ''} onChange={(e) => actions.openCompany(e.currentTarget.value)}>
              <option value="">{t('tower.company.f.choose')}</option>
              {companies.map((c) => (
                <option key={c.entityId} value={c.entityId}>
                  {c.name} ({c.jurisdiction})
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {done ? (
        <p class="twr-done">
          <Icon name="check" size={16} />
          {done}
        </p>
      ) : null}
      {error ? <p class="cerr">{error}</p> : null}

      {!entityId ? null : !view ? (
        <p class="cons__empty">{t('tower.company.loading')}</p>
      ) : view.entity.kind === 'group' ? (
        <p class="cons__empty">{t('tower.company.groupNoRecord')}</p>
      ) : (
        <>
          <Readiness view={view} />
          <LegalSection view={view} busy={busy === 'legal'} onSave={(patch) => saveRecord('legal', patch)} />
          <AddressSection view={view} busy={busy === 'addresses'} onSave={(patch) => saveRecord('addresses', patch)} />
          {(['representatives', 'beneficialOwners', 'taxRegistrations', ...(view.entity.kind === 'sister' ? (['bankAccounts'] as ListSection[]) : []), 'licences', 'insurance'] as ListSection[]).map((section) => (
            <ListEditor key={section} section={section} view={view} busy={busy === section} onSave={(rows) => saveRecord(section, { [section]: rows })} />
          ))}
          <ObligationsSection view={view} busy={busy === 'obligations'} onSave={(rows) => saveRecord('obligations', { obligations: rows })} />
          <Documents
            view={view}
            who={who}
            busy={busy}
            onUpload={(body) => (client && entityId ? run('upload', () => client.api.uploadCompanyDocument(entityId, { ...body, ...(who ? { by: who } : {}) }), t('tower.company.doc.uploaded')) : Promise.resolve(false))}
            onVerify={(documentId) => (client && entityId ? run(documentId, () => client.api.verifyCompanyDocument(entityId, documentId, who), t('tower.company.doc.verified')) : Promise.resolve(false))}
            onReject={(documentId, reason) => (client && entityId ? run(documentId, () => client.api.rejectCompanyDocument(entityId, documentId, reason, who), t('tower.company.doc.rejected')) : Promise.resolve(false))}
            onOpen={async (document) => {
              if (!client || !entityId) return;
              const r = await client.api.companyDocumentFile(entityId, document.documentId);
              const blob = r.error ? null : (r.data as unknown as Blob | null);
              if (blob) window.open(URL.createObjectURL(blob), '_blank', 'noopener');
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

function Readiness({ view }: { view: CompanyRecordView }) {
  const t = useT();
  const readiness = view.readiness;
  const { met, total } = readinessCounts(readiness);
  const level = view.entity.kind === 'partner' ? t('tower.company.level.partnered') : t('tower.company.level.established');

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.company.readyTitle')}</span>
        <span class="twr-panelend">
          <span class={`ctag ${view.entity.status === 'draft' ? 'ctag--warn' : 'ctag--ok'}`}>{t(view.entity.status === 'draft' ? 'tower.company.status.draft' : 'tower.company.status.active')}</span>
          <span class="ctag ctag--quiet">
            {t(view.entity.kind === 'partner' ? 'tower.company.kind.partner' : 'tower.company.kind.sister')} · {view.entity.jurisdiction} · {view.entity.currency}
          </span>
        </span>
      </div>
      {readiness?.ready ? (
        <p class="chint" style="margin:12px 16px">
          {t('tower.company.readyYes', { level })}
        </p>
      ) : (
        <div style="margin:12px 16px">
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
    </section>
  );
}

function LegalSection({ view, busy, onSave }: { view: CompanyRecordView; busy: boolean; onSave: (patch: Record<string, unknown>) => Promise<boolean> }) {
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
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.company.s.legal')}</span>
      </div>
      <div class="twr-corridorform">
        <Text label={t('tower.company.f.legalName')} value={form.legalName} onInput={(v) => set({ legalName: v })} />
        <Text label={t('tower.company.f.tradingName')} value={form.tradingName} onInput={(v) => set({ tradingName: v })} />
        <label class="cfield">
          <span class="cfield__label">{t('tower.company.f.legalForm')}</span>
          <select class="cinput" value={form.legalForm} onChange={(e) => set({ legalForm: e.currentTarget.value })}>
            <option value="">{t('tower.company.f.choose')}</option>
            {LEGAL_FORMS.map((f) => (
              <option key={f} value={f}>
                {t(LEGAL_FORM_LABEL[f])}
              </option>
            ))}
          </select>
        </label>
        <Text label={t('tower.company.f.registrationNumber')} value={form.registrationNumber} onInput={(v) => set({ registrationNumber: v })} />
        <Text label={t('tower.company.f.registrationDate')} value={form.registrationDate} type="date" onInput={(v) => set({ registrationDate: v })} />
      </div>
      <div class="twr-corridorsave">
        <button type="button" class="cbtn cbtn--primary" disabled={busy || Object.keys(patch).length === 0} onClick={() => void onSave(patch)}>
          {t('tower.company.save')}
        </button>
      </div>
    </section>
  );
}

const ADDRESS_KEYS = ['line1', 'line2', 'city', 'region', 'postalCode', 'country'] as const;

function AddressSection({ view, busy, onSave }: { view: CompanyRecordView; busy: boolean; onSave: (patch: Record<string, unknown>) => Promise<boolean> }) {
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
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.company.s.addresses')}</span>
      </div>
      {(
        [
          ['tower.company.f.registeredAddress', registered, setRegistered],
          ['tower.company.f.operatingAddress', operating, setOperating],
        ] as const
      ).map(([title, value, setValue]) => (
        <div key={title} style="margin:8px 16px">
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
    </section>
  );
}

/** One list section — representatives, owners, tax numbers, bank accounts, licences, insurance — edited as rows. */
function ListEditor({ section, view, busy, onSave }: { section: ListSection; view: CompanyRecordView; busy: boolean; onSave: (rows: Array<Record<string, unknown>>) => Promise<boolean> }) {
  const t = useT();
  const fields = SECTION_FIELDS[section];
  const [rows, setRows] = useState<EditRow[]>(() => toEditRows(section, view.record));
  const [touched, setTouched] = useState<boolean[]>(() => rows.map(() => false));
  const update = (i: number, key: string, value: string | PresenceCapability[]) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t(SECTION_TITLE[section])}</span>
      </div>
      {rows.length === 0 ? <p class="cons__empty">{t('tower.company.none')}</p> : null}
      {rows.map((row, i) => (
        <div key={i} class="twr-corridorform" style="border-bottom:1px solid var(--line, #eee);padding-bottom:8px">
          {fields.map((f) =>
            f.type === 'select' ? (
              <label key={f.key} class="cfield">
                <span class="cfield__label">{t(f.labelKey)}</span>
                <select class="cinput" value={row[f.key] as string} onChange={(e) => update(i, f.key, e.currentTarget.value)}>
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </option>
                  ))}
                </select>
              </label>
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
    </section>
  );
}

/** CA8 — what the company's country requires of it, one row per obligation in the catalogue. */
function ObligationsSection({ view, busy, onSave }: { view: CompanyRecordView; busy: boolean; onSave: (rows: Array<Record<string, unknown>>) => Promise<boolean> }) {
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
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.company.s.obligations', { country: view.entity.jurisdiction ?? '' })}</span>
      </div>
      {view.obligations.map((o) => (
        <div key={o.key} style="margin:8px 16px">
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
    </section>
  );
}

/** CA4 — the papers: put on record, fingerprinted, verified by somebody else, every version kept. */
function Documents({
  view,
  who,
  busy,
  onUpload,
  onVerify,
  onReject,
  onOpen,
}: {
  view: CompanyRecordView;
  who: string | undefined;
  busy: string | null;
  onUpload: (body: { kind: string; title: string; dataUrl: string; relatesTo?: string; expiresAt?: string }) => Promise<boolean>;
  onVerify: (documentId: string) => Promise<boolean>;
  onReject: (documentId: string, reason: string) => Promise<boolean>;
  onOpen: (document: CompanyDocument) => Promise<void>;
}) {
  const t = useT();
  const empty = { kind: 'certificate_of_incorporation', relatesTo: '', title: '', expiresAt: '', dataUrl: '', fileName: '' };
  const [form, setForm] = useState(empty);
  const blocker = uploadBlocker(form);
  const choices = relatesToChoices(form.kind, view.record, view.obligations);

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.company.s.documents')}</span>
      </div>

      {view.documents.length === 0 ? (
        <p class="cons__empty">{t('tower.company.none')}</p>
      ) : (
        <table class="ctbl">
          <tbody>
            {view.documents.map((d) => (
              <DocumentRow key={d.documentId} document={d} who={who} busy={busy === d.documentId} onVerify={onVerify} onReject={onReject} onOpen={onOpen} />
            ))}
          </tbody>
        </table>
      )}

      <div class="twr-corridorform" style="margin-top:12px">
        <label class="cfield">
          <span class="cfield__label">{t('tower.company.doc.kind')}</span>
          <select class="cinput" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.currentTarget.value, relatesTo: '' })}>
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(DOCUMENT_LABEL[k])}
              </option>
            ))}
          </select>
        </label>
        {needsRelatesTo(form.kind) ? (
          <label class="cfield">
            <span class="cfield__label">{t('tower.company.doc.relatesTo')}</span>
            <select class="cinput" value={form.relatesTo} onChange={(e) => setForm({ ...form, relatesTo: e.currentTarget.value })}>
              <option value="">{t('tower.company.f.choose')}</option>
              {choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Text label={t('tower.company.doc.title')} value={form.title} onInput={(v) => setForm({ ...form, title: v })} />
        <Text label={t('tower.company.f.expiresAt')} type="date" value={form.expiresAt} onInput={(v) => setForm({ ...form, expiresAt: v })} />
        <label class="cfield">
          <span class="cfield__label">{t('tower.company.doc.file')}</span>
          <input
            class="cinput"
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setForm((f) => ({ ...f, dataUrl: String(reader.result ?? ''), fileName: file.name, title: f.title || file.name }));
              reader.readAsDataURL(file);
            }}
          />
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
    </section>
  );
}

function DocumentRow({
  document: d,
  who,
  busy,
  onVerify,
  onReject,
  onOpen,
}: {
  document: CompanyDocument;
  who: string | undefined;
  busy: boolean;
  onVerify: (documentId: string) => Promise<boolean>;
  onReject: (documentId: string, reason: string) => Promise<boolean>;
  onOpen: (document: CompanyDocument) => Promise<void>;
}) {
  const t = useT();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const blocker = documentBlocker(d, who);
  const status =
    d.status === 'verified'
      ? t('tower.company.doc.status.verified', { who: d.verifiedBy ?? '' })
      : d.status === 'rejected'
        ? t('tower.company.doc.status.rejected', { who: d.rejectedBy ?? '', reason: d.rejectionReason ?? '' })
        : d.status === 'superseded'
          ? t('tower.company.doc.status.superseded')
          : t('tower.company.doc.status.awaiting');

  return (
    <tr class={d.status === 'superseded' ? 'is-quiet' : undefined}>
      <td>
        <div class="ctbl__strong">{d.title}</div>
        <div class="ctbl__sub">
          {t(DOCUMENT_LABEL[d.kind])}
          {d.relatesTo ? ` · ${d.relatesTo}` : ''} · {t('tower.company.doc.version', { n: d.version })}
        </div>
      </td>
      <td class="ctbl__sub">
        <div>
          <code>{t('tower.company.doc.fingerprint', { fp: shortFingerprint(d.fingerprint) })}</code>
        </div>
        <div>{t('tower.company.doc.by', { who: d.uploadedBy, when: when(d.uploadedAt) })}</div>
      </td>
      <td>
        <span class={`ctag ${d.status === 'verified' ? 'ctag--ok' : d.status === 'rejected' ? 'ctag--warn' : d.status === 'superseded' ? 'ctag--quiet' : 'ctag--info'}`}>{status}</span>
      </td>
      <td class="ctbl__num">
        <span class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void onOpen(d)}>
            {t('tower.company.doc.open')}
          </button>
          {d.status === 'awaiting_verification' ? (
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
        {blocker && d.status === 'awaiting_verification' && !rejecting ? <div class="chint">{t(blocker)}</div> : null}
      </td>
    </tr>
  );
}

/** CA5 — what a lapsed licence or policy switched off, and which paper did it. */
function Lapses({ view }: { view: CompanyRecordView }) {
  const t = useT();
  if (!view.lapses.length) return null;
  const kindLabel = (source: string, kind: string) =>
    source === 'licence' ? t(LICENCE_LABEL[kind as keyof typeof LICENCE_LABEL] ?? 'tower.company.licence.other') : t(INSURANCE_LABEL[kind as keyof typeof INSURANCE_LABEL] ?? 'tower.company.insurance.other');
  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.company.s.lapses')}</span>
      </div>
      <ul class="twr-checklist" style="margin:12px 16px">
        {view.lapses.map((l, i) => (
          <li key={i} class="is-missing">
            <Icon name="warning" size={14} /> {t('tower.company.lapse.line', { caps: t(CAPABILITY_LABEL[l.capability]), kind: kindLabel(l.source, l.kind), reference: l.reference, date: l.expiredAt })}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Changes({ view }: { view: CompanyRecordView }) {
  const t = useT();
  if (!view.changes.length) return null;
  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.company.s.changes')}</span>
      </div>
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
    </section>
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

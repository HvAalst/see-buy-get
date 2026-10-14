import { useState } from 'preact/hooks';
import { Button, ErrorNote, Note } from '../ui';
import { useT } from '../i18n';
import type { SbgError } from '../../lib/sbg';
import { downscaleImage } from '../media';
import {
  CONTRACT_CATEGORY_LABEL,
  CONTRACT_REPORT_CATEGORIES,
  contractReportBlocker,
  mayReportPaper,
  paperName,
  paperSays,
  yourReportSays,
  type ContractPaper,
  type ContractReportCategory,
} from './contract';
import type { AccountApi } from './useAccount';

/**
 * WHO YOU CONTRACT WITH — the company of ours behind this sign-in, and the licences and insurance policies it trades
 * on: what each is, who issued it, its number, and until when it is good. Enough to check against the issuer's own
 * register, which is the point (the user, 2026-10-09: "the number is enough and can be verified").
 *
 * And the way to say one is not right: what is wrong, in your own words, and what shows it. Nothing changes by
 * reporting — the paper keeps counting, the company is told what was said and not who said it, and SeeBuyGet staff
 * decide. What became of your own report is said under the paper for as long as there is one.
 *
 * Never a bank account, never who may sign, never a file: the server sends none of them here.
 */
export function ContractCompany({ api }: { api: AccountApi }) {
  const t = useT();
  const view = api.contract;
  const [reporting, setReporting] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  if (!view?.company) return <Note tone="info" icon="info" title={t('account.contract.none')} />;
  const company = view.company.name;

  return (
    <>
      <p class="t-body">{t('account.contract.lede', { company })}</p>
      {sent ? <Note tone="ok" icon="check" title={t('account.contract.sentTitle')} detail={t('account.contract.sent', { company })} /> : null}
      {view.papers.length === 0 ? <Note tone="info" icon="info" title={t('account.contract.noPapers', { company })} /> : null}
      {view.papers.map((p) => {
        const key = `${p.source}:${p.number}`;
        const yours = yourReportSays(p, t as never, day);
        return (
          <div class="contract__paper" key={key}>
            <p class="t-label">{t(paperName(p))}</p>
            <p class="t-mono contract__number">{p.number}</p>
            <p class={p.lapsed ? 't-sub contract__lapsed' : 't-sub'}>{paperSays(p, t as never, day)}</p>
            {yours ? <Note tone={yours.tone} icon={yours.tone === 'ok' ? 'check' : 'info'} title={yours.text} /> : null}
            {reporting === key ? (
              <ReportForm
                paper={p}
                api={api}
                onCancel={() => setReporting(null)}
                onSent={() => {
                  setReporting(null);
                  setSent(true);
                }}
              />
            ) : mayReportPaper(p) ? (
              <Button
                variant="outline"
                chevron={false}
                onClick={() => {
                  setSent(false);
                  setReporting(key);
                }}
              >
                {t('account.contract.report')}
              </Button>
            ) : null}
          </div>
        );
      })}
      <p class="t-sub">{t('account.contract.foot')}</p>
    </>
  );
}

/** Words, and what shows them: a screenshot or a photograph, made small enough to send from a phone. */
function ReportForm({ paper, api, onSent, onCancel }: { paper: ContractPaper; api: AccountApi; onSent: () => void; onCancel: () => void }) {
  const t = useT();
  const [category, setCategory] = useState<ContractReportCategory>('expired');
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState<{ dataUrl: string; name: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const blocker = contractReportBlocker({ note, hasEvidence: Boolean(evidence) });
  const id = `contract-${paper.source}-${paper.number.replace(/\W+/g, '-')}`;

  const pick = async (file: File) => {
    setReading(true);
    setUnreadable(false);
    const img = await downscaleImage(file, { maxEdge: 1600, quality: 0.8 }).catch(() => null);
    setReading(false);
    if (!img) {
      setEvidence(null);
      return setUnreadable(true);
    }
    setEvidence({ dataUrl: img.dataUrl, name: file.name });
  };
  const send = async () => {
    if (!evidence) return;
    setBusy(true);
    setError(null);
    const r = await api.reportContractPaper({ source: paper.source, number: paper.number, category, note: note.trim(), evidenceDataUrl: evidence.dataUrl });
    setBusy(false);
    if (r.error) return setError(r.error);
    onSent();
  };

  return (
    <div class="contract__form">
      <p class="t-body">{t('account.contract.form.lede')}</p>
      <div class="field">
        <label class="field__label" for={`${id}-what`}>
          {t('account.contract.form.category')}
        </label>
        <select id={`${id}-what`} class="select" value={category} disabled={busy} onChange={(e) => setCategory(e.currentTarget.value as ContractReportCategory)}>
          {CONTRACT_REPORT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(CONTRACT_CATEGORY_LABEL[c])}
            </option>
          ))}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for={`${id}-note`}>
          {t('account.contract.form.note')}
        </label>
        <textarea id={`${id}-note`} class="input" rows={3} maxLength={1000} value={note} disabled={busy} onInput={(e) => setNote(e.currentTarget.value)} />
      </div>
      <div class="field">
        <label class="field__label" for={`${id}-shot`}>
          {t('account.contract.form.evidence')}
        </label>
        {/* No `capture`: what shows it is as often a screenshot already on the phone as something to photograph. */}
        <input
          id={`${id}-shot`}
          class="input"
          type="file"
          accept="image/*"
          disabled={busy || reading}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) void pick(f);
            else setEvidence(null);
          }}
        />
        {evidence ? <span class="t-sub">{t('account.contract.form.attached', { name: evidence.name })}</span> : null}
      </div>
      {unreadable ? <Note tone="warn" icon="warning" title={t('account.contract.form.unreadable')} /> : null}
      {/* The server's own sentence: "you have already reported this paper" is not something an icon can say. */}
      {error ? <ErrorNote error={error} showDetail /> : null}
      {blocker && !reading ? <p class="t-sub">{t(blocker)}</p> : null}
      <Button chevron={false} busy={busy} disabled={blocker !== null || reading} onClick={() => void send()}>
        {t('account.contract.form.send')}
      </Button>
      <Button variant="link" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
    </div>
  );
}

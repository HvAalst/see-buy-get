import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { formatDate, useT, type Translate } from '../../../shared/i18n';
import { paperDay, paperKindLabel, paperLine, papersToShow, type PaperView } from '../../../shared/papers';
import { ConsoleDetail } from '../ConsoleDetail';
import { DocumentStrip } from './DocumentStrip';
import { CardPhoto, Fig } from './PapersScreen';
import { operatorWaiting, type CarrierKind, type CarrierPaperRow, type SentPaper } from '../papers';
import type { TowerActions, TowerState } from '../useTowerApp';
import { ConsolePick } from '../ConsolePick';
import { CurrencySelect } from './CurrencySelect';
import { COVER_KINDS, type CoverKind } from '../papers';

/**
 * THE OPERATORS' OWN PAPERS — the licence that lets a company run lorries, and its cover.
 *
 * Listed whether or not any sister enforces them, and that is the point of the section. Until this existed
 * the transport-operator licence was a number with no date: read once at vetting and then unfalsifiable by
 * time, while the same network took a lorry off the road for a lapsed inspection. What a sister decides is
 * the CONSEQUENCE of a lapse (Rates → carrier papers); whether we look is not up for decision.
 *
 * Every row therefore answers three different things a reader must not confuse: whether the paper is in
 * date, whether anybody enforces it, and whether it is costing the fleet work right now. And a fleet can now
 * SEND its renewed documents, so a fourth comes first: whether it has done its part and is waiting on us.
 */
export function OperatorPapersPanel({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.papers?.carrierPapers ?? [];
  const refused = rows.filter((r) => r.notOffered.length).length;
  const waiting = rows.filter(operatorWaiting).length;
  const open = rows.find((r) => r.did === state.openId) ?? null;

  return (
    <>
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.carrierPapers.listTitle', { n: rows.length })}</span>
          {waiting ? <span class="ctag ctag--warn">{t('tower.carrierPapers.waitingCount', { n: waiting })}</span> : null}
          {refused ? <span class="ctag ctag--danger">{t('tower.carrierPapers.refusedCount', { n: refused })}</span> : null}
        </div>
        <p class="chint" style="margin:0 0 8px">{t('tower.carrierPapers.listHint')}</p>
        {state.papers === null ? (
          <p class="cons__empty">{t('tower.papers.loading')}</p>
        ) : rows.length === 0 ? (
          <p class="cons__empty">{t('tower.carrierPapers.none')}</p>
        ) : (
          <div class="crows">
            {rows.map((row) => (
              <OperatorRow key={row.did} row={row} on={state.openId === row.did} actions={actions} />
            ))}
          </div>
        )}
      </section>
      {open ? (
        <ConsoleDetail openKey={open.did} title={t('tower.carrierPapers.sheetTitle')} onClose={() => actions.open(null)}>
          <OperatorSheet row={open} state={state} actions={actions} />
        </ConsoleDetail>
      ) : null}
    </>
  );
}

/**
 * The one tag a row earns — only for a state that needs somebody. A document to check comes first, exactly
 * as a courier's card does: that fleet has done its part and is waiting on us. Then refused, then a lapse
 * nobody enforces.
 *
 * NOT for "no date recorded". That is where nearly every fleet starts, and the first version tagged ten of
 * eleven rows with it: a tag on everything marks nothing, and it cut every company's name short to make
 * room. The line under the name already says it.
 */
function operatorTag(row: CarrierPaperRow, t: Translate): { cls: string; text: string } | null {
  if (operatorWaiting(row)) return { cls: 'ctag--warn', text: t('tower.carrierPapers.tagSent') };
  if (row.notOffered.length) return { cls: 'ctag--danger', text: t('tower.carrierPapers.tagRefused') };
  if (row.papers.some((p) => p.state === 'lapsed')) return { cls: 'ctag--warn', text: t('tower.carrierPapers.tagLapsedUnenforced') };
  return null;
}

/** What the row says under the name. Two undated papers are ONE fact, said once rather than truncated twice. */
function operatorLine(row: CarrierPaperRow, t: Translate): string {
  const sent = Object.values(row.sent ?? {}).filter((s): s is SentPaper => Boolean(s));
  if (sent.length) {
    const latest = sent.map((s) => s.sentAt).sort().reverse()[0];
    return t(sent.length > 1 ? 'tower.carrierPapers.sentRowMany' : 'tower.carrierPapers.sentRowOne', { date: formatDate(latest) });
  }
  if (row.papers.length && row.papers.every((p) => p.state === 'none')) return t('tower.carrierPapers.noDates');
  const shown = papersToShow(row.papers);
  return shown.length ? shown.map((p) => paperLine(p, t)).join(' · ') : t('tower.papers.inDate');
}

function OperatorRow({ row, on, actions }: { row: CarrierPaperRow; on: boolean; actions: TowerActions }) {
  const t = useT();
  const tag = operatorTag(row, t);
  const line = operatorLine(row, t);
  return (
    <button type="button" class={`crow${on ? ' crow--on' : ''}`} aria-expanded={on} onClick={() => actions.open(on ? null : row.did)}>
      <span class="cface" aria-hidden="true">
        <Icon name="truck" size={18} />
      </span>
      <span class="crow__body">
        <span class="crow__top">
          <span class="crow__name">{row.companyName}</span>
          {tag ? <span class={`ctag ${tag.cls}`}>{tag.text}</span> : null}
        </span>
        <span class="crow__sub">{line}</span>
      </span>
      <span class="crow__tail">
        <Icon name="chevronRight" size={16} />
      </span>
    </button>
  );
}

/** One fleet operator, whole: what is costing it work, then each paper on its own, then who enforces what. */
function OperatorSheet({ row, state, actions }: { row: CarrierPaperRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const enforcedWords = row.enforced.length
    ? row.enforced.map((k) => paperKindLabel(k as PaperView['kind'], t)).join(', ')
    : t('tower.carrierPapers.enforcedNone');

  return (
    <>
      <div class="twr-person">
        <span class="cface cface--lg" aria-hidden="true">
          <Icon name="truck" size={24} />
        </span>
        <div class="twr-person__body">
          <p class="twr-person__name">{row.companyName}</p>
          <p class="twr-person__sub">{[row.jurisdiction, row.status.toLowerCase()].filter(Boolean).join(' · ')}</p>
        </div>
      </div>

      {/* A refused save is said HERE. The screen's own error line sits under this sheet, where a phone-width
          reader cannot see it — a button that seems to do nothing is the worst answer a form can give. */}
      {state.queueError ? (
        <p class="cerr" style="margin:0 0 12px">
          <b>{t('tower.papers.refused')}</b> — {state.queueError}
        </p>
      ) : null}

      {row.notOffered.length ? (
        <p class="cerr" style="margin:0 0 12px">
          <b>{t('tower.carrierPapers.notOfferedTitle')}</b> — {row.notOffered.join('; ')}
        </p>
      ) : null}

      <PaperSection row={row} kind="operator_licence" state={state} actions={actions} />
      <PaperSection row={row} kind="carrier_insurance" state={state} actions={actions} />

      <section class="cons__panel">
        <div class="twr-facts">
          {/* What the sister behind them ACTS on — "nothing" is the usual answer and is said, never implied. */}
          <Fig label={t('tower.carrierPapers.enforcedLabel')}>{enforcedWords}</Fig>
        </div>
        {row.recordedBy ? (
          <p class="chint">{t('tower.carrierPapers.recordedBy', { who: row.recordedBy, when: row.recordedAt ? formatDate(row.recordedAt) : '' })}</p>
        ) : null}
      </section>
    </>
  );
}

/**
 * ONE PAPER, and what its date was read from.
 *
 * With a document sent: what they say first, then the document to check it against, then the two decisions
 * — record the date YOU read, or turn it down with a reason they will be shown. Their date is shown beside
 * the field and never typed into it: it is their word, and the date is there to replace their word.
 *
 * Without one: what is on record and where it came from. Recording a date with no document stays possible
 * — somebody may have the paper in their hand — but it is the smaller control, and it says so.
 */
function PaperSection({ row, kind, state, actions }: { row: CarrierPaperRow; kind: CarrierKind; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const sent = row.sent?.[kind];
  const [mode, setMode] = useState<'view' | 'record' | 'refuse'>('view');
  useEffect(() => setMode('view'), [row.did, sent?.copyRef]);
  const paper = row.papers.find((p) => p.kind === kind);
  const refused = row.refused?.[kind];
  const copy = row.copies?.[kind];
  const label = paperKindLabel(kind, t);
  const readFrom = !paper?.expiresAt ? null : copy ? t('tower.carrierPapers.readFromSent') : t('tower.carrierPapers.readFromWord');

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{sent ? t('tower.carrierPapers.sec.sent', { paper: label }) : label}</span>
      </div>

      {sent ? (
        <>
          <p class="cons__lede">
            {t('tower.carrierPapers.sentRead', { date: formatDate(sent.sentAt), expires: paperDay(sent.expiresAt) })}
            {sent.reference ? ` ${t('tower.carrierPapers.sentNumber', { number: sent.reference })}` : ''}
          </p>
          <CardPhoto mediaId={sent.copyRef} name={row.companyName} actions={actions} />
          {mode === 'refuse' ? (
            <RefusePaperForm row={row} kind={kind} state={state} actions={actions} onCancel={() => setMode('view')} />
          ) : (
            <RecordPaperForm row={row} kind={kind} sent={sent} state={state} actions={actions} onRefuse={() => setMode('refuse')} />
          )}
        </>
      ) : (
        <>
          <div class="twr-facts">
            <Fig label={t(kind === 'operator_licence' ? 'tower.carrierPapers.licenceNumberLabel' : 'tower.carrierPapers.policyLabel')}>
              {paper?.reference ?? t('tower.papers.unknown')}
            </Fig>
            <Fig label={t('tower.papers.runsOut')}>{paper?.expiresAt ? paperDay(paper.expiresAt.slice(0, 10)) : t('tower.carrierPapers.noDate')}</Fig>
            {readFrom ? <Fig label={t('tower.papers.readFrom')}>{readFrom}</Fig> : null}
          </div>
          {copy ? <DocumentStrip refs={[copy]} state={state} actions={actions} titleKey="tower.carrierPapers.readFromPhoto" emptyKey="tower.carrierPapers.noProof" /> : null}
          {refused ? (
            <p class="cons__caveat">
              <Icon name="info" size={16} />
              <span>{t('tower.carrierPapers.lastRefused', { reason: refused.reason, who: refused.by ?? '—', date: formatDate(refused.at) })}</span>
            </p>
          ) : null}
          <p class="chint">{t('tower.carrierPapers.nothingSent')}</p>
          {mode === 'record' ? (
            <RecordPaperForm row={row} kind={kind} state={state} actions={actions} onCancel={() => setMode('view')} />
          ) : (
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setMode('record')}>
              {t('tower.carrierPapers.withoutDocument')}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The date, recorded by staff who have read it. From a document: the field is labelled as YOUR reading and
 * starts empty, and a date that differs from theirs is pointed out before it is saved — two readings of one
 * image that disagree are worth a second look, and neither is assumed right. Without one: the warning that
 * this rests on no document, above the fields rather than after the save; there the box starts with what is
 * on record, and emptying it clears a date somebody mistyped.
 */
function RecordPaperForm({
  row,
  kind,
  sent,
  state,
  actions,
  onCancel,
  onRefuse,
}: {
  row: CarrierPaperRow;
  kind: CarrierKind;
  sent?: SentPaper;
  state: TowerState;
  actions: TowerActions;
  onCancel?: () => void;
  onRefuse?: () => void;
}) {
  const t = useT();
  const paper = row.papers.find((p) => p.kind === kind);
  const [reference, setReference] = useState(sent?.reference ?? paper?.reference ?? '');
  const [expiresAt, setExpiresAt] = useState(sent ? '' : (paper?.expiresAt?.slice(0, 10) ?? ''));
  // What the cover is for and up to how much a load — read off the same policy (the user, 2026-10-28: "they must prove it").
  const [covers, setCovers] = useState<CoverKind | ''>(row.insurance?.covers ?? '');
  const [limit, setLimit] = useState(row.insurance?.limit != null ? String(row.insurance.limit) : '');
  const [currency, setCurrency] = useState(row.insurance?.currency ?? '');
  const limitNumber = Number(limit);
  const limitBad = kind === 'carrier_insurance' && Boolean(limit.trim()) && (!(limitNumber > 0) || !currency);
  const busy = state.busyId === row.did;
  const differs = Boolean(sent && expiresAt && expiresAt !== sent.expiresAt);
  // From a document a date is the whole point; without one, an emptied box is a deliberate clear.
  const blocked = (sent ? !expiresAt : !expiresAt && !paper?.expiresAt) || limitBad;

  const save = () => {
    const date = expiresAt || null;
    const ref = reference.trim();
    const changedRef = ref && ref !== paper?.reference ? ref : undefined;
    void actions.recordCarrierPapers(
      row.did,
      kind === 'operator_licence'
        ? { licenceExpiresAt: date, ...(changedRef ? { licenceNumber: changedRef } : {}) }
        : {
            insuranceExpiresAt: date,
            ...(changedRef ? { insurancePolicy: changedRef } : {}),
            insuranceCovers: covers || null,
            ...(limit.trim() ? { insuranceLimit: limitNumber, insuranceCurrency: currency } : { insuranceLimit: null }),
          },
    );
  };

  return (
    <div class="twr-clear">
      {!sent ? (
        <p class="cons__caveat">
          <Icon name="warning" size={16} />
          <span>{t('tower.carrierPapers.noProof')}</span>
        </p>
      ) : null}
      <div class="twr-facts">
        <label class="cfield">
          <span class="cfield__label">{t(kind === 'operator_licence' ? 'tower.carrierPapers.licenceNumberLabel' : 'tower.carrierPapers.policyLabel')}</span>
          <input class="cinput" value={reference} autoComplete="off" onInput={(e) => setReference((e.target as HTMLInputElement).value)} />
        </label>
        <label class="cfield">
          <span class="cfield__label">{t(sent ? 'tower.carrierPapers.readDate' : 'tower.carrierPapers.expiresLabel')}</span>
          <input class="cinput" type="date" value={expiresAt} onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)} />
        </label>
      </div>
      {kind === 'carrier_insurance' ? (
        <div class="twr-facts">
          <ConsolePick
            label={t('tower.carrierPapers.covers')}
            value={covers}
            placeholder={t('tower.carrierPapers.coversNone')}
            options={COVER_KINDS.map((k) => ({ value: k, label: t(`tower.carrierPapers.covers.${k}`) }))}
            onChange={(v) => setCovers(v as CoverKind)}
          />
          <label class="cfield">
            <span class="cfield__label">{t('tower.carrierPapers.limit')}</span>
            <input class="cinput" type="number" min={1} value={limit} onInput={(e) => setLimit((e.target as HTMLInputElement).value)} />
          </label>
          <CurrencySelect api={(actions.client()?.api as never) ?? null} value={currency} onChange={setCurrency} label={t('tower.carrierPapers.limitCurrency')} near={row.jurisdiction ? [row.jurisdiction] : []} />
        </div>
      ) : null}
      {kind === 'carrier_insurance' ? <p class="chint">{t('tower.carrierPapers.coverHint')}</p> : null}
      {differs && sent ? (
        <p class="cons__caveat">
          <Icon name="warning" size={16} />
          <span>{t('tower.carrierPapers.differs', { expires: paperDay(sent.expiresAt) })}</span>
        </p>
      ) : null}
      <div class="twr-clear__act">
        <button type="button" class="cbtn cbtn--primary" disabled={blocked || busy} onClick={save}>
          {t('tower.carrierPapers.saveDate')}
        </button>
        {onRefuse ? (
          <button type="button" class="cbtn cbtn--ghost" onClick={onRefuse} disabled={busy}>
            {t('tower.carrierPapers.refuseDocument')}
          </button>
        ) : null}
        {onCancel ? (
          <button type="button" class="cbtn cbtn--ghost" onClick={onCancel} disabled={busy}>
            {t('tower.papers.cancel')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Not accepted — in a sentence the fleet office will read, because a refusal it cannot act on is silence. */
function RefusePaperForm({ row, kind, state, actions, onCancel }: { row: CarrierPaperRow; kind: CarrierKind; state: TowerState; actions: TowerActions; onCancel: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const busy = state.busyId === row.did;
  return (
    <div class="twr-clear">
      <label class="cfield">
        <span class="cfield__label">{t('tower.carrierPapers.refuseWhy')}</span>
        <textarea class="ctextarea" value={reason} maxLength={500} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} />
      </label>
      <div class="twr-clear__act">
        <button type="button" class="cbtn cbtn--danger" disabled={!reason.trim() || busy} onClick={() => void actions.refuseCarrierPaper(row.did, kind, reason.trim())}>
          {t('tower.carrierPapers.refuseSend')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" onClick={onCancel} disabled={busy}>
          {t('tower.papers.cancel')}
        </button>
      </div>
    </div>
  );
}

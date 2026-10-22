import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { formatDate, useT, type MessageKey, type Translate } from '../../../shared/i18n';
import { paperDay, renewalBlocker } from '../../../shared/papers';
import { ConsoleDetail } from '../ConsoleDetail';
import { DocumentStrip } from './DocumentStrip';
import { CardPhoto, Fig } from './PapersScreen';
import { shopLicenceNeedsLook, type ShopLicenceRow } from '../papers';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * Round 40 — THE SHOPS' TRADING LICENCES (the user: "Expiry, notice, grace"). Only staff record the date a shop's licence runs
 * to: at approval, and at each renewal, read off the licence. A renewed one the shop sent comes first — it has done its part
 * and waits on us — then the shops whose new parcels have stopped, in their grace, running out, and those approved before a
 * date was asked. Those in date are counted, not listed.
 */
const STATE: Record<ShopLicenceRow['standing']['state'], { key: MessageKey; cls: string } | null> = {
  stopped: { key: 'tower.shopLicences.state.stopped', cls: 'ctag--warn' },
  grace: { key: 'tower.shopLicences.state.grace', cls: 'ctag--warn' },
  due: { key: 'tower.shopLicences.state.due', cls: 'ctag--info' },
  none: { key: 'tower.shopLicences.state.none', cls: 'ctag--info' },
  ok: null,
};

/** One line under a shop's name: the licence sent and waiting, or what its date is doing today. */
export function shopLicenceLine(row: ShopLicenceRow, t: Translate): string {
  const l = row.standing;
  if (row.renewal) return t('tower.shopLicences.sentRow', { date: formatDate(row.renewal.sentAt) });
  if (!l.expiresAt) return t('tower.shopLicences.noDateRow');
  if (l.state === 'stopped') return t('tower.shopLicences.stoppedRow', { day: paperDay(l.expiresAt), stops: paperDay(l.stopsOn) });
  if (l.state === 'grace') return t('tower.shopLicences.graceRow', { day: paperDay(l.expiresAt), stops: paperDay(l.stopsOn) });
  return t('tower.shopLicences.runsRow', { day: paperDay(l.expiresAt) });
}

export function ShopLicencesPanel({ rows, state, actions }: { rows: ShopLicenceRow[] | null; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const shown = rows?.filter(shopLicenceNeedsLook) ?? [];
  const inDate = (rows?.length ?? 0) - shown.length;
  const waiting = rows?.filter((r) => r.renewal).length ?? 0;
  const open = rows?.find((r) => r.did === state.openId) ?? null;
  return (
    <>
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.shopLicences.title')}</span>
          {waiting ? <span class="ctag ctag--warn">{t('tower.shopLicences.waiting', { n: waiting })}</span> : null}
        </div>
        <p class="cons__lede">{t('tower.shopLicences.lede')}</p>
        {rows === null ? (
          <p class="cons__empty">{t('tower.papers.loading')}</p>
        ) : shown.length === 0 ? (
          <p class="cons__empty">{t('tower.shopLicences.allInDate', { n: inDate })}</p>
        ) : (
          <>
            <div class="crows">
              {shown.map((row) => {
                const tag = row.renewal ? { key: 'tower.shopLicences.state.sent' as MessageKey, cls: 'ctag--warn' } : STATE[row.standing.state];
                const on = state.openId === row.did;
                return (
                  <button key={row.did} type="button" class={`crow${on ? ' crow--on' : ''}`} aria-expanded={on} onClick={() => actions.open(on ? null : row.did)}>
                    <span class="crow__body">
                      <span class="crow__top">
                        <span class="crow__name">{row.shopName}</span>
                        <span class="crow__id">{row.zone}</span>
                        {tag ? <span class={`ctag ${tag.cls}`}>{t(tag.key)}</span> : null}
                      </span>
                      <span class="crow__sub">{shopLicenceLine(row, t)}</span>
                    </span>
                    <span class="crow__tail">
                      <Icon name="chevronRight" size={16} />
                    </span>
                  </button>
                );
              })}
            </div>
            {inDate ? <p class="chint">{t('tower.shopLicences.inDateCount', { n: inDate })}</p> : null}
          </>
        )}
      </section>
      {open ? (
        <ConsoleDetail openKey={open.did} title={t('tower.shopLicences.sheetTitle')} onClose={() => actions.open(null)}>
          <ShopLicenceSheet row={open} state={state} actions={actions} />
        </ConsoleDetail>
      ) : null}
    </>
  );
}

/**
 * ONE SHOP'S LICENCE. With a renewed one sent: the photograph, large, the date the shop read off it, and the two decisions —
 * record the date YOU read, or send it back with the reason the shop is shown. Without one: what is on record, the photograph
 * it was read from, and the way to put a date on it from that photograph.
 */
function ShopLicenceSheet({ row, state, actions }: { row: ShopLicenceRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [mode, setMode] = useState<'view' | 'record' | 'refuse'>('view');
  useEffect(() => setMode('view'), [row.did, row.renewal?.copyRef]);
  const sent = row.renewal;
  const onRecord = row.licence;
  const readFrom = onRecord?.copyRef ?? row.joiningCopyRef;
  return (
    <>
      <div class="twr-person">
        <div class="twr-person__body">
          <p class="twr-person__name">{row.shopName}</p>
          <p class="twr-person__sub">{[row.zone, row.country].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t(sent ? 'tower.shopLicences.sec.sent' : 'tower.shopLicences.sec.licence')}</span>
        </div>
        {sent ? (
          <>
            <p class="cons__lede">{t('tower.shopLicences.sentRead', { date: formatDate(sent.sentAt), expires: paperDay(sent.expiresAt) })}</p>
            <CardPhoto mediaId={sent.copyRef} name={row.shopName} actions={actions} />
            {mode === 'refuse' ? (
              <RefuseShopLicence row={row} state={state} actions={actions} onCancel={() => setMode('view')} />
            ) : (
              <RecordShopLicence row={row} state={state} actions={actions} onRefuse={() => setMode('refuse')} />
            )}
          </>
        ) : (
          <>
            <div class="twr-facts">
              <Fig label={t('tower.papers.number')}>{row.number ?? t('tower.papers.unknown')}</Fig>
              <Fig label={t('tower.shopLicences.runsTo')}>{onRecord ? paperDay(onRecord.expiresAt) : t('tower.shopLicences.noDate')}</Fig>
              {row.standing.stopsOn ? <Fig label={t('tower.shopLicences.stopsOn')}>{paperDay(row.standing.stopsOn)}</Fig> : null}
              {onRecord?.recordedAt ? <Fig label={t('tower.papers.readFrom')}>{t('tower.shopLicences.recordedBy', { who: onRecord.recordedBy ?? '—', date: formatDate(onRecord.recordedAt) })}</Fig> : null}
            </div>
            {readFrom ? <DocumentStrip refs={[readFrom]} state={state} actions={actions} titleKey="tower.shopLicences.photoOnRecord" emptyKey="tower.shopLicences.noPhoto" /> : null}
            {row.renewalRefusal ? (
              <p class="cons__caveat">
                <Icon name="info" size={16} />
                <span>{t('tower.shopLicences.lastRefused', { reason: row.renewalRefusal.reason, who: row.renewalRefusal.by ?? '—', date: formatDate(row.renewalRefusal.at) })}</span>
              </p>
            ) : null}
            <p class="chint">{t('tower.shopLicences.nothingSent')}</p>
            {mode === 'record' ? (
              <RecordShopLicence row={row} state={state} actions={actions} onCancel={() => setMode('view')} />
            ) : (
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setMode('record')}>
                {t(onRecord ? 'tower.shopLicences.correct' : 'tower.shopLicences.dateIt')}
              </button>
            )}
          </>
        )}
      </section>
    </>
  );
}

/** The date, as the member of staff reads it. A reading that differs from the shop's is pointed out before it is saved. */
function RecordShopLicence({ row, state, actions, onCancel, onRefuse }: { row: ShopLicenceRow; state: TowerState; actions: TowerActions; onCancel?: () => void; onRefuse?: () => void }) {
  const t = useT();
  const sent = row.renewal;
  const [expiresAt, setExpiresAt] = useState('');
  const blocker = renewalBlocker(expiresAt);
  const busy = state.busyId === row.did;
  const differs = Boolean(sent && expiresAt && !blocker && expiresAt !== sent.expiresAt);
  return (
    <div class="twr-clear">
      <label class="cfield">
        <span class="cfield__label">{t(sent ? 'tower.shopLicences.readDate' : 'tower.shopLicences.dateFromRecord')}</span>
        <input class="cinput" type="date" value={expiresAt} onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)} />
      </label>
      {differs && sent ? (
        <p class="cons__caveat">
          <Icon name="warning" size={16} />
          <span>{t('tower.shopLicences.differs', { expires: paperDay(sent.expiresAt) })}</span>
        </p>
      ) : null}
      <div class="twr-clear__act">
        <button type="button" class="cbtn cbtn--primary" disabled={blocker !== null || busy} onClick={() => void actions.recordShopLicence(row.did, expiresAt, row.shopName)}>
          {t('tower.shopLicences.save')}
        </button>
        {onRefuse ? (
          <button type="button" class="cbtn cbtn--ghost" onClick={onRefuse} disabled={busy}>
            {t('tower.shopLicences.refuse')}
          </button>
        ) : null}
        {onCancel ? (
          <button type="button" class="cbtn cbtn--ghost" onClick={onCancel} disabled={busy}>
            {t('tower.papers.cancel')}
          </button>
        ) : null}
        {blocker && expiresAt ? <span class="chint">{t(blocker)}</span> : null}
      </div>
    </div>
  );
}

/** Sent back — in a sentence the shop will read, because a refusal it cannot act on is silence. */
function RefuseShopLicence({ row, state, actions, onCancel }: { row: ShopLicenceRow; state: TowerState; actions: TowerActions; onCancel: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const busy = state.busyId === row.did;
  return (
    <div class="twr-clear">
      <label class="cfield">
        <span class="cfield__label">{t('tower.shopLicences.refuseWhy')}</span>
        <textarea class="ctextarea" value={reason} maxLength={500} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} />
      </label>
      <div class="twr-clear__act">
        <button type="button" class="cbtn cbtn--danger" disabled={!reason.trim() || busy} onClick={() => void actions.refuseShopLicence(row.did, reason.trim(), row.shopName)}>
          {t('tower.shopLicences.refuseSend')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" onClick={onCancel} disabled={busy}>
          {t('tower.papers.cancel')}
        </button>
      </div>
    </div>
  );
}

import { Abbreviated } from '../../../shared/ui/Abbr';
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import { copyReady, daysNotMatching, shortTx, type AnchorsView, type CopyCheckView } from '../trailAnchor';
import type { TowerActions } from '../useTowerApp';

/**
 * Round 40 — THE TRAIL, ANCHORED OUTSIDE OUR DATABASE (the user: "Daily to an auditor"). Once a day the chain's newest link
 * goes to an auditor's address; the address changes only by two members of staff, and the one it had is told. Each day is
 * kept here, checked against the chain as it is now; an auditor's copy read out is checked the same way.
 */
export function TrailAnchorPanel({ actions }: { actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [view, setView] = useState<AnchorsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState('');
  const [why, setWhy] = useState<string | null>(null);
  const [height, setHeight] = useState('');
  const [txId, setTxId] = useState('');
  const [checked, setChecked] = useState<CopyCheckView | null>(null);

  const answer = (r: { data?: unknown; error?: { detail?: string; title?: string } | null }) => {
    if (r.error) {
      setError(r.error.detail || r.error.title || null);
      return false;
    }
    setError(null);
    return true;
  };
  useEffect(() => {
    if (!client) return;
    void client.api.trailAnchors().then((r) => answer(r) && setView(r.data as unknown as AnchorsView));
  }, [client]);

  const act = async (call: () => Promise<{ data?: unknown; error?: { detail?: string; title?: string } | null }>) => {
    setBusy(true);
    const r = await call();
    setBusy(false);
    if (answer(r)) setView(r.data as unknown as AnchorsView);
    return !r.error;
  };

  const off = daysNotMatching(view);
  const p = view?.proposal;
  return (
    <section class="cons__panel" style="margin-bottom:18px">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.anchors.title')}</span>
        {off ? <span class="ctag ctag--warn">{t('tower.anchors.notMatching', { n: off })}</span> : null}
      </div>
      <p class="cons__lede">{t('tower.anchors.lede')}</p>
      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
      {view === null ? (
        error ? null : <p class="cons__empty">{t('tower.queues.loading')}</p>
      ) : (
        <>
          {!view.delivers ? (
            <p class="cons__caveat">
              <Icon name="info" size={16} />
              <span>{t('tower.anchors.notDelivered')}</span>
            </p>
          ) : null}

          <div class="twr-facts">
            <div>
              <span class="cfield__label">{t('tower.anchors.auditor')}</span>
              <p class="ctbl__strong">{view.auditor ? view.auditor.address : t('tower.anchors.noAuditor')}</p>
              {view.auditor ? <p class="ctbl__sub">{t('tower.anchors.namedBy', { asked: view.auditor.proposedBy, approved: view.auditor.approvedBy, date: formatDate(view.auditor.setAt) })}</p> : null}
            </div>
            <div>
              <span class="cfield__label">{t('tower.anchors.next')}</span>
              <p class="ctbl__strong">{new Date(view.nextAt).toLocaleString()}</p>
            </div>
          </div>

          {p ? (
            <div class="twr-clear">
              <p class="cons__caveat">
                <Icon name="info" size={16} />
                <span>{t(p.mine ? 'tower.anchors.waitingMine' : 'tower.anchors.waiting', { address: p.address, by: p.by, date: formatDate(p.at) })}</span>
              </p>
              {!p.mine ? (
                why === null ? (
                  <div class="twr-clear__act">
                    <button type="button" class="cbtn cbtn--primary" disabled={busy} onClick={() => void act(() => client!.api.decideAuditor({ approve: true }))}>
                      {t('tower.anchors.approve')}
                    </button>
                    <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => setWhy('')}>
                      {t('tower.anchors.decline')}
                    </button>
                  </div>
                ) : (
                  <>
                    <label class="cfield">
                      <span class="cfield__label">{t('tower.anchors.declineWhy')}</span>
                      <textarea class="ctextarea" rows={2} value={why} maxLength={500} onInput={(e) => setWhy((e.target as HTMLTextAreaElement).value)} />
                    </label>
                    <div class="twr-clear__act">
                      <button type="button" class="cbtn cbtn--danger" disabled={busy || !why.trim()} onClick={() => void act(() => client!.api.decideAuditor({ approve: false, reason: why.trim() })).then((ok) => ok && setWhy(null))}>
                        {t('tower.anchors.declineSend')}
                      </button>
                      <button type="button" class="cbtn cbtn--ghost" onClick={() => setWhy(null)}>
                        {t('common.close')}
                      </button>
                    </div>
                  </>
                )
              ) : null}
            </div>
          ) : (
            <div class="twr-clear">
              <label class="cfield">
                <span class="cfield__label">{t(view.auditor ? 'tower.anchors.changeTo' : 'tower.anchors.nameOne')}</span>
                <input class="cinput" type="email" autoComplete="off" value={address} onInput={(e) => setAddress((e.target as HTMLInputElement).value)} />
              </label>
              <p class="chint">{t('tower.anchors.twoPeople')}</p>
              <div class="twr-clear__act">
                <button type="button" class="cbtn cbtn--primary" disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim())} onClick={() => void act(() => client!.api.proposeAuditor({ address: address.trim() })).then((ok) => ok && setAddress(''))}>
                  {t('tower.anchors.ask')}
                </button>
              </div>
            </div>
          )}

          <h3 class="cons__panelt" style="margin-top:18px">{t('tower.anchors.days')}</h3>
          {view.heads.length === 0 ? (
            <p class="cons__empty"><Abbreviated text={t('tower.anchors.noDays')} /></p>
          ) : (
            <table class="ctbl ctbl--stack">
              <thead>
                <tr>
                  <th>{t('tower.anchors.col.day')}</th>
                  <th class="ctbl__num">{t('tower.anchors.col.links')}</th>
                  <th>{t('tower.anchors.col.link')}</th>
                  <th>{t('tower.anchors.col.to')}</th>
                  <th>{t('tower.anchors.col.now')}</th>
                </tr>
              </thead>
              <tbody>
                {view.heads.map((h) => (
                  <tr key={h.date}>
                    <td class="ctbl__strong">{h.date}</td>
                    <td class="ctbl__num"><span class="ctbl__lbl">{t('tower.anchors.col.links')}</span>{h.height}</td>
                    <td class="ctbl__mono" title={h.txId}><span class="ctbl__lbl">{t('tower.anchors.col.link')}</span>{h.txId ? shortTx(h.txId) : '—'}</td>
                    <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.anchors.col.to')}</span>{h.to ? (h.mailed ? h.to : t('tower.anchors.notSent', { to: h.to })) : t('tower.anchors.toNobody')}</td>
                    <td><span class="ctbl__lbl">{t('tower.anchors.col.now')}</span>{h.stillMatches ? <span class="ctag ctag--ok">{t('tower.anchors.matches')}</span> : <span class="ctag ctag--warn">{t('tower.anchors.changed')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 class="cons__panelt" style="margin-top:18px">{t('tower.anchors.checkTitle')}</h3>
          <p class="chint">{t('tower.anchors.checkLede')}</p>
          <div class="twr-facts">
            <label class="cfield">
              <span class="cfield__label">{t('tower.anchors.checkHeight')}</span>
              <input class="cinput" inputMode="numeric" value={height} onInput={(e) => setHeight((e.target as HTMLInputElement).value)} />
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('tower.anchors.checkTx')}</span>
              <input class="cinput" autoComplete="off" spellcheck={false} value={txId} onInput={(e) => setTxId((e.target as HTMLInputElement).value)} />
            </label>
          </div>
          <div class="twr-clear__act">
            <button
              type="button"
              class="cbtn cbtn--ghost"
              disabled={busy || !copyReady(height, txId)}
              onClick={async () => {
                setBusy(true);
                const r = await client!.api.checkAnchorCopy({ height: Number(height.trim()), txId: txId.trim() });
                setBusy(false);
                if (answer(r)) setChecked(r.data as unknown as CopyCheckView);
              }}
            >
              {t('tower.anchors.check')}
            </button>
          </div>
          {checked ? (
            <p class={checked.match ? 'twr-done' : 'cerr'} style="margin-top:10px">
              {checked.match ? <Icon name="check" size={16} /> : null}
              {checked.why}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

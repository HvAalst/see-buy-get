import { useEffect, useMemo, useState } from 'preact/hooks';
import { createMdpApi, type SbgClient } from '../../../lib/sbg';
import { useT } from '../../../shared/i18n';
import { Card } from '../../../shared/ui';

/** One handover as the server keeps it (backend hub-transfer.types.ts, HubTransfer): what this card shows of it. */
export interface HubTransferRow {
  transferId: string;
  bagCode: string;
  fromCountry: string;
  parcels: string[];
  released: { driverName?: string; at: string };
  received: { by: string; at: string; sealNumber?: string; asClosed?: boolean };
  exceptions: Array<{ note: string }>;
  passedOnWhole: boolean;
  onward: Array<{ kind?: 'bag' | 'counter'; bagCode: string; parcels: string[]; sealNumber?: string; driverName?: string; slot?: string }>;
}

/** How a handover's parcels went on, in words: a bag on its coded seal with its driver, or the counter's shelf here. */
export function onwardWords(o: HubTransferRow['onward'][number], t: ReturnType<typeof useT>): string {
  return o.kind === 'counter' ? t('mdp.transfers.counter', { slot: o.slot ?? '—' }) : t('mdp.transfers.onward', { bag: o.bagCode, seal: o.sealNumber ?? '—', driver: o.driverName ?? t('mdp.transfers.aDriver') });
}

/** How many of a handover's parcels still wait here for a bag on a coded seal. */
export function waitingOf(r: HubTransferRow): number {
  const gone = new Set(r.onward.flatMap((o) => o.parcels));
  return r.parcels.filter((p) => !gone.has(p)).length;
}

/**
 * 2026-11-24 — THE BAGS HANDED OVER HERE FROM ANOTHER COUNTRY (corridor compliance, slice 4), newest first: who brought each and
 * who took it over, the things wrong said there, and the bags that took its parcels on, each on its coded seal — or how many
 * still wait for one. Nothing while there are none.
 */
export function HubTransfersCard({ sbg, mdpId }: { sbg: SbgClient | null; mdpId?: string }) {
  const t = useT();
  const api = useMemo(() => (sbg ? createMdpApi(sbg) : null), [sbg]);
  const [rows, setRows] = useState<HubTransferRow[]>([]);
  useEffect(() => {
    if (!api || !mdpId) return;
    let live = true;
    void api.transfers(mdpId).then((r) => {
      const data = r.data as unknown as { transfers?: HubTransferRow[] } | undefined;
      if (live && data?.transfers) setRows(data.transfers);
    });
    return () => {
      live = false;
    };
  }, [api, mdpId]);
  if (!rows.length) return null;
  return (
    <Card title={t('mdp.transfers.title')}>
      <p class="card__note">{t('mdp.transfers.lede')}</p>
      <ul class="hubzones">
        {rows.slice(0, 10).map((r) => {
          const waiting = waitingOf(r);
          return (
            <li key={r.transferId}>
              <b class="mono">{r.bagCode}</b>{' '}
              <span class="hint">{t('mdp.transfers.who', { country: r.fromCountry, driver: r.released.driverName ?? t('mdp.transfers.aDriver'), by: r.received.by, when: new Date(r.received.at).toLocaleString() })}</span>
              {r.received.asClosed === false ? <div class="hint">{t('mdp.transfers.notAsClosed')}</div> : null}
              {r.exceptions.length ? <div class="hint">{t('mdp.transfers.wrong', { count: r.exceptions.length, first: r.exceptions[0].note })}</div> : null}
              {r.onward.map((o, i) => (
                <div key={o.bagCode || `counter-${i}`} class="hint">
                  {onwardWords(o, t)}
                </div>
              ))}
              {waiting ? <div class="hint">{t('mdp.transfers.waiting', { count: waiting })}</div> : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

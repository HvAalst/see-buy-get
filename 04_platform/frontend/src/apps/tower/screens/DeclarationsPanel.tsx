import { Abbreviated } from '../../../shared/ui/Abbr';
import { useEffect, useState } from 'preact/hooks';
import { formatDate, useT, type MessageKey } from '../../../shared/i18n';
import type { TowerActions } from '../useTowerApp';

/** One partner on the list: who, which declaration, and where they stand (security-declaration.controller.ts). */
export interface DeclarationRow {
  kind: 'shop' | 'hub' | 'fleet' | 'driver';
  did: string;
  name: string;
  state: 'signed' | 'due' | 'missing' | 'lapsed' | 'outdated';
  until?: string;
  signedBy?: string;
}

const KIND: Record<DeclarationRow['kind'], MessageKey> = { shop: 'tower.declarations.kind.shop', hub: 'tower.declarations.kind.hub', fleet: 'tower.declarations.kind.fleet', driver: 'tower.declarations.kind.driver' };
const STATE: Record<DeclarationRow['state'], { key: MessageKey; cls: string }> = {
  missing: { key: 'tower.declarations.state.missing', cls: 'ctag--warn' },
  lapsed: { key: 'tower.declarations.state.lapsed', cls: 'ctag--warn' },
  outdated: { key: 'tower.declarations.state.outdated', cls: 'ctag--warn' },
  due: { key: 'tower.declarations.state.due', cls: 'ctag--info' },
  signed: { key: 'tower.declarations.state.signed', cls: 'ctag--ok' },
};

/** How many stand where: what the panel's head says before anybody opens a row. */
export function declarationCounts(rows: readonly DeclarationRow[]): { stopped: number; due: number; signed: number } {
  return {
    stopped: rows.filter((r) => r.state === 'missing' || r.state === 'lapsed' || r.state === 'outdated').length,
    due: rows.filter((r) => r.state === 'due').length,
    signed: rows.filter((r) => r.state === 'signed').length,
  };
}

/**
 * Round 39 — THE SECURITY DECLARATIONS, AS STAFF READ THEM (the user: "At joining and yearly"). Every shop, hub, fleet and
 * rider in no fleet, and where they stand: those taking on nothing new because theirs is missing, lapsed or of an old
 * wording first, then those due within the month. Staff read it; nobody here signs for anybody.
 */
export function DeclarationsPanel({ actions }: { actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [rows, setRows] = useState<DeclarationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    void client.api.declarations().then((r) => {
      if (r.error) setError(r.error.detail || r.error.title);
      else setRows(((r.data as unknown as { items?: DeclarationRow[] })?.items ?? []).slice());
    });
  }, [client]);

  const counts = rows ? declarationCounts(rows) : null;
  const shown = rows?.filter((r) => r.state !== 'signed') ?? [];
  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.declarations.title')}</span>
        {counts ? <span class="ctbl__sub">{t('tower.declarations.counts', counts)}</span> : null}
      </div>
      <p class="cons__lede">{t('tower.declarations.lede')}</p>
      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
      {rows === null ? (
        error ? null : <p class="cons__empty">{t('tower.queues.loading')}</p>
      ) : shown.length === 0 ? (
        <p class="cons__empty">{t('tower.declarations.allSigned')}</p>
      ) : (
        <table class="ctbl ctbl--stack">
          <thead>
            <tr>
              <th>{t('tower.declarations.col.who')}</th>
              <th>{t('tower.declarations.col.state')}</th>
              <th>{t('tower.declarations.col.until')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.kind}:${r.did}`}>
                <td>
                  <div class="ctbl__strong">{r.name}</div>
                  <div class="ctbl__sub">{t(KIND[r.kind])}</div>
                </td>
                <td>
                  <span class="ctbl__lbl">{t('tower.declarations.col.state')}</span>
                  <span class={`ctag ${STATE[r.state].cls}`}>{t(STATE[r.state].key)}</span>
                </td>
                <td class="ctbl__sub">
                  <span class="ctbl__lbl">{t('tower.declarations.col.until')}</span>
                  {r.until ? formatDate(r.until) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

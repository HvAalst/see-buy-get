import { useState } from 'preact/hooks';
import type { components } from '../../../lib/sbg';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { Icon } from '../../../shared/ui';
import { formatDate, useT, type MessageKey } from '../../../shared/i18n';
import { ConsoleFold } from '../ConsoleFold';
import { ConsolePick } from '../ConsolePick';
import type { TowerActions } from '../useTowerApp';
import { invitationLink, rowReason } from '../hubDensity';

type HubList = components['schemas']['HubListView'];
type HubRow = components['schemas']['HubRow'];
const STAFF_STATUSES = ['open', 'negotiating', 'rejected'] as const;

/**
 * 2026-11-12 — A COUNTRY'S HUB LIST (the owner, on the plan "Hubs on the Road", D2: "a list of hub places with open fields:
 * name, address or location, phone, email, and status … A fourth status, joined, is set automatically when a hub signs up
 * through the row's invitation"; D7: "A suggestion becomes an open row"). Every hub place staff work through: the hubs it has,
 * the places the map suggests, the places staff add. Staff fill in a row and move it; the invitation link carries the place
 * and the row's code; a hub signing up with it makes the row joined by itself.
 */
export function HubListFold({ entityId, writer, actions, list, onList }: { entityId: string; writer: boolean; actions: TowerActions; list: HubList | null; onList: (l: HubList) => void }) {
  const t = useT();
  const client = actions.client();
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const origin = globalThis.location?.origin ?? 'https://seebuyget.com';

  const act = async (write: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setSaid(null);
    const r = (await write()) as { error?: { detail?: string; title?: string } | null; data?: unknown };
    setBusy(false);
    if (r.error) return setProblem(r.error.detail || r.error.title || '');
    setProblem(null);
    onList(r.data as unknown as HubList);
    setSaid(message);
    setOpen(null);
    setAdding(false);
    setDraft({});
  };
  const edit = (row: HubRow) => {
    setOpen(row.rowId);
    setDraft({ name: row.name ?? '', address: row.address ?? '', phone: row.phone ?? '', email: row.email ?? '', status: row.status === 'joined' ? 'open' : row.status, reason: '' });
  };
  const copy = async (row: HubRow) => {
    if (!client) return;
    const r = (await client.api.inviteHubRow(entityId, row.rowId)) as { error?: { detail?: string; title?: string } | null; data?: unknown };
    if (r.error) return setProblem(r.error.detail || r.error.title || '');
    const l = r.data as unknown as HubList;
    onList(l);
    const kept = l.rows.find((x) => x.rowId === row.rowId || (row.suggestionId && x.suggestionId === row.suggestionId));
    if (!kept?.code) return;
    const link = invitationLink(kept, kept.code, origin);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(kept.rowId);
    } catch {
      setCopied(`show:${kept.rowId}`);
    }
  };
  const field = (key: 'name' | 'address' | 'phone' | 'email', label: MessageKey, type = 'text') => (
    <label class="cfield" key={key}>
      <span class="cfield__label">{t(label)}</span>
      <input class="cinput" type={type} maxLength={key === 'address' ? 300 : 200} value={draft[key] ?? ''} onInput={(e) => setDraft({ ...draft, [key]: e.currentTarget.value })} />
    </label>
  );
  const counts = list?.counts;

  return (
    <ConsoleFold title={t('tower.hubList.title')} hint={counts ? t('tower.hubList.hint', counts) : ''} open>
      <p class="chint">{t('tower.hubList.lede')}</p>
      {problem ? (
        <p class="cerr">
          <Abbreviated text={problem} />
        </p>
      ) : null}
      {said ? (
        <p class="twr-done">
          <Icon name="check" size={16} />
          {said}
        </p>
      ) : null}
      {!list ? (
        <p class="cons__empty">{t('tower.queues.loading')}</p>
      ) : (
        <ul class="twr-suggests">
          {list.rows.map((row) => (
            <li key={row.rowId} class="twr-suggest">
              <p class="twr-clear__t">
                {row.name ?? t('tower.hubList.unnamed')} <span class={`ctag ${row.status === 'joined' ? 'ctag--quiet' : row.status === 'rejected' ? 'ctag--warn' : ''}`}>{t(`tower.hubList.status.${row.status}` as MessageKey)}</span>
                {row.suggestionKind ? <span class="ctbl__sub"> · {t(`tower.density.kind.${row.suggestionKind}` as MessageKey)}</span> : row.source === 'staff' ? <span class="ctbl__sub"> · {t('tower.hubList.byStaff')}</span> : null}
              </p>
              {row.suggestionKind ? <p class="chint">{rowReason(row, t)}</p> : null}
              {row.towns.length ? <p class="chint">{t('tower.density.towns', { towns: row.towns.join(', ') })}</p> : null}
              {row.stale ? <p class="chint">{t('tower.hubList.stale')}</p> : null}
              {[row.address, row.phone, row.email].some(Boolean) ? <p class="chint">{[row.address, row.phone, row.email].filter(Boolean).join(' · ')}</p> : null}
              {row.status === 'joined' && row.joinedAt ? <p class="chint">{t('tower.hubList.joinedOn', { hub: row.hubName ?? row.name ?? '', at: formatDate(row.joinedAt, { dateStyle: 'medium' }) })}</p> : null}
              {row.status === 'rejected' && row.reason ? <p class="chint">{t('tower.hubList.rejectedBy', { by: row.rejectedBy ?? '', at: row.rejectedAt ? formatDate(row.rejectedAt, { dateStyle: 'medium' }) : '', reason: row.reason })}</p> : null}
              {writer && client && row.kind === 'place' && row.status !== 'joined' ? (
                open === row.rowId ? (
                  <div class="twr-knobs__row">
                    {field('name', 'tower.hubList.f.name')}
                    {field('address', 'tower.hubList.f.address')}
                    {field('phone', 'tower.hubList.f.phone', 'tel')}
                    {field('email', 'tower.hubList.f.email', 'email')}
                    <ConsolePick label={t('tower.hubList.f.status')} value={draft.status ?? 'open'} onChange={(v) => setDraft({ ...draft, status: v || 'open' })} small options={STAFF_STATUSES.map((s) => ({ value: s, label: t(`tower.hubList.status.${s}` as MessageKey) }))} />
                    {draft.status === 'rejected' ? (
                      <label class="cfield">
                        <span class="cfield__label">{t('tower.hubList.f.reason')}</span>
                        <input class="cinput" maxLength={300} value={draft.reason ?? ''} onInput={(e) => setDraft({ ...draft, reason: e.currentTarget.value })} />
                      </label>
                    ) : null}
                    <div class="twr-panelend">
                      <button
                        type="button"
                        class="cbtn cbtn--primary cbtn--sm"
                        disabled={busy || (draft.status === 'rejected' && (draft.reason ?? '').trim().length < 3)}
                        onClick={() =>
                          void act(
                            () =>
                              client.api.updateHubRow(entityId, row.rowId, {
                                name: draft.name ?? '',
                                address: draft.address ?? '',
                                phone: draft.phone ?? '',
                                ...(draft.email?.trim() ? { email: draft.email.trim() } : {}),
                                status: (draft.status ?? 'open') as (typeof STAFF_STATUSES)[number],
                                ...(draft.status === 'rejected' ? { reason: (draft.reason ?? '').trim() } : {}),
                              }),
                            t('tower.hubList.saved'),
                          )
                        }
                      >
                        {t('tower.rates.save')}
                      </button>
                      <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setOpen(null)}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div class="twr-panelend">
                    <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => edit(row)}>
                      {t('tower.hubList.edit')}
                    </button>
                    {row.location ? (
                      <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => void copy(row)}>
                        {t(copied === row.rowId ? 'tower.density.copied' : 'tower.density.invite')}
                      </button>
                    ) : null}
                  </div>
                )
              ) : null}
              {copied === `show:${row.rowId}` && row.code ? <input class="cinput" readOnly value={invitationLink(row, row.code, origin)} onFocus={(e) => e.currentTarget.select()} /> : null}
            </li>
          ))}
        </ul>
      )}
      {writer && client ? (
        adding ? (
          <div class="twr-knobs__row">
            {field('name', 'tower.hubList.f.name')}
            {field('address', 'tower.hubList.f.address')}
            {field('phone', 'tower.hubList.f.phone', 'tel')}
            {field('email', 'tower.hubList.f.email', 'email')}
            <div class="twr-panelend">
              <button
                type="button"
                class="cbtn cbtn--primary cbtn--sm"
                disabled={busy || (draft.name ?? '').trim().length < 2}
                onClick={() => void act(() => client.api.addHubRow(entityId, { name: (draft.name ?? '').trim(), ...(draft.address?.trim() ? { address: draft.address.trim() } : {}), ...(draft.phone?.trim() ? { phone: draft.phone.trim() } : {}), ...(draft.email?.trim() ? { email: draft.email.trim() } : {}) }), t('tower.hubList.added'))}
              >
                {t('tower.hubList.add')}
              </button>
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setAdding(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div class="twr-panelend">
            <button
              type="button"
              class="cbtn cbtn--ghost cbtn--sm"
              onClick={() => {
                setDraft({});
                setAdding(true);
              }}
            >
              {t('tower.hubList.addPlace')}
            </button>
          </div>
        )
      ) : null}
      <p class="chint">{t('tower.density.never')}</p>
    </ConsoleFold>
  );
}

import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { formatDate, formatMoney, useT, type MessageKey, type Translate } from '../../../shared/i18n';
import { narrow } from '../../../lib/sbg';
import { ConsoleDetail } from '../ConsoleDetail';
import { callbackTone, findStores, floatState, keyState, storePage, storesInOrder, storeTroubles, type StoreDesk, type StoreRow, type StoreTrouble } from '../stores';
import type { TowerActions, TowerState } from '../useTowerApp';

const TROUBLE: Record<StoreTrouble, { tag: MessageKey; says: MessageKey }> = {
  unpaid: { tag: 'tower.stores.trouble.unpaid', says: 'tower.stores.says.unpaid' },
  awaited: { tag: 'tower.stores.trouble.awaited', says: 'tower.stores.says.awaited' },
  failing: { tag: 'tower.stores.trouble.failing', says: 'tower.stores.says.failing' },
  returns: { tag: 'tower.stores.trouble.returns', says: 'tower.stores.says.returns' },
};
const ENTRY: Record<StoreDesk['money']['recent'][number]['type'], MessageKey> = {
  TOP_UP: 'tower.stores.entry.TOP_UP',
  TOP_UP_FEE: 'tower.stores.entry.TOP_UP_FEE',
  BILLING: 'tower.stores.entry.BILLING',
  REBATE: 'tower.stores.entry.REBATE',
  CLAIM: 'tower.stores.entry.CLAIM',
};
const CALLBACK: Record<StoreDesk['callbacks']['recent'][number]['state'], MessageKey> = {
  delivered: 'tower.stores.cb.delivered',
  pending: 'tower.stores.cb.pending',
  failed: 'tower.stores.cb.failed',
};
const KEY: Record<ReturnType<typeof keyState>, MessageKey> = { used: 'tower.stores.key.used', unused: 'tower.stores.key.unused', revoked: 'tower.stores.key.revoked' };
const WHEN: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };

/** The float, as words: the figure in its own money, an empty one, or none held here at all. */
function floatWords(row: Pick<StoreRow, 'balance' | 'currency'>, t: Translate): string {
  const state = floatState(row);
  if (state === 'none') return t('tower.stores.floatNone');
  return state === 'empty' ? t('tower.stores.floatEmpty') : t('tower.stores.float', { amount: formatMoney(row.balance ?? 0, row.currency) });
}

/**
 * STORES — found, and opened.
 *
 * A store rings: its labels will not print, its system never heard that a parcel arrived. Whoever answers
 * had no list to find it in. This is that list, by the name the caller gives, and what opening one shows is
 * what the call is usually about — is there float, did a payment arrive, are its systems answering.
 *
 * Staff READ here and change nothing. What a store's own app shows the store — its buyers, their
 * collection codes, its signing secret — is not sent to this screen at all.
 */
export function StoresScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [rows, setRows] = useState<StoreRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.stores();
    if (r.error) {
      // A list that could not be read is not an empty network: say which, and keep what was already shown.
      setError(r.error.detail || r.error.title || t('tower.stores.readFailed'));
      return;
    }
    setError(null);
    setRows(storesInOrder(narrow<StoreRow[]>(r.data) ?? []));
  }, [client]);

  // Read on arriving, and again whenever the console's own "read again" is pressed.
  useEffect(() => {
    void load();
  }, [load, state.readAt]);

  const found = findStores(rows ?? [], query);
  const { shown, page: at, pages } = storePage(found, page);
  const open = rows?.find((r) => r.vendorId === openId) ?? null;

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.stores.title')}</h1>
        <p class="cons__lede">{t('tower.stores.lede')}</p>
      </header>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.stores.listTitle')}</span>
          {rows ? <span class="chint">{query.trim() ? t('tower.stores.foundCount', { found: found.length, total: rows.length }) : t('tower.stores.count', { n: rows.length })}</span> : null}
          {rows && rows.length > 0 ? (
            <input
              id="stores-find"
              class="cinput cinput--sm twr-find"
              value={query}
              onInput={(e) => {
                setQuery((e.target as HTMLInputElement).value);
                setPage(0);
              }}
              placeholder={t('tower.stores.searchPh')}
              aria-label={t('tower.stores.search')}
            />
          ) : null}
        </div>
        {error ? <p class="cerr">{error}</p> : null}
        {rows === null ? (
          error ? null : (
            <p class="cons__empty">{t('tower.imports.loading')}</p>
          )
        ) : rows.length === 0 ? (
          <p class="cons__empty">{t('tower.stores.none')}</p>
        ) : found.length === 0 ? (
          <p class="cons__empty">{t('tower.stores.noneFound', { query: query.trim() })}</p>
        ) : (
          <div class="crows">
            {shown.map((r) => {
              const float = floatState(r);
              return (
                <button key={r.vendorId} type="button" class={`crow${openId === r.vendorId ? ' crow--on' : ''}`} onClick={() => setOpenId(openId === r.vendorId ? null : r.vendorId)}>
                  <span class="crow__body">
                    <span class="crow__top">
                      <span class="crow__name">{r.name}</span>
                      {/* Said only where it differs from the ordinary: a store with float, an account and
                          nothing odd about it carries no tag at all. */}
                      {float === 'empty' ? <span class="ctag ctag--warn">{t('tower.stores.tag.empty')}</span> : null}
                      {float === 'none' ? <span class="ctag ctag--quiet">{t('tower.stores.tag.noTill')}</span> : null}
                      {r.hasAccount ? null : <span class="ctag ctag--quiet">{t('tower.stores.tag.bySecret')}</span>}
                    </span>
                    <span class="crow__sub">
                      {[r.country, r.companyName, float === 'held' ? floatWords(r, t) : null, r.address].filter(Boolean).join(' · ')}
                    </span>
                    <span class="crow__sub ctbl__mono">{r.vendorId}</span>
                  </span>
                  <span class="crow__tail">
                    <Icon name="chevronRight" size={16} />
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {/* The pager says where you are, not only which way to go. */}
        {rows !== null && pages > 1 ? (
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={at === 0} onClick={() => setPage(at - 1)}>
              {t('tower.imports.prev')}
            </button>
            <span class="chint">{t('tower.imports.page', { page: at + 1, pages, shown: shown.length, total: found.length })}</span>
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>
              {t('tower.imports.next')}
            </button>
          </div>
        ) : null}
      </section>

      {open ? <StoreDetail row={open} state={state} actions={actions} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

/**
 * ONE STORE, OPENED. First what is likely wrong, in a sentence each with where it is put right; then who
 * the store is; then the three things a call is about — its money, its shipments, its systems.
 */
function StoreDetail({ row, state, actions, onClose }: { row: StoreRow; state: TowerState; actions: TowerActions; onClose: () => void }) {
  const t = useT();
  const client = actions.client();
  const [desk, setDesk] = useState<StoreDesk | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setDesk(null);
    setError(null);
    if (!client) return;
    void client.api.storeDesk(row.vendorId).then((r) => {
      if (stale) return;
      if (r.error) setError(r.error.detail || r.error.title || t('tower.stores.readFailed'));
      else setDesk(narrow<StoreDesk>(r.data) ?? null);
    });
    // A slow answer for the store that was open before must not land on the one open now.
    return () => {
      stale = true;
    };
  }, [client, row.vendorId, state.readAt]);

  const troubles = desk ? storeTroubles(desk) : [];

  return (
    <ConsoleDetail openKey={row.vendorId} title={row.name} onClose={onClose}>
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{row.name}</span>
          {troubles.length ? (
            <span class="twr-tags">
              {troubles.map((k) => (
                <span key={k} class="ctag ctag--warn">
                  {t(TROUBLE[k].tag)}
                </span>
              ))}
            </span>
          ) : null}
          {desk && troubles.length === 0 ? <span class="ctag ctag--ok">{t('tower.stores.nothingWrong')}</span> : null}
        </div>
        {error ? <p class="cerr">{error}</p> : null}
        {!desk && !error ? <p class="cons__empty">{t('tower.imports.loading')}</p> : null}
        {desk ? (
          <>
            {troubles.length ? (
              troubles.map((k) => (
                <p key={k} class="cons__caveat">
                  <Icon name="warning" size={16} />
                  <span>{t(TROUBLE[k].says, { unpaid: desk.shipments.unpaid, open: desk.money.open.length, failed: desk.callbacks.failed, returns: desk.returnsWaiting })}</span>
                </p>
              ))
            ) : (
              <p class="cons__lede">{t('tower.stores.nothingWrongLede')}</p>
            )}
            <dl class="cons__facts">
              <Fact k={t('tower.stores.fact.id')}>
                <span class="ctbl__mono">{desk.vendorId}</span>
              </Fact>
              <Fact k={t('tower.stores.fact.where')}>{[desk.country, desk.companyName ?? t('tower.stores.noCompany')].join(' · ')}</Fact>
              {desk.address ? <Fact k={t('tower.stores.fact.address')}>{desk.address}</Fact> : null}
              <Fact k={t('tower.stores.fact.since')}>{formatDate(desk.createdAt)}</Fact>
              <Fact k={t('tower.stores.fact.signIn')}>
                {t(desk.signIn.hasAccount ? 'tower.stores.signIn.account' : 'tower.stores.signIn.secret')}
                {desk.signIn.secretRotatedAt ? ` ${t('tower.stores.signIn.rotated', { date: formatDate(desk.signIn.secretRotatedAt) })}` : ''}
              </Fact>
              <Fact k={t('tower.stores.fact.phone')}>{desk.contact.phoneEnding ? t('tower.stores.phoneEnding', { ending: desk.contact.phoneEnding }) : t('tower.stores.phoneNone')}</Fact>
              <Fact k={t('tower.stores.fact.dock')}>{desk.dock ? t('tower.stores.dock', { label: desk.dock.label, zone: desk.dock.zone, bays: desk.dock.bays }) : t('tower.stores.dockNone')}</Fact>
              <Fact k={t('tower.stores.fact.rating')}>
                {desk.reputation.isNew || desk.reputation.count === 0 ? t('tower.stores.ratingNew') : t('tower.stores.rating', { average: desk.reputation.average.toFixed(1), count: desk.reputation.count })}
              </Fact>
            </dl>
          </>
        ) : null}
      </section>

      {desk ? (
        <>
          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.stores.sec.money')}</span>
              <span class="chint">{floatWords(desk, t)}</span>
            </div>
            {desk.balance === null ? <p class="cons__lede">{t('tower.stores.noTillLede', { country: desk.country })}</p> : null}
            {desk.money.open.length ? (
              <table class="ctbl" id="store-open">
                <thead>
                  <tr>
                    <th>{t('tower.stores.col.reference')}</th>
                    <th>{t('tower.stores.col.asked')}</th>
                    <th>{t('tower.stores.col.started')}</th>
                  </tr>
                </thead>
                <tbody>
                  {desk.money.open.map((f) => (
                    <tr key={f.reference}>
                      <td class="ctbl__mono">{f.reference}</td>
                      <td>{formatMoney(f.amount, f.currency)}</td>
                      <td class="ctbl__sub">{formatDate(f.openedAt, WHEN)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {desk.money.recent.length ? (
              <table class="ctbl" id="store-entries">
                <thead>
                  <tr>
                    <th>{t('tower.stores.col.entry')}</th>
                    <th>{t('tower.stores.col.amount')}</th>
                    <th>{t('tower.stores.col.when')}</th>
                  </tr>
                </thead>
                <tbody>
                  {desk.money.recent.map((m, i) => (
                    <tr key={`${m.at}:${i}`}>
                      <td>
                        <div class="ctbl__lines">
                          <span>{t(ENTRY[m.type])}</span>
                          {m.parcelId ? <span class="ctbl__mono">{m.parcelId}</span> : null}
                        </div>
                      </td>
                      <td>{`${m.sign === '+' ? '+' : '−'}${formatMoney(m.amount, m.currency)}`}</td>
                      <td class="ctbl__sub">{formatDate(m.at, WHEN)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : desk.balance === null ? null : (
              <p class="cons__empty">{t('tower.stores.noEntries')}</p>
            )}
            {desk.money.recent.length ? <p class="chint">{t('tower.stores.recentHint')}</p> : null}
          </section>

          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.stores.sec.shipments')}</span>
              <span class="chint">{t('tower.stores.shipmentCounts', { total: desk.shipments.total, active: desk.shipments.active, unpaid: desk.shipments.unpaid })}</span>
            </div>
            {desk.shipments.recent.length ? (
              <>
                <table class="ctbl" id="store-parcels">
                  <thead>
                    <tr>
                      <th>{t('tower.stores.col.parcel')}</th>
                      <th>{t('tower.stores.col.state')}</th>
                      <th>{t('tower.stores.col.goingTo')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {desk.shipments.recent.map((p) => (
                      <tr key={p.parcelId}>
                        <td>
                          <div class="ctbl__lines">
                            <span class="ctbl__mono">{p.parcelId}</span>
                            {p.externalOrderId ? <span>{t('tower.stores.orderNo', { order: p.externalOrderId })}</span> : null}
                          </div>
                        </td>
                        <td>
                          <div class="ctbl__lines">
                            <span>{p.status.replace(/_/g, ' ').toLowerCase()}</span>
                            {/* In a span of its own: a tag that is a line of a column stretches to the column's width. */}
                            {p.paid ? null : (
                              <span>
                                <span class="ctag ctag--warn">{t('tower.stores.unpaid')}</span>
                              </span>
                            )}
                          </div>
                        </td>
                        <td class="ctbl__sub">
                          <div class="ctbl__lines">
                            <span>{p.destZone}</span>
                            <span>{formatDate(p.at, WHEN)}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p class="chint">{t('tower.stores.parcelHint')}</p>
              </>
            ) : (
              <p class="cons__empty">{t('tower.stores.noShipments')}</p>
            )}
            {desk.returnsWaiting ? <p class="chint">{t('tower.stores.returnsWaiting', { n: desk.returnsWaiting })}</p> : null}
          </section>

          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.stores.sec.systems')}</span>
              {desk.callbacks.url ? <span class="chint">{t('tower.stores.cbCounts', { delivered: desk.callbacks.delivered, pending: desk.callbacks.pending, failed: desk.callbacks.failed })}</span> : null}
            </div>
            {desk.callbacks.url ? (
              <p class="cons__lede">
                {t('tower.stores.cbTo')} <span class="ctbl__mono">{desk.callbacks.url}</span>
                {'. '}
                {t(desk.callbacks.carriesCode ? 'tower.stores.cbCarries' : 'tower.stores.cbCarriesNot')}
                {desk.callbacks.lastDeliveredAt ? ` ${t('tower.stores.cbLast', { date: formatDate(desk.callbacks.lastDeliveredAt, WHEN) })}` : ''}
              </p>
            ) : (
              <p class="cons__lede">{t('tower.stores.cbNone')}</p>
            )}
            {desk.callbacks.recent.length ? (
              <table class="ctbl" id="store-callbacks">
                <thead>
                  <tr>
                    <th>{t('tower.stores.col.told')}</th>
                    <th>{t('tower.stores.col.arrived')}</th>
                    <th>{t('tower.stores.col.said')}</th>
                  </tr>
                </thead>
                <tbody>
                  {desk.callbacks.recent.map((c, i) => (
                    <tr key={`${c.at}:${i}`}>
                      <td>
                        <div class="ctbl__lines">
                          <span>{c.event.replace(/_/g, ' ')}</span>
                          <span class="ctbl__sub">{formatDate(c.at, WHEN)}</span>
                        </div>
                      </td>
                      <td>
                        <span class={`ctag ctag--${callbackTone(c.state)}`}>{t(CALLBACK[c.state])}</span>
                      </td>
                      <td class="ctbl__sub">
                        <div class="ctbl__lines">
                          {c.lastError ? <span>{c.lastError}</span> : null}
                          <span>{c.state === 'pending' && c.nextTryAt ? t('tower.stores.cbNext', { n: c.attempts, date: formatDate(c.nextTryAt, WHEN) }) : t('tower.stores.cbTries', { n: c.attempts })}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {desk.keys.length ? (
              <table class="ctbl" id="store-keys">
                <thead>
                  <tr>
                    <th>{t('tower.stores.col.key')}</th>
                    <th>{t('tower.stores.col.keyState')}</th>
                    <th>{t('tower.stores.col.keyDates')}</th>
                  </tr>
                </thead>
                <tbody>
                  {desk.keys.map((k) => {
                    const ks = keyState(k);
                    return (
                      <tr key={k.keyId}>
                        <td>
                          <div class="ctbl__lines">
                            <span>{k.label ?? t(k.kind === 'secret' ? 'tower.stores.key.secret' : 'tower.stores.key.publishable')}</span>
                            <span class="ctbl__sub">{t('tower.stores.key.line', { kind: t(k.kind === 'secret' ? 'tower.stores.key.secret' : 'tower.stores.key.publishable'), mode: k.mode, hint: k.hint })}</span>
                          </div>
                        </td>
                        <td>
                          <span class={`ctag ctag--${ks === 'used' ? 'ok' : 'quiet'}`}>{t(KEY[ks])}</span>
                        </td>
                        <td class="ctbl__sub">
                          <div class="ctbl__lines">
                            <span>{t('tower.stores.key.made', { date: formatDate(k.createdAt) })}</span>
                            {k.revokedAt ? <span>{t('tower.stores.key.revokedOn', { date: formatDate(k.revokedAt) })}</span> : k.lastUsedAt ? <span>{t('tower.stores.key.lastUsed', { date: formatDate(k.lastUsedAt, WHEN) })}</span> : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p class="cons__empty">{t('tower.stores.noKeys')}</p>
            )}
          </section>

          <p class="chint">{t('tower.stores.readOnly')}</p>
        </>
      ) : null}
    </ConsoleDetail>
  );
}

function Fact({ k, children }: { k: string; children: ComponentChildren }) {
  return (
    <div class="cons__fact">
      <dt class="cons__factk">{k}</dt>
      <dd class="cons__factv">{children}</dd>
    </div>
  );
}

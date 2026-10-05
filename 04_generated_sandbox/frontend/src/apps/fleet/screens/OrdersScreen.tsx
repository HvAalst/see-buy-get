import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { SbgClient } from '../../../lib/sbg';
import { Button, Card, CodeCard, ErrorNote, Explainer, Note, Pill, PlacePicker, ReadAloud, Sheet } from '../../../shared/ui';
import type { GeoPoint } from '../../../shared/geo';
import { useT, type MessageKey } from '../../../shared/i18n';
import { PACKAGING_OPTIONS } from '../../agent/logic';
import { TAG_TONE, byDay, dayOf, daySummary, dayWord, mayWithdraw, orderTag, ordersApi, weightWords, type Contract, type FleetOrder, type InviteIssued } from '../orders';
import { OrderUpload } from './OrderUpload';

const TAG_WORD: Record<ReturnType<typeof orderTag>, MessageKey> = {
  unplanned: 'fleet.orders.tag.unplanned',
  onTruck: 'fleet.orders.tag.onTruck',
  onRoad: 'fleet.orders.tag.onRoad',
  delivered: 'fleet.orders.tag.delivered',
  withdrawn: 'fleet.orders.tag.withdrawn',
  late: 'fleet.orders.tag.late',
};

/**
 * P1 — THE ORDERS THIS FLEET MUST CARRY, AND THE CONTRACTS THEY ARRIVE UNDER.
 *
 * The user, 2026-10-05: a webshop selling bricks takes next-day orders, and the fleet with the contract plans its
 * trucks for tomorrow from around midday. So the screen opens on TOMORROW, says first how much there is and how much
 * still has no truck, and keeps anything late in sight whatever day is chosen. Every tag is a fact on the order —
 * nothing here is an estimate.
 */
export function OrdersScreen({ sbg, managerDid, who }: { sbg: SbgClient | null; managerDid: string | undefined; who: string | undefined }) {
  const t = useT();
  const api = useMemo(() => (sbg && managerDid ? ordersApi(sbg, managerDid) : null), [sbg, managerDid]);
  const [orders, setOrders] = useState<FleetOrder[] | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [day, setDay] = useState(() => dayOf(new Date(), 1));
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<FleetOrder | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    const now = new Date();
    const [o, c] = await Promise.all([api.orders({ from: dayOf(now, -14), to: dayOf(now, 30) }), api.contracts()]);
    if (o.error) return setError(o.error);
    setError(null);
    setOrders(o.data?.items ?? []);
    setContracts(c.data?.items ?? []);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const now = new Date();
  const groups = byDay(orders ?? []);
  // Today and tomorrow are always offered: tomorrow is what gets planned, today is what is happening.
  const days = [...new Set([dayOf(now), dayOf(now, 1), ...groups.map((g) => g.day).filter((d) => d >= dayOf(now))])].sort();
  const late = (orders ?? []).filter((o) => o.late && o.deliverOn < day);
  const chosen = groups.find((g) => g.day === day)?.orders ?? [];
  const sum = daySummary(chosen);

  return (
    <div class="scr">
      <h1 class="scr__title">{t('fleet.orders.title')}</h1>
      <Explainer who={who} id="fleet.orders.how" text={t('fleet.orders.lede')} />
      {error ? <ErrorNote error={error as never} onRetry={() => void load()} /> : null}

      <div class="chips" role="tablist" aria-label={t('fleet.orders.dayLabel')}>
        {days.map((d) => (
          <button key={d} type="button" role="tab" class={'chip chip--tap' + (d === day ? ' chip--on' : '')} aria-selected={d === day} onClick={() => setDay(d)}>
            {dayWord(d, now, t)}
          </button>
        ))}
      </div>

      {orders === null ? (
        <p class="hint">{t('fleet.orders.loading')}</p>
      ) : (
        <>
          <Card label={dayWord(day, now, t)}>
            {sum.orders === 0 ? (
              <p class="hint">{t('fleet.orders.dayEmpty')}</p>
            ) : (
              <p class="orders__sum">
                <strong>{t(sum.orders === 1 ? 'fleet.orders.sumOne' : 'fleet.orders.sum', { n: sum.orders, weight: weightWords(sum.kg) })}</strong>
                {sum.unplanned ? <span class="orders__sumwarn">{t('fleet.orders.sumUnplanned', { n: sum.unplanned })}</span> : <span>{t('fleet.orders.sumAllPlanned')}</span>}
                {sum.delivered ? <span>{t('fleet.orders.sumDelivered', { n: sum.delivered })}</span> : null}
              </p>
            )}
            {chosen.length ? <OrderRows orders={chosen} onOpen={setOpen} /> : null}
          </Card>

          {late.length ? (
            <Card label={t('fleet.orders.behind', { n: late.length })}>
              <OrderRows orders={late} onOpen={setOpen} showDay />
            </Card>
          ) : null}
        </>
      )}

      <ContractsCard api={api} contracts={contracts} onChanged={load} />

      {open ? <OrderSheet order={open} api={api} onClose={() => setOpen(null)} onChanged={load} /> : null}

      <div class="scr__foot">
        <ReadAloud text={() => t('fleet.orders.aloud', { day: dayWord(day, now, t), n: sum.orders, unplanned: sum.unplanned })} label={t('fleet.readAloud')} />
      </div>
    </div>
  );
}

function OrderRows({ orders, onOpen, showDay }: { orders: FleetOrder[]; onOpen: (o: FleetOrder) => void; showDay?: boolean }) {
  const t = useT();
  return (
    <div class="rows" role="list">
      {orders.map((o) => {
        const tag = orderTag(o);
        return (
          <button key={o.freightId} type="button" class="row" role="listitem" onClick={() => onOpen(o)}>
            <span class="row__body">
              <span class="row__t">
                {o.code} · {o.description}
              </span>
              <span class="row__s">{`${o.pickupLabel} → ${o.destLabel} · ${weightWords(o.weightKg)}`}</span>
              {o.destLocation ? null : <span class="row__s orders__nopin">{t('fleet.orders.noPin')}</span>}
              <span class="row__s">
                {o.onBehalfOf ? t('fleet.orders.forClient', { shipper: o.contract.shipperName, client: o.onBehalfOf.name }) : o.contract.shipperName}
                {o.orderRef ? ` · ${o.orderRef}` : ''}
                {showDay ? ` · ${t('fleet.orders.due', { day: o.deliverOn })}` : ''}
                {o.deliveryWindow ? ` · ${o.deliveryWindow}` : ''}
                {o.driverName ? ` · ${t('fleet.orders.driver', { name: o.driverName, plate: o.plate ?? '' })}` : ''}
              </span>
            </span>
            <span class="row__end">
              <Pill tone={TAG_TONE[tag]} dot>
                {t(TAG_WORD[tag])}
              </Pill>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** One order: everything about it, and — while it has no truck — putting it on a driver who is out now. */
function OrderSheet({ order, api, onClose, onChanged }: { order: FleetOrder; api: ReturnType<typeof ordersApi> | null; onClose: () => void; onChanged: () => Promise<void> }) {
  const t = useT();
  const [drivers, setDrivers] = useState<Array<{ did: string; name: string; plate: string; remainingKg: number }> | null>(null);
  const [driver, setDriver] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const unplanned = order.status === 'ordered';
  const [withdrawing, setWithdrawing] = useState(false);
  // An uploaded order whose address the map did not know: the office places it, so it can be planned.
  const needsPin = order.uploaded && !order.destLocation && (order.status === 'ordered' || order.status === 'claimed');
  const [pinLabel, setPinLabel] = useState(order.destLabel);
  const [pin, setPin] = useState<GeoPoint | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!api || !unplanned) return;
    void api.onShift().then((r) => {
      const list = r.data?.drivers ?? [];
      setDrivers(list);
      setDriver(list.find((d) => d.remainingKg >= order.weightKg)?.did ?? '');
    });
  }, [api, unplanned, order.weightKg]);

  const assign = async () => {
    if (!api || !driver) return;
    setBusy(true);
    setError(null);
    const r = await api.assign(order.freightId, driver);
    setBusy(false);
    if (r.error) return setError(r.error);
    await onChanged();
    onClose();
  };

  const savePin = async () => {
    if (!api || !pin) return;
    setBusy(true);
    setError(null);
    const r = await api.pin(order.freightId, pin);
    setBusy(false);
    if (r.error) return setError(r.error);
    await onChanged();
    onClose();
  };

  const withdraw = async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    const r = await api.withdraw(order.freightId, reason.trim());
    setBusy(false);
    if (r.error) return setError(r.error);
    await onChanged();
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={`${order.code} · ${order.description}`}>
      <div class="rows">
        <Fact k={t('fleet.orders.f.shipper')} v={order.onBehalfOf ? t('fleet.orders.forClient', { shipper: order.contract.shipperName, client: order.onBehalfOf.name }) : order.contract.shipperName} />
        {order.contract.reference ? <Fact k={t('fleet.orders.f.contract')} v={order.contract.reference} /> : null}
        {order.orderRef ? <Fact k={t('fleet.orders.f.orderRef')} v={order.orderRef} /> : null}
        <Fact k={t('fleet.orders.f.from')} v={order.pickupLabel} />
        <Fact k={t('fleet.orders.f.to')} v={order.destLabel} />
        <Fact k={t('fleet.orders.f.arrives')} v={order.deliveryWindow ? `${order.deliverOn} · ${order.deliveryWindow}` : order.deliverOn} />
        <Fact k={t('fleet.orders.f.weight')} v={`${weightWords(order.weightKg)} · ${t((PACKAGING_OPTIONS.find((p) => p.value === order.packaging)?.labelKey ?? "agent.accept.packPiece") as MessageKey)}`} />
        {order.postedByName ? <Fact k={t(order.uploaded ? 'fleet.orders.f.uploadedBy' : 'fleet.orders.f.orderedBy')} v={order.postedByName} /> : null}
        {order.driverName ? <Fact k={t('fleet.orders.f.driver')} v={`${order.driverName}${order.plate ? ` · ${order.plate}` : ''}`} /> : null}
        {order.receiverName ? <Fact k={t('fleet.orders.f.receivedBy')} v={order.receiverName} /> : null}
      </div>
      <p class="hint">
        <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer">
          {t('fleet.orders.track')}
        </a>
      </p>

      {needsPin && api ? (
        <div style="margin-top:12px">
          <PlacePicker
            id="o-pin"
            fieldLabel={t('fleet.orders.pin.field')}
            placeholder={order.destLabel}
            mapLabel={t('fleet.orders.pin.map')}
            findLabel={t('fleet.upload.find')}
            label={pinLabel}
            pin={pin}
            reference={order.pickupLocation}
            onLabel={setPinLabel}
            onPin={(p) => setPin(p)}
            geocode={async (q) => {
              const r = await api.geocode(q);
              return r.error || !r.data ? null : r.data;
            }}
            noteText={(n) => (n.kind === 'pinned' || (n.kind === 'found' && n.confidence !== 'fallback') ? t('fleet.orders.pin.set') : t('fleet.orders.pin.how'))}
          />
          <div style="margin-top:10px">
            <Button variant="outline" chevron={false} disabled={!pin} busy={busy} onClick={() => void savePin()}>
              {t('fleet.orders.pin.save')}
            </Button>
          </div>
        </div>
      ) : null}

      {unplanned ? (
        drivers === null ? (
          <p class="hint">{t('fleet.orders.loading')}</p>
        ) : drivers.length === 0 ? (
          <p class="hint">{t('fleet.orders.nobodyOut')}</p>
        ) : (
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="o-driver">
              {t('fleet.orders.putOn')}
            </label>
            <select id="o-driver" class="select" value={driver} onChange={(e) => setDriver(e.currentTarget.value)}>
              {driver ? null : <option value="">{t('fleet.orders.noneFits', { weight: weightWords(order.weightKg) })}</option>}
              {drivers.map((d) => (
                <option key={d.did} value={d.did} disabled={d.remainingKg < order.weightKg}>
                  {t(d.remainingKg < order.weightKg ? 'fleet.orders.driverNoRoom' : 'fleet.orders.driverOption', { name: d.name, plate: d.plate, room: weightWords(d.remainingKg) })}
                </option>
              ))}
            </select>
            {error ? <ErrorNote error={error as never} showDetail /> : null}
            <div style="margin-top:12px">
              <Button chevron={false} onClick={() => void assign()} disabled={!driver} busy={busy}>
                {t('fleet.orders.assignCta')}
              </Button>
            </div>
            <p class="hint" style="margin-top:8px">
              {t('fleet.orders.assignHint')}
            </p>
          </div>
        )
      ) : null}

      {mayWithdraw(order) ? (
        withdrawing ? (
          <div class="field" style="margin-top:16px">
            <label class="field__label" for="o-why">
              {t('fleet.orders.withdrawWhy')}
            </label>
            <input id="o-why" class="input" maxLength={280} value={reason} onInput={(e) => setReason(e.currentTarget.value)} />
            {!unplanned && error ? <ErrorNote error={error as never} showDetail /> : null}
            <div class="orders__acts">
              <Button variant="outline" chevron={false} onClick={() => setWithdrawing(false)}>
                {t('common.cancel')}
              </Button>
              <Button chevron={false} disabled={reason.trim().length < 3} busy={busy} onClick={() => void withdraw()}>
                {t('fleet.orders.withdrawCta')}
              </Button>
            </div>
          </div>
        ) : (
          <div style="margin-top:16px">
            <Button variant="link" chevron={false} onClick={() => setWithdrawing(true)}>
              {t('fleet.orders.withdraw')}
            </Button>
            <p class="hint">{t('fleet.orders.withdrawHint')}</p>
          </div>
        )
      ) : null}
    </Sheet>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div class="row row--static">
      <span class="row__body">
        <span class="row__s">{k}</span>
        <span class="row__t">{v}</span>
      </span>
    </div>
  );
}

/** The fleet's contracts: record one, send its shipper a link code, end one. */
function ContractsCard({ api, contracts, onChanged }: { api: ReturnType<typeof ordersApi> | null; contracts: Contract[]; onChanged: () => Promise<void> }) {
  const t = useT();
  const [form, setForm] = useState({ shipperName: '', reference: '', startsOn: '', endsOn: '' });
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<InviteIssued | null>(null);
  const [uploadFor, setUploadFor] = useState<Contract | null>(null);
  const [imported, setImported] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = async <T,>(fn: () => Promise<{ data?: T; error?: unknown }>, after?: (data: T) => void) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.error || r.data === undefined) return setError(r.error);
    after?.(r.data);
    await onChanged();
  };

  return (
    <Card title={t('fleet.contracts.title')}>
      <p class="hint">{t('fleet.contracts.lede')}</p>
      {contracts.length ? (
        <div class="rows" role="list">
          {contracts.map((c) => (
            <div key={c.contractId} class="row row--static" role="listitem">
              <span class="row__body">
                <span class="row__t">
                  {c.shipper.name}
                  {c.reference ? ` · ${c.reference}` : ''}
                </span>
                <span class="row__s">
                  {c.status === 'ended'
                    ? t(c.ended?.side === 'shipper' ? 'fleet.contracts.endedByShipper' : 'fleet.contracts.endedByYou', { when: (c.ended?.at ?? '').slice(0, 10) })
                    : c.shipper.entityId
                      ? t('fleet.contracts.linked', { when: (c.shipper.linkedAt ?? '').slice(0, 10) })
                      : c.inviteExpiresAt
                        ? t('fleet.contracts.codeOut', { until: c.inviteExpiresAt.slice(0, 10) })
                        : t('fleet.contracts.notLinked')}
                </span>
                {c.status === 'active' ? (
                  <span class="orders__acts">
                    <Button variant="outline" chevron={false} disabled={busy} onClick={() => setUploadFor(c)}>
                      {t('fleet.upload.cta')}
                    </Button>
                    {!c.shipper.entityId ? (
                      <Button variant="outline" chevron={false} disabled={busy} onClick={() => void run(() => api!.invite(c.contractId), setIssued)}>
                        {t(c.inviteExpiresAt ? 'fleet.contracts.newCode' : 'fleet.contracts.sendCode')}
                      </Button>
                    ) : null}
                    <Button variant="link" chevron={false} disabled={busy} onClick={() => void run(() => api!.endContract(c.contractId))}>
                      {t('fleet.contracts.end')}
                    </Button>
                  </span>
                ) : null}
              </span>
              <span class="row__end">
                <Pill tone={c.status === 'active' ? 'ok' : 'idle'}>{t(c.status === 'active' ? 'fleet.contracts.active' : 'fleet.contracts.ended')}</Pill>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p class="hint">{t('fleet.contracts.none')}</p>
      )}
      {error ? <ErrorNote error={error as never} showDetail /> : null}
      {imported !== null ? <Note tone="ok" icon="check" title={t(imported === 1 ? 'fleet.upload.doneOne' : 'fleet.upload.done', { n: imported })} /> : null}
      {uploadFor && api ? (
        <OrderUpload
          contract={uploadFor}
          api={api}
          onClose={() => setUploadFor(null)}
          onImported={async (n) => {
            setImported(n);
            await onChanged();
          }}
        />
      ) : null}

      {adding ? (
        <div style="margin-top:12px">
          <div class="field">
            <label class="field__label" for="c-shipper">
              {t('fleet.contracts.f.shipper')}
            </label>
            <input id="c-shipper" class="input" maxLength={120} value={form.shipperName} onInput={(e) => setForm((p) => ({ ...p, shipperName: e.currentTarget.value }))} />
          </div>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="c-ref">
              {t('fleet.contracts.f.reference')}
            </label>
            <input id="c-ref" class="input" maxLength={60} value={form.reference} onInput={(e) => setForm((p) => ({ ...p, reference: e.currentTarget.value }))} />
          </div>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="c-from">
              {t('fleet.contracts.f.from')}
            </label>
            <input id="c-from" class="input" type="date" value={form.startsOn} onInput={(e) => setForm((p) => ({ ...p, startsOn: e.currentTarget.value }))} />
          </div>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="c-to">
              {t('fleet.contracts.f.to')}
            </label>
            <input id="c-to" class="input" type="date" value={form.endsOn} onInput={(e) => setForm((p) => ({ ...p, endsOn: e.currentTarget.value }))} />
          </div>
          <p class="hint">{t('fleet.contracts.f.termsHint')}</p>
          <div style="margin-top:12px">
            <Button
              chevron={false}
              disabled={!form.shipperName.trim()}
              busy={busy}
              onClick={() =>
                void run(
                  () =>
                    api!.createContract({
                      shipperName: form.shipperName.trim(),
                      ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
                      ...(form.startsOn ? { startsOn: form.startsOn } : {}),
                      ...(form.endsOn ? { endsOn: form.endsOn } : {}),
                    }),
                  () => {
                    setForm({ shipperName: '', reference: '', startsOn: '', endsOn: '' });
                    setAdding(false);
                  },
                )
              }
            >
              {t('fleet.contracts.saveCta')}
            </Button>
          </div>
        </div>
      ) : (
        <div style="margin-top:12px">
          <Button variant="outline" chevron={false} onClick={() => setAdding(true)}>
            {t('fleet.contracts.newCta')}
          </Button>
        </div>
      )}

      <Sheet open={issued !== null} onClose={() => setIssued(null)} title={t('fleet.contracts.codeTitle', { shipper: issued?.contract.shipper.name ?? '' })}>
        {issued ? (
          <>
            <CodeCard label={t('fleet.contracts.codeLabel')} code={issued.code} />
            <p class="hint">{t('fleet.contracts.codeHint', { until: issued.expiresAt.slice(0, 10) })}</p>
          </>
        ) : null}
      </Sheet>
    </Card>
  );
}

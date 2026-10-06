import { useCallback, useEffect, useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Icon, Note, Pill } from '../../../shared/ui';
import { formatDate, useT, type MessageKey } from '../../../shared/i18n';
import { PlanAdviser } from './PlanAdviser';
import { SplitOrder } from './SplitOrder';
import { acceptTellsShippers, askOf, dayOf, dayWord, distanceLine, handOnLine, hoursWords, keptOff, leftByReason, putOnto, ruleLine, windowLine, sendLine, weightWords, withoutRule, type DayPlan, type PlanAsk, type PlanLeftReason, type PlanSendResult, type ordersApi } from '../orders';

const REASON: Record<PlanLeftReason, { title: MessageKey; what: MessageKey }> = {
  no_pin: { title: 'fleet.plan.left.noPin', what: 'fleet.plan.left.noPinDo' },
  too_heavy: { title: 'fleet.plan.left.tooHeavy', what: 'fleet.plan.left.tooHeavyDo' },
  no_truck_can_carry: { title: 'fleet.plan.left.cannotCarry', what: 'fleet.plan.left.cannotCarryDo' },
  no_time: { title: 'fleet.plan.left.noTime', what: 'fleet.plan.left.noTimeDo' },
  no_driver: { title: 'fleet.plan.left.noDriver', what: 'fleet.plan.left.noDriverDo' },
  no_trucks: { title: 'fleet.plan.left.noTrucks', what: 'fleet.plan.left.noTrucksDo' },
};

/**
 * P3 — THE PLAN FOR A DAY, as the office reads and changes it.
 *
 * The user, 2026-10-05: from around midday the manager plans tomorrow, "so they know whether they need to hire
 * external drivers/trucks". So the first thing on the board is that answer — how much of the day is on a truck, and
 * how many trucks short the fleet is — then what does not fit and why, then each truck's day, trip after trip, in the
 * order it will be driven.
 *
 * The office changes what is true of ITS day (a truck in the workshop, a later start, slower roads) and the plan is
 * worked out again. It is a proposal until accepted; accepting writes it onto the orders. Every time on it is an
 * estimate from distance and those settings, and is marked as one.
 *
 * P5 — the office can also SAY what it wants, to an adviser that asks the planner again. Whatever that leaves in force
 * is on the board to read and to take off: the settings in the line under the answer, each rule on a line of its own.
 */
export function PlanBoard({ day, api, accepted, newSince, hasPartners, onClose, onAccepted }: { day: string; api: ReturnType<typeof ordersApi>; accepted?: DayPlan | null; newSince?: number; hasPartners?: boolean; onClose: () => void; onAccepted: () => Promise<void> | void }) {
  const t = useT();
  const [ask, setAsk] = useState<PlanAsk>(() => askOf(day, accepted));
  const [plan, setPlan] = useState<DayPlan | null>(accepted ?? null);
  const [busy, setBusy] = useState<'plan' | 'accept' | 'send' | null>(accepted ? null : 'plan');
  const [sent, setSent] = useState<PlanSendResult | null>(null);
  const [handed, setHanded] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tune, setTune] = useState(false);
  const [done, setDone] = useState(false);

  const propose = useCallback(
    async (next: PlanAsk) => {
      setBusy('plan');
      setError(null);
      setDone(false);
      const r = await api.proposePlan(next);
      setBusy(null);
      if (r.error || !r.data) return setError(r.error);
      setPlan(r.data);
    },
    [api],
  );

  useEffect(() => {
    if (!accepted) void propose({ day });
    // Only on opening: the accepted plan is shown as accepted until the office asks for another.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  const change = (patch: Partial<PlanAsk>) => {
    const next = { ...ask, ...patch };
    setAsk(next);
    void propose(next);
  };

  const accept = async () => {
    setBusy('accept');
    setError(null);
    const r = await api.acceptPlan(ask);
    setBusy(null);
    if (r.error || !r.data) return setError(r.error);
    setPlan(r.data);
    setDone(true);
    await onAccepted();
  };

  const sendOut = async () => {
    setBusy('send');
    setError(null);
    const r = await api.sendPlan(day);
    setBusy(null);
    if (r.error || !r.data) return setError(r.error);
    setSent(r.data);
    await onAccepted();
  };

  // P4 — what does not fit goes to the partners first, then to the open board. Either way the orders leave this
  // plan, so it is worked out again and shows what is still nobody's.
  const handOn = async (what: 'offer' | 'release') => {
    if (!plan) return;
    const ids = plan.unplanned.map((u) => u.freightId);
    setBusy('send');
    setError(null);
    const r = what === 'offer' ? await api.offerOrders(ids) : await api.releaseOrders(ids);
    setBusy(null);
    if (r.error || !r.data) return setError(r.error);
    setHanded(handOnLine(what, r.data, t));
    await onAccepted();
    if (!plan.accepted) await propose(ask);
  };

  const now = new Date();
  const isToday = day === dayOf(now);
  const s = plan?.settings;
  const left = plan ? leftByReason(plan.unplanned) : [];
  // A plan kept from before there were rules has none.
  const rules = plan?.rules ?? [];
  // The vehicles an order can be put on by hand: the ones going out.
  const going = (plan?.vehicles ?? []).filter((v) => !v.excluded && !v.offRoad?.length);

  return (
    <div class="scr plan">
      <div class="scr__back">
        <Button variant="link" chevron={false} onClick={onClose}>
          <Icon name="chevronLeft" size={20} /> {t('fleet.plan.back')}
        </Button>
      </div>
      <h1 class="scr__title">{t('fleet.plan.title', { day: dayWord(day, now, t) })}</h1>
      {error ? <ErrorNote error={error as never} showDetail onRetry={() => void propose(ask)} /> : null}

      {!plan ? (
        <p class="hint">{t('fleet.plan.working')}</p>
      ) : (
        <>
          {/* THE ANSWER FIRST: how much of the day is on a truck, and how short the fleet is. */}
          <Card>
            <p class="plan__head">
              <strong>{t('fleet.plan.head', { planned: plan.totals.planned, orders: plan.totals.orders, used: plan.totals.trucksUsed, trucks: plan.totals.trucksAvailable })}</strong>
              <span>{t('fleet.plan.headKm', { km: Math.round(plan.totals.km), empty: Math.round(plan.totals.emptyKm), weight: weightWords(plan.totals.plannedKg) })}</span>
            </p>
            {plan.totals.orders === 0 ? <p class="hint">{t('fleet.plan.nothing')}</p> : null}
            {plan.hire ? (
              <Note
                tone="warn"
                icon="warning"
                title={t(plan.hire.trucks === 1 ? 'fleet.plan.hireOne' : 'fleet.plan.hire', { n: plan.hire.trucks, size: weightWords(plan.hire.capacityKg) })}
                detail={t('fleet.plan.hireDetail', { orders: plan.hire.orders, weight: weightWords(plan.hire.weightKg) })}
              />
            ) : plan.unplanned.length === 0 && plan.totals.orders > 0 ? (
              <Note tone="ok" icon="check" title={t('fleet.plan.allFit')} />
            ) : null}
            {/* WINDOWS the plan could not keep, or could not read. A plan kept from before windows were planned to says neither. */}
            {plan.totals.outsideWindow ? <Note tone="warn" icon="warning" title={t(plan.totals.outsideWindow === 1 ? 'fleet.plan.win.outsideOne' : 'fleet.plan.win.outside', { n: plan.totals.outsideWindow })} detail={t('fleet.plan.win.outsideDetail')} /> : null}
            {plan.totals.unreadWindows ? <p class="hint">{t(plan.totals.unreadWindows === 1 ? 'fleet.plan.win.unreadOne' : 'fleet.plan.win.unreadMany', { n: plan.totals.unreadWindows })}</p> : null}
            {plan.totals.drivers < plan.totals.trucksAvailable ? <p class="hint">{t('fleet.plan.driversShort', { drivers: plan.totals.drivers, trucks: plan.totals.trucksAvailable })}</p> : null}
            <p class="hint">{t('fleet.plan.estimate', { start: s!.dayStart, hours: hoursWords(s!.dayHours * 60), speed: s!.speedKmh, load: s!.loadMin, unload: s!.unloadMin })}</p>
            {/* WHAT THE DISTANCES ARE: by road, or the estimate — and, where a routing server was there and failed, that. */}
            {(() => {
              const d = distanceLine(plan.distances, t);
              return <p class={'hint' + (d.tone === 'warn' ? ' plan__win--warn' : '')}>{d.text}</p>;
            })()}

            <div class="plan__acts">
              {plan.accepted ? (
                <Pill tone="ok" dot>
                  {t('fleet.plan.acceptedBy', { who: plan.accepted.by, when: formatDate(plan.accepted.at, { timeStyle: 'short' }) })}
                </Pill>
              ) : (
                <Button chevron={false} disabled={plan.totals.planned === 0 || busy !== null} busy={busy === 'accept'} onClick={() => void accept()}>
                  {t('fleet.plan.accept')}
                </Button>
              )}
              {plan.accepted ? (
                <Button
                  variant="outline"
                  chevron={false}
                  disabled={busy !== null}
                  onClick={() => {
                    setTune(true);
                    setSent(null);
                    void propose(ask);
                  }}
                >
                  {t('fleet.plan.again')}
                </Button>
              ) : (
                <Button variant="outline" chevron={false} onClick={() => setTune((v) => !v)}>
                  {t(tune ? 'fleet.plan.tuneHide' : 'fleet.plan.tune')}
                </Button>
              )}
            </div>
            {done ? (
              <p class="hint">{t('fleet.plan.acceptedNote')}</p>
            ) : plan.accepted ? (
              <p class="hint">
                {t('fleet.plan.asAccepted')}
                {newSince ? ` ${t(newSince === 1 ? 'fleet.orders.planNewOne' : 'fleet.orders.planNew', { n: newSince })}` : ''}
              </p>
            ) : plan.totals.planned > 0 ? (
              <p class="hint">{t(accepted ? 'fleet.plan.proposalReplaces' : 'fleet.plan.proposal')}</p>
            ) : null}
            {/* Accepting reaches outside the office: said before the button is pressed, not found out afterwards. */}
            {!plan.accepted && !done && acceptTellsShippers(plan) ? <p class="hint">{t('fleet.plan.tellsShippers')}</p> : null}
            {/* ON THE DAY ITSELF the accepted plan goes out trip by trip — by itself as shifts start and loads are
                handed over, and from here when the office wants it now. */}
            {plan.accepted && isToday ? (
              <div class="plan__send">
                <Button variant="outline" chevron={false} busy={busy === 'send'} disabled={busy !== null} onClick={() => void sendOut()}>
                  {t('fleet.plan.send.cta')}
                </Button>
                <p class="hint">{t('fleet.plan.send.hint')}</p>
                {sent ? (
                  <ul class="plan__leftlist" role="status">
                    {sent.trucks.map((truck) => (
                      <li key={truck.vehicleId} class={truck.held.length ? 'plan__held' : undefined}>
                        {sendLine(truck, t)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </Card>

          {/* THE RULES IN FORCE: said in full, and each one the office's to take off. On an accepted plan, a record. */}
          {rules.length ? (
            <Card title={t('fleet.plan.rules.title')}>
              <ul class="plan__leftlist plan__rules">
                {rules.map((r) => (
                  <li key={`${r.kind}:${r.freightId}:${r.vehicleId}`}>
                    <span class="plan__stopt">{ruleLine(r, t)}</span>
                    {plan.accepted ? null : (
                      <Button variant="link" chevron={false} full={false} disabled={busy !== null} onClick={() => change(withoutRule(rules, r))}>
                        {t('fleet.plan.rules.remove')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              <p class="hint">{t('fleet.plan.rules.hint')}</p>
            </Card>
          ) : null}

          {tune && !plan.accepted ? (
            <Card title={t('fleet.plan.tuneTitle')}>
              <div class="plan__tune">
                <div class="field">
                  <label class="field__label" for="pl-start">
                    {t('fleet.plan.f.start')}
                  </label>
                  <input id="pl-start" class="input" type="time" value={s!.dayStart} onChange={(e) => change({ dayStart: e.currentTarget.value })} />
                </div>
                <div class="field">
                  <label class="field__label" for="pl-hours">
                    {t('fleet.plan.f.hours')}
                  </label>
                  <input id="pl-hours" class="input" type="number" min={1} max={13} step={0.5} value={s!.dayHours} onChange={(e) => change({ dayHours: Number(e.currentTarget.value) })} />
                </div>
                <div class="field">
                  <label class="field__label" for="pl-speed">
                    {t('fleet.plan.f.speed')}
                  </label>
                  <input id="pl-speed" class="input" type="number" min={5} max={110} step={5} value={s!.speedKmh} onChange={(e) => change({ speedKmh: Number(e.currentTarget.value) })} />
                </div>
                <div class="field">
                  <label class="field__label" for="pl-load">
                    {t('fleet.plan.f.load')}
                  </label>
                  <input id="pl-load" class="input" type="number" min={0} max={240} step={5} value={s!.loadMin} onChange={(e) => change({ loadMin: Number(e.currentTarget.value) })} />
                </div>
                <div class="field">
                  <label class="field__label" for="pl-unload">
                    {t('fleet.plan.f.unload')}
                  </label>
                  <input id="pl-unload" class="input" type="number" min={0} max={240} step={5} value={s!.unloadMin} onChange={(e) => change({ unloadMin: Number(e.currentTarget.value) })} />
                </div>
              </div>
              <p class="field__label" style="margin-top:14px">
                {t('fleet.plan.f.trucks')}
              </p>
              <div class="chips">
                {plan.vehicles.map((v) => {
                  const out = v.excluded || Boolean(v.offRoad?.length);
                  return (
                    <button
                      key={v.vehicleId}
                      type="button"
                      class={'chip chip--tap' + (out ? '' : ' chip--on')}
                      aria-pressed={!out}
                      disabled={Boolean(v.offRoad?.length)}
                      title={v.offRoad?.join(' · ')}
                      onClick={() => {
                        const set = new Set(ask.excludeVehicleIds ?? []);
                        if (set.has(v.vehicleId)) set.delete(v.vehicleId);
                        else set.add(v.vehicleId);
                        change({ excludeVehicleIds: [...set] });
                      }}
                    >
                      {v.offRoad?.length ? t('fleet.plan.truckOff', { plate: v.plate, why: v.offRoad[0] }) : t('fleet.plan.truckChip', { plate: v.plate, size: weightWords(v.capacityKg) })}
                    </button>
                  );
                })}
              </div>
              <p class="hint">{t('fleet.plan.f.trucksHint')}</p>
              <p class="hint">{t('fleet.plan.rules.keepOffHint')}</p>
            </Card>
          ) : null}

          {/* P5 — SAY IT INSTEAD. Only over a proposal: an accepted plan is a record, and is not talked into another. */}
          {plan.accepted ? null : (
            <PlanAdviser
              api={api}
              ask={ask}
              busy={busy !== null}
              onAdvice={(advice) => {
                setAsk(advice.ask);
                setPlan(advice.plan);
                setDone(false);
              }}
            />
          )}

          {/* WHAT DOES NOT FIT, by reason: each reason is a different thing to do about it. */}
          {handed ? <Note tone="ok" icon="check" title={handed} /> : null}
          {plan.unplanned.length && !plan.accepted ? (
            <Card title={t('fleet.plan.handOn.title', { n: plan.unplanned.length })}>
              <p class="hint">{t('fleet.plan.handOn.hint')}</p>
              <div class="plan__acts">
                {hasPartners ? (
                  <Button chevron={false} disabled={busy !== null} onClick={() => void handOn('offer')}>
                    {t('fleet.plan.handOn.offerCta')}
                  </Button>
                ) : null}
                <Button variant="outline" chevron={false} disabled={busy !== null} onClick={() => void handOn('release')}>
                  {t('fleet.plan.handOn.releaseCta')}
                </Button>
              </div>
              {hasPartners ? null : <p class="hint">{t('fleet.handOn.noPartners')}</p>}
            </Card>
          ) : null}
          <div class="plan__left">
          {left.map((g) => (
            <Card key={g.reason} title={t(REASON[g.reason].title, { n: g.orders.length })}>
              <p class="hint">{t(REASON[g.reason].what)}</p>
              <ul class="plan__leftlist">
                {g.orders.map((o) => (
                  <li key={o.freightId}>
                    <span class="plan__stopt">{`${o.destLabel} · ${weightWords(o.weightKg)}`}</span>
                    <span class="plan__stops-s">{`${o.code} · ${o.description} · ${o.shipperName}${o.orderRef ? ` · ${o.orderRef}` : ''}`}</span>
                    {/* HEAVIER THAN ANY VEHICLE GOING OUT, and the office's to split: so many loads of the largest. */}
                    {o.splitInto && !plan.accepted ? (
                      <span class="plan__byhand">
                        <SplitOrder
                          order={o}
                          suggest={o.splitInto}
                          loadKg={o.loadKg}
                          api={api}
                          onDone={async () => {
                            await onAccepted();
                            await propose(ask);
                          }}
                        />
                      </span>
                    ) : null}
                    {/* BY HAND, while the office is changing its day: this order goes on that vehicle, or on none. */}
                    {tune && !plan.accepted && going.length > 0 && g.reason !== 'no_pin' ? (
                      <span class="plan__byhand">
                              <select
                                class="select plan__moveto"
                                aria-label={t('fleet.plan.rules.putOnLabel', { code: o.code })}
                                value=""
                                disabled={busy !== null}
                                onChange={(e) => {
                                  const vehicleId = e.currentTarget.value;
                                  if (vehicleId) change(putOnto(rules, { freightId: o.freightId, vehicleId }));
                                }}
                              >
                                <option value="">{t('fleet.plan.rules.putOnCta')}</option>
                                {going
                                  .map((v) => (
                                    <option key={v.vehicleId} value={v.vehicleId}>
                                      {t('fleet.plan.truckChip', { plate: v.plate, size: weightWords(v.capacityKg) })}
                                    </option>
                                  ))}
                              </select>
                      </span>
                    ) : null}
                    {/* A rule on this order may be WHY it is here: said beside it, so the reason above is not read as the whole story. */}
                    {rules
                      .filter((r) => r.freightId === o.freightId)
                      .map((r) => (
                        <span key={`${r.kind}:${r.vehicleId}`} class="plan__stops-s plan__ruled">
                          {t('fleet.plan.rules.onLeft', { rule: ruleLine(r, t) })}
                        </span>
                      ))}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          </div>

          {/* EACH TRUCK'S DAY. Side by side where there is room; one under another on a phone. */}
          <div class="plan__grid">
            {plan.routes.map((r) => (
              <section key={r.vehicleId} class="plan__truck" aria-label={r.plate}>
                <header class="plan__truckhead">
                  <span class="plan__plate">{r.plate}</span>
                  <span class="plan__trucksub">{t('fleet.plan.truckSub', { size: weightWords(r.capacityKg), full: r.fullestPct })}</span>
                  <span class="plan__trucksub">{t('fleet.plan.truckDay', { hours: hoursWords(r.minutes), home: r.home, km: Math.round(r.km), empty: Math.round(r.emptyKm) })}</span>
                </header>
                {r.trips.map((trip) => (
                  <div key={trip.no} class="plan__trip">
                    <p class="plan__triphead">
                      <strong>{t('fleet.plan.trip', { no: trip.no, start: trip.start })}</strong>
                      <span>{t('fleet.plan.tripSub', { from: trip.pickupLabel, weight: weightWords(trip.weightKg), empty: Math.round(trip.emptyKm) })}</span>
                    </p>
                    <ol class="plan__stops">
                      {trip.stops.map((stop) => (
                        <li key={stop.freightId}>
                          <span class="plan__time">~{stop.arrive}</span>
                          <span class="plan__stop">
                            <span class="plan__stopt">{stop.destLabel}</span>
                            <span class="plan__stops-s">
                              {`${stop.code} · ${stop.description} · ${weightWords(stop.weightKg)}`}
                              {stop.deliveryWindow ? ` · ${t('fleet.plan.window', { window: stop.deliveryWindow })}` : ''}
                            </span>
                            {(() => {
                              const w = windowLine(stop, t);
                              return w ? <span class={`plan__stops-s plan__win plan__win--${w.tone}`}>{w.text}</span> : null;
                            })()}
                            {/* A RULE BY HAND, while the office is changing its day: this order, not on this vehicle. */}
                            {tune && !plan.accepted ? (
                              <span class="plan__byhand">
                                <Button variant="link" chevron={false} full={false} disabled={busy !== null} onClick={() => change(keptOff(rules, { freightId: stop.freightId, vehicleId: r.vehicleId }))}>
                                  {t('fleet.plan.rules.keepOffCta')}
                                </Button>
                                {going.length > 1 ? (
                              <select
                                class="select plan__moveto"
                                aria-label={t('fleet.plan.rules.putOnLabel', { code: stop.code })}
                                value=""
                                disabled={busy !== null}
                                onChange={(e) => {
                                  const vehicleId = e.currentTarget.value;
                                  if (vehicleId) change(putOnto(rules, { freightId: stop.freightId, vehicleId }));
                                }}
                              >
                                <option value="">{t('fleet.plan.rules.moveTo')}</option>
                                {going
                                  .filter((v) => v.vehicleId !== r.vehicleId)
                                  .map((v) => (
                                    <option key={v.vehicleId} value={v.vehicleId}>
                                      {t('fleet.plan.truckChip', { plate: v.plate, size: weightWords(v.capacityKg) })}
                                    </option>
                                  ))}
                              </select>
                                ) : null}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </section>
            ))}
          </div>
          {busy === 'plan' ? <p class="hint">{t('fleet.plan.working')}</p> : null}
        </>
      )}
    </div>
  );
}

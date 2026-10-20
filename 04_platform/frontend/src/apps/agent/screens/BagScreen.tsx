import { useEffect, useState } from 'preact/hooks';
import { Button, Card, CodeCard, ErrorNote, Explainer, Icon, Note, Pill, ReadAloud, ScanField, Sheet } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import type { AgentActions, AgentState } from '../useAgentApp';
import { BagCloseFields } from '../../../shared/BagSealFields';
import { closeReady, closureBody, EMPTY_BAG_CLOSE, type BagCloseForm } from '../../../shared/bagSeal';

export interface BagScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/** Preset reasons for leaving a waiting parcel out of the bag — tappable, so nothing has to be typed. */
const LEFT_OUT_REASONS: Array<{ value: string; labelKey: MessageKey }> = [
  { value: 'Bag was full', labelKey: 'agent.bag.reasonFull' },
  { value: 'Parcel not ready', labelKey: 'agent.bag.reasonNotReady' },
  { value: 'Going on a later bus', labelKey: 'agent.bag.reasonLater' },
];

/**
 * Bag the parcels for one destination so the driver scans ONCE instead of a dozen times.
 *
 * The shop picks where the bag is going, SCANS each parcel in, and seals it. Scanning is the working
 * loop — the worker is looking at the parcel in their hands, not at the screen — so the sticker field
 * comes first and the list below is the fallback for a parcel whose sticker will not read. It is also
 * where the wrong-destination refusal lands at the moment of the mistake, with the parcel still in hand.
 *
 * Sealing is the commitment: the server refuses a bag that leaves a parcel for that destination on the
 * shelf, and names the ones missing, which light up here exactly as the handover screen's "waiting" rows
 * do. Either put them in, or leave them behind on purpose with a reason.
 */
export function BagScreen({ state, actions }: BagScreenProps) {
  const t = useT();
  const bag = state.bag;
  const [leaveOpen, setLeaveOpen] = useState(false);
  // Round 36 — how it is closed for the road: a coded seal and its number, or a photograph alone.
  const [closing, setClosing] = useState<BagCloseForm>(EMPTY_BAG_CLOSE);
  useEffect(() => setClosing(EMPTY_BAG_CLOSE), [bag?.code]);

  // What to bag is the SERVER's answer, grouped by next hop — several bags at once is the normal case,
  // and a shopkeeper never has to work out whether a parcel goes direct or via the hub.
  const { groups, staging } = state.bagPlan;
  // Floor room decides how much of that plan can happen at once. With room for two bags and four
  // destinations, the useful question is not "what is waiting" but "which two do I pack" — which is what
  // busiest-first has always answered; the number is what makes the ordering matter.
  const noRoom = !!staging && staging.free <= 0;
  const group = bag ? groups.find((g) => g.key === bag.destKey) : undefined;
  const forDest = group ? state.shopParcels.filter((p) => group.parcelIds.includes(p.parcelId)) : [];
  const inBag = new Set(bag?.parcels ?? []);
  const missed = new Set(bag?.missed ?? []);

  return (
    <div class="scr">
      <h1 class="scr__title">{t('agent.bag.title')}</h1>
      <Explainer who={state.agent?.did} id="agent.bag.how" text={t('agent.bag.lede')} />

      {state.error ? <ErrorNote error={state.error} /> : null}

      {!bag ? (
        <Card label={t('agent.bag.whereTo')}>
          {state.bagPlanState === 'loading' ? (
            <p class="hint">{t('agent.handover.gettingParcels')}</p>
          ) : groups.length === 0 ? (
            <Note tone="info" icon="box" title={t('agent.bag.nothingTitle')} detail={t('agent.bag.nothingBody')} />
          ) : (
            <div class="rows" role="list">
              {groups.map((g) => {
                // A group with a bag already open is always reachable; a NEW bag needs floor room.
                const blocked = noRoom && !g.openBagCode;
                return (
                  <button
                    key={g.key}
                    type="button"
                    class="row"
                    role="listitem"
                    onClick={() => void actions.openBag(g)}
                    disabled={blocked || state.busy === 'bag-open'}
                  >
                    <span class="row__ic"><Icon name="bag" size={24} /></span>
                    <span class="row__body">
                      <span class="row__t">{g.label}</span>
                      {/* "Direct" is the useful word at a counter: it means this bag skips the hub. */}
                      <span class="row__s">
                        {t('agent.bag.waitingForZone', { count: g.parcelIds.length })}
                        {g.via === 'direct' ? ` · ${t('agent.bag.viaDirect')}` : ` · ${t('agent.bag.viaHub')}`}
                      </span>
                    </span>
                    {g.openBagCode ? (
                      <Pill tone="info" dot>{g.openBagCode}</Pill>
                    ) : blocked ? (
                      <Pill tone="warn" dot>{t('agent.bag.noRoomPill')}</Pill>
                    ) : (
                      <span class="row__end"><Icon name="chevronRight" size={22} /></span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {/* Say the room, always — knowing you have one bay left changes which destination you pack. */}
          {staging ? (
            <p class="card__note">
              {staging.free > 0
                ? t('agent.bag.roomFree', { free: staging.free, capacity: staging.capacity })
                : t('agent.bag.roomNone', { capacity: staging.capacity })}
            </p>
          ) : null}
        </Card>
      ) : (
        <>
          {/* The bag's own code is the thing the driver scans — it IS the hand-over. */}
          <CodeCard label={t('agent.bag.bagCode', { zone: bag.label })} code={bag.code} scanAs="parcel" sayLabel={t('agent.bag.hearCode')} />
          <Button variant="link" full={false} onClick={() => actions.clearBag()}>{t('agent.bag.backToPlan')}</Button>

          {bag.sealed ? (
            <>
              <Note tone="ok" icon="check" title={t('agent.bag.sealedTitle')} detail={t('agent.bag.sealedBody', { count: bag.parcels.length })} />
              <div class="scr__cta">
                <Button chevron={false} onClick={() => actions.clearBag()}>{t('agent.bag.startAnother')}</Button>
              </div>
            </>
          ) : (
            <>
              {/* The working loop: scan, hear the beep, take the next parcel. The camera closes on each
                  read, so the field is cleared here and is ready for the next one. */}
              <Card>
                <ScanField
                  id="bag-parcel"
                  label={t('agent.bag.scanLabel')}
                  value={bag.scan}
                  onValue={(v) => actions.setBagScan(v)}
                  expect="parcel"
                  placeholder={t('agent.scanPlaceholder')}
                  upper
                  enterKeyHint="go"
                  onScan={(v) => void actions.submitBagScan(v)}
                />
                {/* Spoken back for the worker whose eyes are on the parcel, not the screen. */}
                <p class="card__note" aria-live="polite">
                  {bag.lastAdded ? t('agent.bag.wentIn', { id: bag.lastAdded }) : t('agent.bag.scanHint')}
                </p>
                <Button variant="outline" onClick={() => void actions.submitBagScan()} disabled={!bag.scan.trim()} busy={state.busy === 'bag-fill'}>
                  {t('agent.bag.addCta')}
                </Button>
              </Card>

              <Card label={t('agent.bag.inBag', { count: bag.parcels.length })}>
                {forDest.length === 0 ? (
                  <p class="hint">{t('agent.bag.nothingForZone')}</p>
                ) : (
                  <div class="rows" role="list">
                    {forDest.map((p) => {
                      const added = inBag.has(p.parcelId);
                      const waiting = missed.has(p.parcelId);
                      return (
                        <button
                          key={p.parcelId}
                          type="button"
                          class={`row${added ? ' row--on' : ''}`}
                          role="listitem"
                          aria-pressed={added}
                          disabled={added || state.busy === 'bag-fill'}
                          onClick={() => void actions.addToBag(p.parcelId)}
                        >
                          <span class="row__ic"><Icon name={added ? 'check' : 'box'} size={24} /></span>
                          <span class="row__body">
                            <span class="row__t">{p.parcelId}</span>
                            <span class="row__s">{p.size}</span>
                          </span>
                          {waiting ? <Pill tone="warn" dot>{t('agent.bag.stillWaiting')}</Pill> : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>

              {/* A full bag only leaves when the shop closes it — the sweep will not do it behind the
                  counter, so this is the moment to say so. */}
              {bag.fillPct >= 100 ? (
                <Note tone="info" icon="bag" title={t('agent.bag.fullTitle')} detail={t('agent.bag.fullBody')} />
              ) : null}

              {/* The gate's refusal, explained where the shopkeeper can act on it. */}
              {bag.missed.length ? (
                <Note tone="warn" icon="warning" title={t('agent.bag.leftTitle', { count: bag.missed.length })} detail={t('agent.bag.leftBody')} />
              ) : null}

              {bag.parcels.length ? (
                <Card>
                  <BagCloseFields id="bag-close" value={closing} onChange={setClosing} upload={(f) => actions.uploadPhoto('seal', f)} disabled={state.busy === 'bag-seal'} />
                </Card>
              ) : null}

              <div class="scr__cta">
                <Button chevron={false} busy={state.busy === 'bag-seal'} disabled={bag.parcels.length === 0 || !closeReady(closing)} onClick={() => void actions.sealBag({ closure: closureBody(closing) })}>
                  {t('agent.bag.seal')}
                </Button>
                {bag.missed.length ? (
                  <Button variant="link" full={false} disabled={!closeReady(closing)} onClick={() => setLeaveOpen(true)}>
                    {t('agent.bag.leaveBehind')}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </>
      )}

      <div class="scr__foot">
        <ReadAloud text={() => t('agent.bag.aloud')} label={t('agent.readAloud')} />
      </div>

      <Sheet open={leaveOpen} onClose={() => setLeaveOpen(false)} title={t('agent.bag.leaveTitle')}>
        <p class="t-body">{t('agent.bag.leaveBody', { count: bag?.missed.length ?? 0 })}</p>
        <div class="rows">
          {LEFT_OUT_REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              class="row"
              onClick={() => {
                setLeaveOpen(false);
                void actions.sealBag({ acknowledgeShortShip: true, shortShipReason: r.value, closure: closureBody(closing) });
              }}
            >
              <span class="row__body"><span class="row__t">{t(r.labelKey)}</span></span>
              <span class="row__end"><Icon name="chevronRight" size={22} /></span>
            </button>
          ))}
        </div>
        <Button variant="link" onClick={() => setLeaveOpen(false)}>{t('agent.cancel')}</Button>
      </Sheet>
    </div>
  );
}

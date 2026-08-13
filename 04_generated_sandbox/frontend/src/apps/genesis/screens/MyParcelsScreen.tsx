import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Checklist, CodeCard, ErrorNote, Icon, Note, Pill, ReadAloud, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { PhotoField } from './PhotoField';
import { LADDER, isOffLadder, ladderIndex, parcelRowLine, relationWord, sortForPerson, statusPresentation, stepTime } from '../logic';
import type { ConsumerParcelView, FreightShipmentView, ParcelStatus } from '../types';
import type { SendActions, SendState } from '../useSendApp';

export interface MyParcelsScreenProps {
  state: SendState;
  actions: SendActions;
}

const PILL_TONE = { ok: 'ok', info: 'info', danger: 'danger' } as const;

/**
 * The receiver/sender home (S21). Every parcel this person is a party to, matched by their verified
 * phone — the parcels coming TO them first (the ones they act on), then the ones they are sending.
 * Tapping a parcel opens its authenticated twin: the same status ladder the public track shows, but
 * reached by identity, not by pasting a code.
 */
export function MyParcelsScreen({ state, actions }: MyParcelsScreenProps) {
  const t = useT();
  useEffect(() => {
    if (state.parcelsState === 'idle') void actions.loadParcels();
  }, [state.parcelsState, actions]);

  const open = openParcelView(state);
  if (open) return <ParcelDetail parcel={open} state={state} actions={actions} />;

  const received = sortForPerson(state.parcels?.received ?? []);
  const sent = sortForPerson(state.parcels?.sent ?? []);
  const freights = state.parcels?.freights ?? [];
  const empty = state.parcelsState === 'ready' && received.length === 0 && sent.length === 0 && freights.length === 0;

  return (
    <div class="scr">
      <h1 class="scr__title">{t('send.parcels.title')}</h1>
      <p class="scr__lede">{t('send.parcels.lede')}</p>

      {state.parcelsState === 'error' && state.parcelsError ? (
        <ErrorNote error={state.parcelsError} onRetry={() => void actions.loadParcels()} />
      ) : null}

      {received.length ? (
        <ParcelGroup title={t('send.relation.received')} items={received} actions={actions} />
      ) : null}
      {sent.length ? (
        <ParcelGroup title={t('send.relation.sent')} items={sent} actions={actions} />
      ) : null}

      {freights.length ? <FreightGroup items={freights} /> : null}

      {empty ? (
        <Card tone="soft">
          <Checklist items={[t('send.parcels.emptySentHere'), t('send.parcels.emptySoDo'), t('send.parcels.emptyNoCode')]} />
        </Card>
      ) : null}

      {state.parcelsState === 'loading' && !state.parcels ? <p class="hint">{t('send.parcels.loading')}</p> : null}

      <div class="scr__foot">
        <Button variant="link" onClick={() => void actions.loadParcels()} busy={state.parcelsState === 'loading'}>
          {t('send.parcels.refresh')}
        </Button>
        <ReadAloud text={() => (empty ? t('send.parcels.aloudEmpty') : t('send.parcels.aloudSome'))} label={t('send.readAloud')} />
      </div>
    </div>
  );
}

function ParcelGroup({ title, items, actions }: { title: string; items: ConsumerParcelView[]; actions: SendActions }) {
  const t = useT();
  return (
    <Card title={title}>
      <div class="rows">
        {items.map((p) => {
          const pres = statusPresentation(p.status, t);
          return (
            <button key={p.parcelId} type="button" class="row" onClick={() => void actions.openParcel(p.parcelId)}>
              <span class="row__ic">
                <Icon name={pres.icon} size={24} />
              </span>
              <span class="row__body">
                <span class="row__t">{p.parcelId}</span>
                <span class="row__s">{parcelRowLine(p, t)}</span>
              </span>
              <span class="row__end">
                <Pill tone={PILL_TONE[pres.tone]} dot>{pres.word}</Pill>
                <Icon name="chevronRight" size={22} />
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/** S32d — the buyer's dedicated-freight orders (too big for the parcel network). Informational rows: a
 *  diverted order stays visible with its status; the carrier/pickup flow is handled off the shelves. */
const FREIGHT_STATUS: Record<string, { wordKey: 'send.parcels.freightAvailable' | 'send.parcels.freightClaimed' | 'send.parcels.freightInTransit' | 'send.status.delivered'; tone: 'ok' | 'info' | 'idle' }> = {
  available: { wordKey: 'send.parcels.freightAvailable', tone: 'idle' },
  claimed: { wordKey: 'send.parcels.freightClaimed', tone: 'info' },
  in_transit: { wordKey: 'send.parcels.freightInTransit', tone: 'info' },
  delivered: { wordKey: 'send.status.delivered', tone: 'ok' },
};

function FreightGroup({ items }: { items: FreightShipmentView[] }) {
  const t = useT();
  return (
    <Card title={t('send.parcels.freightTitle')}>
      <p class="card__note">{t('send.parcels.freightNote')}</p>
      <div class="rows">
        {items.map((fr) => {
          const s = FREIGHT_STATUS[fr.status];
          return (
            <div key={fr.freightId} class="row row--static">
              <span class="row__ic"><Icon name="truck" size={24} /></span>
              <span class="row__body">
                <span class="row__t">{fr.code}</span>
                <span class="row__s">{t('send.parcels.freightRow', { dest: fr.destLabel, kg: fr.weightKg, cls: fr.cargoClass })}</span>
              </span>
              <span class="row__end"><Pill tone={s ? s.tone : 'info'} dot>{s ? t(s.wordKey) : fr.status}</Pill></span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ParcelDetail({ parcel, state, actions }: { parcel: ConsumerParcelView; state: SendState; actions: SendActions }) {
  const t = useT();
  const pres = statusPresentation(parcel.status, t);
  const at = ladderIndex(parcel.status);
  const off = isOffLadder(parcel.status);
  const stepFor = (s: ParcelStatus) => parcel.timeline.find((x) => x.status === s || (s === 'Created' && x.status === 'CREATED'));

  // S23: the receiver's delivered-state actions live on a Delivered parcel that is theirs.
  const canAct = parcel.relation === 'received' && parcel.status === 'Delivered';
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [photo, setPhoto] = useState('');
  // Close the sheet once the dispute has landed (the twin flips to Disputed).
  useEffect(() => {
    if (parcel.status === 'Disputed') setDisputeOpen(false);
  }, [parcel.status]);

  return (
    <div class="scr">
      <div class="scr__back">
        <Button variant="link" chevron={false} onClick={() => actions.closeParcel()}>
          <Icon name="chevronLeft" size={20} /> {t('send.parcels.allParcels')}
        </Button>
      </div>

      <h1 class="scr__title">{parcel.parcelId}</h1>
      <p class="scr__lede">{relationWord(parcel.relation, t)} · {parcel.relation === 'received' ? t('send.parcels.detailFrom', { zone: parcel.originZone }) : t('send.parcels.detailTo', { zone: parcel.destZone })}</p>
      {/* DT — the shipment's stable digital-twin identity, from creation. */}
      {parcel.did ? <p class="hint" style="word-break:break-all">{t('send.parcels.shipmentId', { did: parcel.did })}</p> : null}

      <section class={`now now--${pres.tone}`} aria-live="polite">
        <Icon name={pres.icon} size={34} class="now__ic" />
        <span class="now__body">
          <span class="now__word">{pres.word}</span>
          <span class="now__sub">
            {parcel.status === 'Ready_For_Pickup'
              ? t('send.parcels.readyIn', { zone: parcel.destZone })
              : parcel.status === 'Delivered'
                ? t('send.parcels.handedIn', { zone: parcel.destZone })
                : parcel.relation === 'received'
                  ? t('send.parcels.onWayTo', { zone: parcel.destZone })
                  : t('send.parcels.onWayFrom', { zone: parcel.originZone })}
          </span>
        </span>
      </section>

      {/* The single-parcel twin (which carries the collect token) failed to load — surface it + let them
          retry, instead of silently showing the token-less list row for a parcel that is ready to collect. */}
      {state.openParcelState === 'error' && state.openParcelError ? (
        <ErrorNote error={state.openParcelError} onRetry={() => void actions.openParcel(parcel.parcelId)} />
      ) : null}

      {/* S22: the in-app release token — the receiver shows this QR (or reads the code) at the shop; the
          PUDO scans it. Delivered in the app, never by SMS. On a parcel you SENT it is the same code seen
          from the other side: you are the one who has to get it to the person collecting, over whatever
          you already use to talk to them. Nobody at either shop can do that for you. */}
      {parcel.collectToken ? (
        <>
          {/* The QR is offered only for a vendor order: that is the code the shop's Collect scanner
              resolves. A peer-send code is spoken at the counter and typed into the release screen, so
              showing a QR nobody can scan would send the customer to a dead end. */}
          <CodeCard
            label={parcel.relation === 'sent' ? t('send.parcels.passToReceiver') : t('send.parcels.showToCollect')}
            code={parcel.collectToken.code}
            scanAs={parcel.vendorOrder ? 'collect' : undefined}
            sayLabel={t('send.parcels.hearCode')}
          />
          <p class="hint">{parcel.relation === 'sent' ? t('send.parcels.passCode') : t('send.parcels.showCode')}</p>
        </>
      ) : null}

      {/* S23: a problem was reported on this parcel — the seller and the control tower have been told. */}
      {parcel.relation === 'received' && parcel.status === 'Disputed' ? (
        <Note
          tone="danger"
          icon="warning"
          title={t('send.parcels.problemTitle')}
          detail={parcel.disputeReason ? t('send.parcels.problemYou', { reason: parcel.disputeReason }) : t('send.parcels.problemTold')}
        />
      ) : null}

      {/* S23: once it is delivered, the receiver keeps their own proof of what arrived, and can report a
          problem — a reason + a photo — which routes to the seller (or the sender) and the control tower. */}
      {canAct ? (
        <Card label={t('send.parcels.gotParcel')}>
          <PhotoField id="pod-photo" value={parcel.podPhotoRef ?? ''} label={t('send.parcels.addPodPhoto')} upload={(file) => actions.uploadPhoto('pod', file)} onCapture={(ref) => void actions.submitPod(ref)} disabled={state.podBusy} />
          <div style="margin-top:10px">
            <Button variant="outline" chevron={false} onClick={() => { setReason(''); setPhoto(''); setDisputeOpen(true); }}>
              {t('send.parcels.reportProblem')}
            </Button>
          </div>
        </Card>
      ) : null}

      {parcel.items?.length ? (
        <Card label={t('send.parcels.whatsInside')}>
          <Checklist items={parcel.items.map((it) => t('send.parcels.itemLine', { qty: it.qty, name: it.name }))} />
        </Card>
      ) : null}

      {off ? null : (
        <Card label={t('send.track.journeySoFar')}>
          <ol class="ladder">
            {LADDER.map((s, i) => {
              const p = statusPresentation(s, t);
              const done = i < at;
              const now = i === at;
              const step = stepFor(s);
              return (
                <li key={s} class={`ladder__rung${done ? ' ladder__rung--done' : ''}${now ? ' ladder__rung--now' : ''}`}>
                  <span class="ladder__ic" aria-hidden="true">
                    <Icon name={done ? 'check' : p.icon} size={20} />
                  </span>
                  <span class="ladder__body">
                    <span class="ladder__word">{p.word}</span>
                    {step ? <span class="ladder__time">{stepTime(step.at)}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {parcel.trackingKey ? <p class="hint">{t('send.parcels.shareCode', { key: parcel.trackingKey })}</p> : null}

      <div class="scr__foot">
        <ReadAloud text={() => t('send.parcels.aloudParcel', { id: parcel.parcelId, status: pres.word.toLowerCase() })} label={t('send.readAloud')} />
      </div>

      <Sheet open={disputeOpen} onClose={() => setDisputeOpen(false)} title={t('send.parcels.reportProblem')}>
        {state.disputeError ? <ErrorNote error={state.disputeError} /> : null}
        <div class="field">
          <label class="field__label" for="dispute-reason">{t('send.parcels.disputeWhat')}</label>
          <input
            id="dispute-reason"
            class="input"
            value={reason}
            onInput={(e) => setReason(e.currentTarget.value)}
            placeholder={t('send.parcels.disputeReasonPh')}
          />
        </div>
        <PhotoField id="dispute-photo" value={photo} label={t('send.parcels.disputePhoto')} upload={(file) => actions.uploadPhoto('dispute', file)} onCapture={setPhoto} disabled={state.disputeBusy} />
        <Button chevron={false} disabled={!reason.trim() || !photo} busy={state.disputeBusy} onClick={() => void actions.submitDispute(reason, photo)}>
          {t('send.parcels.disputeSend')}
        </Button>
        <Button variant="link" onClick={() => setDisputeOpen(false)}>{t('common.cancel')}</Button>
      </Sheet>
    </div>
  );
}

/**
 * Resolve the open parcel: prefer the freshly-fetched single-parcel twin (it carries the S22 collect
 * token); fall back to the list row so the detail paints instantly while that fetch is in flight.
 */
function openParcelView(state: SendState): ConsumerParcelView | null {
  if (!state.openParcelId) return null;
  if (state.openParcelDetail?.parcelId === state.openParcelId) return state.openParcelDetail;
  const all = [...(state.parcels?.received ?? []), ...(state.parcels?.sent ?? [])];
  return all.find((p) => p.parcelId === state.openParcelId) ?? null;
}

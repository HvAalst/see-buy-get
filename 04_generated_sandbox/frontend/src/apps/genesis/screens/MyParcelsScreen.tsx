import type { ChatThread } from '../../../shared/conversation/logic';
import { ConversationSheet } from '../../../shared/conversation/Conversations';
import { narrow, type SbgClient } from '../../../lib/sbg';
import { DamageReportCard } from '../../../shared/damage/DamageReportCard';
import { useEffect, useState } from 'preact/hooks';
import { errorSentence, Button, Card, Checklist, CodeCard, ErrorNote, Icon, Note, Pill, PushPrompt, ReadAloud, Sheet } from '../../../shared/ui';
import { formatMoney, useT } from '../../../shared/i18n';
import { PhotoField } from './PhotoField';
import { LADDER, disputeOutcomeWords, isOffLadder, ladderIndex, parcelRowLine, relationWord, sortForPerson, statusPresentation, stepTime } from '../logic';
import { MERCHANT_TAGS, POSITIVE_TAGS, type MerchantTag } from '../../../lib/sbg/personas/consumer';
import type { ConsumerParcelView, FreightShipmentView, ParcelStatus } from '../types';
import type { SendActions, SendState } from '../useSendApp';

/** The day and the hour a hidden code shows again, as somebody would say it: "Fri, 14:05". */
const codeShowsAt = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export interface MyParcelsScreenProps {
  state: SendState;
  actions: SendActions;
  /** The signed-in client: a damage claim report is read, taken and handed on from the parcel it is about. */
  client?: SbgClient | null;
}

const PILL_TONE = { ok: 'ok', info: 'info', danger: 'danger' } as const;

/**
 * The receiver/sender home (S21). Every parcel this person is a party to, matched by their verified
 * phone — the parcels coming TO them first (the ones they act on), then the ones they are sending.
 * Tapping a parcel opens its authenticated twin: the same status ladder the public track shows, but
 * reached by identity, not by pasting a code.
 */
export function MyParcelsScreen({ state, actions, client = null }: MyParcelsScreenProps) {
  const t = useT();
  useEffect(() => {
    if (state.parcelsState === 'idle') void actions.loadParcels();
  }, [state.parcelsState, actions]);

  const open = openParcelView(state);
  if (open) return <ParcelDetail parcel={open} state={state} actions={actions} client={client} />;

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

      {/* THE ASK, on the one screen in this app where somebody is waiting. Send and Track are anonymous and
          have no bell at all; this is the signed-in tab, and what is waited on here — a parcel arriving at a
          shop that then closes at six — is worth being told about rather than found by reopening the app. */}
      <PushPrompt
        api={actions.notifications}
        title={t('send.push.title')}
        reason={t('send.push.reason')}
        turnOn={t('send.push.turnOn')}
        notNow={t('send.push.notNow')}
        storageKey="glos-send-push-asked"
      />

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
const FREIGHT_STATUS: Record<string, { wordKey: 'send.parcels.freightAvailable' | 'send.parcels.freightClaimed' | 'send.parcels.freightInTransit' | 'send.status.delivered' | 'send.parcels.freightCancelled'; tone: 'ok' | 'info' | 'idle' }> = {
  available: { wordKey: 'send.parcels.freightAvailable', tone: 'idle' },
  claimed: { wordKey: 'send.parcels.freightClaimed', tone: 'info' },
  in_transit: { wordKey: 'send.parcels.freightInTransit', tone: 'info' },
  delivered: { wordKey: 'send.status.delivered', tone: 'ok' },
  cancelled: { wordKey: 'send.parcels.freightCancelled', tone: 'idle' },
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

function ParcelDetail({ parcel, state, actions, client }: { parcel: ConsumerParcelView; state: SendState; actions: SendActions; client: SbgClient | null }) {
  const t = useT();
  const pres = statusPresentation(parcel.status, t);
  const at = ladderIndex(parcel.status);
  const off = isOffLadder(parcel.status);
  const stepFor = (s: ParcelStatus) => parcel.timeline.find((x) => x.status === s || (s === 'Created' && x.status === 'CREATED'));

  // S23: the receiver's delivered-state actions live on a Delivered parcel that is theirs.
  const canAct = parcel.relation === 'received' && parcel.status === 'Delivered';
  // Local, uncontrolled-by-the-app text. The name of somebody you trust is not application state, and
  // routing every keystroke through the reducer is how this app has re-rendered a whole screen per letter.
  const [proxyName, setProxyName] = useState('');
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<MerchantTag[]>([]);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [photo, setPhoto] = useState('');
  // CV5 — a word with the shop holding this parcel. The thread is the server's; this only opens it.
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatFailed, setChatFailed] = useState<string | null>(null);
  const canMessageShop = parcel.relation === 'received' && !['Voided', 'Returned'].includes(parcel.status as string) && Boolean(actions.chatApi);
  const messageShop = async () => {
    if (!actions.chatApi) return;
    setChatBusy(true);
    setChatFailed(null);
    const r = await actions.chatApi.openAboutParcel(parcel.parcelId);
    setChatBusy(false);
    // A failure with no answer (offline) is said in the shared sentence; a refusal keeps the server's own words.
    if (r.error) return setChatFailed(r.error.status === 0 ? errorSentence(r.error) : r.error.detail || r.error.title || t('common.chat.loadFailed'));
    const opened = narrow<ChatThread>(r.data);
    if (opened) setThread(opened);
  };
  // Close the sheet once the report has landed: the parcel is in dispute, or — where nobody of ours decides
  // anything — it is delivered as it was, with a damage claim report on it.
  useEffect(() => {
    if (parcel.status === 'Disputed' || parcel.damageReport) setDisputeOpen(false);
  }, [parcel.status, parcel.damageReport]);

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
            {parcel.status === 'Unclaimed'
              ? t('send.parcels.unclaimedIn', { zone: parcel.destZone })
              : parcel.status === 'Ready_For_Pickup'
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

      {/* The final notice. Four things a person can do, and each of them DOES something — a reason field
          that changes nothing is a survey, and nobody fills in a survey about a parcel.

          It sits ABOVE the collection code deliberately: the terms have changed, and finding that out
          after being shown the code is finding it out at the counter instead. It never replaces the code
          — the parcel is still theirs and still there, which is the whole point of the status. */}
      {parcel.relation === 'received' && parcel.status === 'Unclaimed' ? (
        <Card title={t('send.notice.title')}>
          <p class="card__note">
            {parcel.holdingOwed
              ? t('send.notice.ledeCost', { zone: parcel.destZone, amount: parcel.holdingOwed.toFixed(2) })
              : t('send.notice.lede', { zone: parcel.destZone })}
          </p>

          {state.noticeError ? <ErrorNote error={state.noticeError} /> : null}

          {/* Already answered: their own words back, and no second interrogation. */}
          {parcel.receiverResponse ? (
            <Note tone="info" icon="check" title={t('send.notice.answered')} detail={t(`send.notice.choice.${parcel.receiverResponse.choice}` as 'send.notice.choice.coming')} />
          ) : null}

          {!parcel.relinquishedAt ? (
            <div class="stack">
              <Button variant="primary" busy={state.noticeBusy === 'coming'} onClick={() => void actions.respondToNotice('coming')}>
                {parcel.extensionsUsed ? t('send.notice.comingAgain') : t('send.notice.coming')}
              </Button>
              {/* Naming somebody is SAFER than the workaround it replaces — reading your own code down
                  the phone, which nobody can see and nobody can afterwards account for. */}
              {!parcel.collectProxy ? (
                <>
                  <label class="field">
                    <span class="field__label">{t('send.notice.proxyLabel')}</span>
                    <input class="field__in" value={proxyName} onInput={(e) => setProxyName((e.target as HTMLInputElement).value)} placeholder={t('send.notice.proxyPlaceholder')} />
                  </label>
                  <Button variant="outline" busy={state.noticeBusy === 'nominate'} disabled={!proxyName.trim()} onClick={() => void actions.nominateCollector(proxyName)}>
                    {t('send.notice.proxy')}
                  </Button>
                </>
              ) : null}
              {/* Giving it up and saying it was never yours are DIFFERENT ANSWERS, and separated here on
                  purpose: "I never ordered this" is the one answer after which disposing of it is the
                  last thing anybody may do. */}
              <Button variant="link" busy={state.noticeBusy === 'relinquish'} onClick={() => void actions.respondToNotice('relinquish')}>
                {t('send.notice.relinquish')}
              </Button>
              <Button variant="link" busy={state.noticeBusy === 'not-mine'} onClick={() => void actions.respondToNotice('not-mine')}>
                {t('send.notice.notMine')}
              </Button>
            </div>
          ) : (
            <Note tone="warn" icon="info" title={t('send.notice.gaveUpTitle')} detail={t('send.notice.gaveUpDetail')} />
          )}
          <p class="card__note">{t('send.notice.stillYours')}</p>
        </Card>
      ) : null}

      {/* CV5 — the shop, in person. Below the code and the notice: the code is what collects, this is what you say
          when you cannot come yet, or do not know when they are open. */}
      {canMessageShop ? (
        <Card title={t('send.parcels.messageShopTitle')}>
          <p class="card__note">{t('send.parcels.messageShopSub')}</p>
          {chatFailed ? <p class="hint" role="alert">{chatFailed}</p> : null}
          <Button variant="outline" chevron={false} busy={chatBusy} onClick={() => void messageShop()}>
            {t('send.parcels.messageShop')}
          </Button>
        </Card>
      ) : null}
      <ConversationSheet api={actions.chatApi} thread={thread} onClose={() => setThread(null)} />

      {/* The code for the person they named, beside their own rather than inside the notice.

          It used to live in the notice card, which renders only while the parcel is unclaimed — and
          naming somebody now ends that status, so the code disappeared at the exact moment its whole
          purpose was to be passed on. It belongs next to the receiver's own code because that is what it
          is: a second key to the same parcel, and the person holding it is the one who has to hand it
          over. The shop learns neither. */}
      {parcel.relation === 'received' && (state.proxyCode ?? parcel.collectProxy)?.code ? (
        <>
          <CodeCard
            label={t('send.notice.proxyCode', { name: (state.proxyCode ?? parcel.collectProxy)!.name })}
            code={(state.proxyCode ?? parcel.collectProxy)!.code!}
            sayLabel={t('send.parcels.hearCode')}
          />
          <p class="hint">{t('send.notice.proxyHint', { name: (state.proxyCode ?? parcel.collectProxy)!.name })}</p>
        </>
      ) : null}

      {/* THE CODE IS THERE AND IS NOT SHOWN — the account was moved to a new number without its PIN, and for the day
          in which that can be undone nobody on it reads what a shop will ask for. Said with the hour it shows again,
          in the place the code would be: an empty space would look like a parcel with no way to collect it. */}
      {parcel.codeHeldUntil ? (
        <Note
          tone="info"
          icon="lock"
          title={t('send.parcels.codeHeld.title', { when: codeShowsAt(parcel.codeHeldUntil) })}
          detail={t(parcel.collectProxy ? 'send.parcels.codeHeld.detailNamed' : 'send.parcels.codeHeld.detail', { name: parcel.collectProxy?.name ?? '' })}
        />
      ) : null}

      {/* It came by the number they moved off. The sender does not know there is a new one, and only they can say. */}
      {parcel.relation === 'received' && parcel.sentToOldNumber ? <Note tone="info" icon="info" title={t('send.parcels.oldNumber.title')} detail={t('send.parcels.oldNumber.detail')} /> : null}

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

      {/* HOW IT ENDED — for the receiver who reported it and for the sender who paid. The decision, the reason as
          it was written, and where an award went. Until this the answer was recorded and shown to neither. */}
      {parcel.disputeOutcome
        ? (() => {
            const said = disputeOutcomeWords(parcel.disputeOutcome, parcel.relation, formatMoney, t);
            return <Note tone={said.tone} icon={said.tone === 'ok' ? 'check' : 'info'} title={said.title} detail={said.lines.join(' ')} />;
          })()
        : null}

      {/* THE DAMAGE CLAIM REPORT — the receiver's: to read, to keep, and to hand to whoever they choose. */}
      {parcel.damageReport ? <DamageReportCard client={client} parcelId={parcel.parcelId} number={parcel.damageReport.number} /> : null}

      {/* S23: once it is delivered, the receiver keeps their own proof of what arrived, and can report a
          problem — a reason + a photo. One report to a parcel: once it is made, the button is gone. */}
      {canAct ? (
        <Card label={t('send.parcels.gotParcel')}>
          <PhotoField id="pod-photo" value={parcel.podPhotoRef ?? ''} label={t('send.parcels.addPodPhoto')} upload={(file) => actions.uploadPhoto('pod', file)} onCapture={(ref) => void actions.submitPod(ref)} disabled={state.podBusy} />
          {parcel.damageReport ? null : (
            <div style="margin-top:10px">
              <Button variant="outline" chevron={false} onClick={() => { setReason(''); setPhoto(''); setDisputeOpen(true); }}>
                {t('send.parcels.reportProblem')}
              </Button>
            </div>
          )}
        </Card>
      ) : null}

{/* Rating the STORE, which is a different question from rating the delivery.
          
          Offered only on a vendor order and only after it arrived — an opinion about a parcel that has
          not come is an opinion about waiting, and the measured half of a store's scorecard reports that
          better without asking anybody. Once per parcel: this is verified because we carried the thing
          being reviewed, which is worth more than volume and is lost the moment it can be stacked.

          Tags rather than a comment box. Prose would mean moderation, defamation exposure and personal
          details in public strings across five locales; a tag is a catalogue key with nothing in it to
          moderate. Positives come FIRST, because a list that opens with accusations invites one. */}
      {canAct && parcel.vendorOrder ? (
        <Card title={t('send.rate.title')}>
          {state.ratedParcels.includes(parcel.parcelId) ? (
            <Note tone="ok" icon="check" title={t('send.rate.thanksTitle')} detail={t('send.rate.thanksDetail')} />
          ) : (
            <>
              <p class="card__note">{t('send.rate.lede')}</p>
              <div class="stars" role="group" aria-label={t('send.rate.starsAria')}>
                {([1, 2, 3, 4, 5] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    class={`starbtn${stars >= n ? ' starbtn--on' : ''}`}
                    aria-pressed={stars >= n}
                    aria-label={t('send.rate.starAria', { n })}
                    onClick={() => setStars(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div class="chips" role="group" aria-label={t('send.rate.tagsAria')}>
                {MERCHANT_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    class={`chip${tags.includes(tag) ? ' chip--on' : ''}${POSITIVE_TAGS.has(tag) ? '' : ' chip--neg'}`}
                    aria-pressed={tags.includes(tag)}
                    onClick={() => setTags((cur) => (cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag]))}
                  >
                    {t(`send.rate.tag.${tag}` as 'send.rate.tag.WELL_PACKED')}
                  </button>
                ))}
              </div>
              <div style="margin-top:12px">
                <Button chevron={false} disabled={!stars} busy={state.rateBusy} onClick={() => void actions.rateStore(stars, tags)}>
                  {t('send.rate.send')}
                </Button>
              </div>
              {/* Said plainly: this is published, and the store cannot take it down. Somebody deciding
                  whether to bother should know it counts for something. */}
              <p class="card__note">{t('send.rate.publicNote')}</p>
            </>
          )}
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

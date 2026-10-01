import { Button, Card, ErrorNote, Note, PhotoField, Pill, ReadAloud, RefusalNote, Sheet } from '../../../shared/ui';
import { formatDate, useT, type MessageKey } from '../../../shared/i18n';
import type { SbgError } from '../../../lib/sbg';
import type { DuplicateField } from '../../../shared/duplicate';
import { driverAction, driverMissing, isHeavySelection, paperLine, paperLineClass, papersToShow, shortDid, statusTone, toggleClass } from '../logic';
import { VEHICLE_CLASSES, type DriverRow } from '../types';
import type { FleetActions, FleetOfferRow, FleetState, RemovalReason } from '../useFleetApp';
import { useState } from 'preact/hooks';
import { ConversationList, ConversationSheet } from '../../../shared/conversation/Conversations';
import type { ChatThread } from '../../../shared/conversation/logic';

export interface DriversScreenProps {
  state: FleetState;
  actions: FleetActions;
}

/**
 * The drivers pool: onboard (light = active now, heavy = papers first) and follow each
 * driver's stage. The KYC DECISION is SeeBuyGet ops' — this screen submits papers and then
 * says "SeeBuyGet is checking", it never offers an approve button that would 403.
 */
/** Which of the driver's details is already registered, as the heading says it. */
const DUP_TITLE: Partial<Record<DuplicateField, MessageKey>> = {
  phone: 'fleet.drivers.dupTitle.phone',
  nationalId: 'fleet.drivers.dupTitle.nationalId',
  licence: 'fleet.drivers.dupTitle.licence',
};

export function DriversScreen({ state, actions }: DriversScreenProps) {
  const t = useT();
  const f = state.dForm;
  const missing = driverMissing(f, t);
  const heavy = isHeavySelection(f.classes);
  // CV3 — the thread a driver shared, open read-only.
  const [thread, setThread] = useState<ChatThread | null>(null);
  // FP4 — whose renewed licence is being recorded.
  const [licenceFor, setLicenceFor] = useState<DriverRow | null>(null);
  // Who is being taken off the fleet.
  const [removing, setRemoving] = useState<DriverRow | null>(null);
  // The place being offered: the number typed, and what the server said about it.
  const [offerPhone, setOfferPhone] = useState('');
  const [offerRefused, setOfferRefused] = useState<SbgError | null>(null);
  const offer = async (phone: string) => {
    setOfferPhone(phone);
    const refused = await actions.offerPlace(phone);
    setOfferRefused(refused);
    if (!refused) setOfferPhone('');
  };

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      {/* CV3 — only what a driver CHOSE to share, and only while they drive for this fleet. Read, never write. */}
      <Card title={t('fleet.chat.title')}>
        <ConversationList api={actions.chatApi} source="shared" onOpen={setThread} emptyText={t('fleet.chat.empty')} />
      </Card>
      <ConversationSheet api={actions.chatApi} thread={thread} onClose={() => setThread(null)} readOnly />

      <Card title={t('fleet.drivers.onboardTitle')}>
        <p class="card__note">{t('fleet.drivers.onboardNote')}</p>
        <div class="grid2">
          <div class="field">
            <label class="field__label" for="d-display">
              {t('fleet.drivers.displayName')}
            </label>
            <input id="d-display" class="input" value={f.displayName} onInput={(e) => actions.setDForm({ displayName: e.currentTarget.value })} placeholder={t('fleet.drivers.displayNamePh')} />
          </div>
          <div class="field">
            <label class="field__label" for="d-full">
              {t('fleet.drivers.fullName')}
            </label>
            <input id="d-full" class="input" value={f.fullName} onInput={(e) => actions.setDForm({ fullName: e.currentTarget.value })} />
          </div>
        </div>
        <div class="grid2" style="margin-top:12px">
          <div class="field">
            <label class="field__label" for="d-id">
              {t('fleet.drivers.nationalId')}
            </label>
            <input id="d-id" class="input input--mono" value={f.nationalId} onInput={(e) => actions.setDForm({ nationalId: e.currentTarget.value })} spellcheck={false} />
          </div>
          <div class="field">
            <label class="field__label" for="d-mobile">
              {t('fleet.drivers.mobile')}
            </label>
            <input id="d-mobile" class="input" type="tel" inputMode="tel" value={f.mobile} onInput={(e) => actions.setDForm({ mobile: e.currentTarget.value })} placeholder="07…" />
          </div>
        </div>
        <div class="field" style="margin-top:12px">
          <span class="field__label">{t('fleet.drivers.clearedToDrive')}</span>
          <div class="chips">
            {VEHICLE_CLASSES.map((c) => {
              const on = f.classes.includes(c);
              return (
                <button key={c} type="button" class={`chip chip--tap${on ? ' chip--on' : ''}`} aria-pressed={on} onClick={() => actions.setDForm({ classes: toggleClass(f.classes, c) })}>
                  {c}
                </button>
              );
            })}
          </div>
        </div>
        {heavy ? (
          <>
            <div class="grid2" style="margin-top:12px">
              <div class="field">
                <label class="field__label" for="d-lic">
                  {t('fleet.drivers.licenceNumber')}
                </label>
                <input id="d-lic" class="input input--mono" value={f.licenceNumber} onInput={(e) => actions.setDForm({ licenceNumber: e.currentTarget.value })} spellcheck={false} />
              </div>
              <div class="field">
                <label class="field__label" for="d-exp">
                  {t('fleet.drivers.licenceExpires')}
                </label>
                <input id="d-exp" class="input" type="date" value={f.licenceExpiresAt} onInput={(e) => actions.setDForm({ licenceExpiresAt: e.currentTarget.value })} />
              </div>
            </div>
            <label class="checkline" style="margin-top:12px">
              <input type="checkbox" checked={f.criminalRecordClear} onChange={(e) => actions.setDForm({ criminalRecordClear: e.currentTarget.checked })} />
              <span>{t('fleet.drivers.criminalClear')}</span>
            </label>
          </>
        ) : (
          <p class="hint" style="margin-top:12px">
            {t('fleet.drivers.lightRegistry')}
          </p>
        )}
        <div style="margin-top:14px">
          <Button chevron={false} onClick={() => void actions.submitDriver()} disabled={Boolean(missing)} busy={state.busy === 'driver'}>
            {t('fleet.drivers.onboardCta')}
          </Button>
          {missing ? <p class="hint" style="margin-top:8px">{missing}</p> : null}
        </div>
        {/* Already registered on the network: never added a second time. The office offers them a place, and they
            say yes from their own app — one tap here, with the number already typed above. */}
        {state.driverDuplicate ? (
          <div style="margin-top:12px">
            <Note
              tone="warn"
              icon="lock"
              title={t(DUP_TITLE[state.driverDuplicate.field] ?? 'fleet.drivers.dupTitle.phone')}
              detail={[t('fleet.drivers.dupOffer'), state.driverDuplicate.field === 'phone' ? '' : t('fleet.drivers.dupTypo')].filter(Boolean).join(' ')}
            />
            {f.mobile.trim() ? (
              <Button variant="outline" chevron={false} busy={state.busy === 'offer'} onClick={() => void offer(f.mobile)}>
                {t('fleet.drivers.dupOfferCta', { phone: f.mobile.trim() })}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>

      {/* THE ONLY WAY SOMEBODY ALREADY ON THE NETWORK JOINS THIS FLEET.

          It was the fleet's code, typed by whoever had it. The office names the driver now — by the number they
          sign in with — and the driver answers from their own app. Until they say yes the office sees the number
          it typed and nothing else: not a name, not where they drive today. */}
      <Card title={t('fleet.offers.title')}>
        <p class="card__note">{t('fleet.offers.note')}</p>
        <div class="field">
          <label class="field__label" for="offer-phone">
            {t('fleet.offers.phone')}
          </label>
          <input
            id="offer-phone"
            class="input"
            type="tel"
            inputMode="tel"
            value={offerPhone}
            onInput={(e) => {
              setOfferPhone(e.currentTarget.value);
              setOfferRefused(null);
            }}
            placeholder="07…"
          />
        </div>
        {offerRefused ? <RefusalNote error={offerRefused} /> : null}
        <div style="margin-top:12px">
          <Button chevron={false} disabled={!offerPhone.trim()} busy={state.busy === 'offer'} onClick={() => void offer(offerPhone)}>
            {t('fleet.offers.cta')}
          </Button>
        </div>
        {state.fleetOffers.length ? (
          <div class="rows" role="list" style="margin-top:14px">
            {state.fleetOffers.map((o) => (
              <div key={o.offerId} class="row row--static" role="listitem">
                <span class="row__body">
                  <span class="row__t">{o.driverName ?? t('fleet.offers.ending', { ending: o.phoneEnding })}</span>
                  <span class="row__s">{offerLine(o, t)}</span>
                </span>
                <span class="row__end">
                  <Pill tone={o.status === 'accepted' ? 'ok' : o.status === 'open' ? 'warn' : 'idle'} dot>
                    {t(`fleet.offers.pill.${o.status}` as MessageKey)}
                  </Pill>
                  {o.status === 'open' ? (
                    <Button variant="link" full={false} busy={state.busy === 'offer:' + o.offerId} onClick={() => void actions.withdrawOffer(o.offerId)}>
                      {t('fleet.offers.withdraw')}
                    </Button>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <Card title={t('fleet.drivers.poolTitle', { count: state.drivers.length })}>
        {state.drivers.length === 0 ? (
          <p class="hint">{t('fleet.drivers.empty')}</p>
        ) : (
          <div class="rows" role="list">
            {state.drivers.map((d) => {
              const action = driverAction(d);
              return (
                <div key={d.did} class="row row--static" role="listitem">
                  <span class="row__body">
                    <span class="row__t">{d.displayName}</span>
                    <span class="row__s">
                      {`${d.badgeId ?? shortDid(d.did)} · ${d.registry} · ${(d.licence?.classes ?? []).join(', ') || '—'}`}
                    </span>
                    {/* The work this driver's RATE is turning away — said here because this is where the
                        lever is. Only once enough loads have been refused to mean something, and never as
                        a benchmark against what anybody else charges. */}
                    {/* FP4 — the licence, when it is not simply in date: lapsed (no shift can start), running out, or undated. */}
                    {papersToShow(d.papers).map((p) => (
                      <span key={p.kind} class={paperLineClass(p.state)}>
                        {paperLine(p, t)}
                      </span>
                    ))}
                    {d.rateReach?.rateLooksHigh ? (
                      <span class="row__s">
                        {d.rateReach.ratePerKm
                          ? t('fleet.drivers.rateHigh', { count: d.rateReach.overBudget, rate: String(d.rateReach.ratePerKm) })
                          : t('fleet.drivers.rateHighNoRate', { count: d.rateReach.overBudget })}
                      </span>
                    ) : null}
                  </span>
                  <span class="row__end">
                    <Pill tone={d.offRoad?.length ? 'danger' : statusTone(d.status)} dot>
                      {d.offRoad?.length ? t('fleet.papers.offRoad') : d.status === 'KYC_PENDING' ? t('fleet.drivers.beingChecked') : d.status.replace(/_/g, ' ').toLowerCase()}
                    </Pill>
                    <Button variant="link" full={false} onClick={() => setLicenceFor(d)}>
                      {t('fleet.drivers.licenceBtn')}
                    </Button>
                    <Button variant="link" full={false} onClick={() => setRemoving(d)}>
                      {t('fleet.remove.btn')}
                    </Button>
                    {action === 'submit-kyc' ? (
                      <Button variant="link" full={false} onClick={() => actions.setKyc({ for: d.did, idCopyRef: '', licenceCopyRef: '', photoRef: '' })}>
                        {t('fleet.drivers.sendPapers')}
                      </Button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* THE PAPERS THEMSELVES.

          Before this the "send papers" button posted the literal strings 'id.jpg' and 'licence.jpg' —
          the contract asked for two document references and was satisfied with two filenames. So an SBG
          admin approving a driver was approving nothing, and the national id, licence number and expiry
          a manager types were unverifiable claims made by the party who benefits from them being wrong.

          Both documents are REQUIRED, because without them the approval means nothing. The face is not:
          it is the driver's badge picture, and a cracked camera in a yard at dusk must not be the reason
          a real driver cannot start work. */}
      <Sheet open={Boolean(state.kyc.for)} onClose={() => actions.setKyc({ for: null })} title={t('fleet.kyc.title')}>
        <p class="card__note">{t('fleet.kyc.lede')}</p>
        <PhotoField
          id="kyc-id"
          value={state.kyc.idCopyRef}
          label={t('fleet.kyc.idLabel')}
          upload={(file) => actions.uploadPhoto('kyc_id', file)}
          onCapture={(ref) => actions.setKyc({ idCopyRef: ref })}
        />
        <PhotoField
          id="kyc-licence"
          value={state.kyc.licenceCopyRef}
          label={t('fleet.kyc.licenceLabel')}
          upload={(file) => actions.uploadPhoto('kyc_licence', file)}
          onCapture={(ref) => actions.setKyc({ licenceCopyRef: ref })}
        />
        {/* Said out loud so a manager knows it is safe to skip, and knows what it is FOR — a photo asked
            for with no stated purpose is a photo people refuse. */}
        <p class="card__note">{t('fleet.kyc.faceNote')}</p>
        <PhotoField
          id="kyc-face"
          value={state.kyc.photoRef}
          label={t('fleet.kyc.faceLabel')}
          upload={(file) => actions.uploadPhoto('avatar', file)}
          onCapture={(ref) => actions.setKyc({ photoRef: ref })}
        />
        <Note tone="info" icon="info" title={t('fleet.kyc.checkTitle')} detail={t('fleet.kyc.checkDetail')} />
        <Button
          chevron={false}
          disabled={!state.kyc.idCopyRef || !state.kyc.licenceCopyRef}
          busy={state.busy === `kyc:${state.kyc.for}`}
          onClick={() => void actions.submitKyc(state.kyc.for!, state.kyc.idCopyRef, state.kyc.licenceCopyRef, state.kyc.photoRef)}
        >
          {t('fleet.kyc.send')}
        </Button>
        <Button variant="link" onClick={() => actions.setKyc({ for: null })}>
          {t('fleet.kyc.later')}
        </Button>
      </Sheet>

      <LicenceSheet driver={licenceFor} onClose={() => setLicenceFor(null)} state={state} actions={actions} />
      <RemoveSheet driver={removing} onClose={() => setRemoving(null)} state={state} actions={actions} />

      <div class="scr__foot">
        <ReadAloud
          text={() => {
            const pending = state.drivers.filter((d) => d.status === 'KYC_PENDING').length;
            return t('fleet.drivers.aloudPool', { count: state.drivers.length }) + (pending ? t('fleet.drivers.aloudPending', { count: pending }) : '');
          }}
          label={t('fleet.readAloud')}
        />
      </div>
    </div>
  );
}

const OFFER_DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

/** What became of an offer, as a sentence — the status pill says the word, this says the rest. */
function offerLine(o: FleetOfferRow, t: ReturnType<typeof useT>): string {
  if (o.status === 'open') return t('fleet.offers.line.open', { day: formatDate(o.expiresAt, OFFER_DAY) });
  if (o.status === 'accepted') return t('fleet.offers.line.accepted', { ending: o.phoneEnding });
  if (o.status === 'declined') return t('fleet.offers.line.declined');
  if (o.status === 'withdrawn') return t('fleet.offers.line.withdrawn');
  return t('fleet.offers.line.lapsed', { day: formatDate(o.expiresAt, OFFER_DAY) });
}

const REMOVAL_REASONS: RemovalReason[] = ['left', 'ended', 'other'];

/**
 * TAKE A DRIVER OFF THE FLEET — the office's own decision about its own roster.
 *
 * Until this existed only network staff could suspend a driver, so a fleet could not get somebody off its trucks
 * and its name without asking us. A reason is always given, because the driver is shown it; and what it does is
 * said before it is done. A load in their hands or a run they are on is refused by name — the server's sentence
 * says what has to happen first.
 */
function RemoveSheet({ driver, onClose, state, actions }: { driver: DriverRow | null; onClose: () => void; state: FleetState; actions: FleetActions }) {
  const t = useT();
  const [reason, setReason] = useState<RemovalReason | null>(null);
  const [note, setNote] = useState('');
  const [refused, setRefused] = useState<SbgError | null>(null);
  const close = () => {
    setReason(null);
    setNote('');
    setRefused(null);
    onClose();
  };
  const name = driver?.displayName ?? '';
  return (
    <Sheet open={Boolean(driver)} onClose={close} title={driver ? t('fleet.remove.title', { name }) : ''}>
      <p class="t-body">{t('fleet.remove.body')}</p>
      {refused ? <RefusalNote error={refused} /> : null}
      <div class="field">
        <span class="field__label">{t('fleet.remove.why')}</span>
        <div class="rows" role="list">
          {REMOVAL_REASONS.map((r) => (
            <button key={r} type="button" class={`row${reason === r ? ' row--on' : ''}`} role="listitem" aria-pressed={reason === r} onClick={() => setReason(r)}>
              <span class="row__body">
                <span class="row__t">{t(`fleet.remove.reason.${r}` as MessageKey)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      {reason === 'other' ? (
        <div class="field">
          <label class="field__label" for="remove-note">
            {t('fleet.remove.note')}
          </label>
          <textarea id="remove-note" class="input" rows={3} maxLength={300} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
        </div>
      ) : null}
      <Button
        chevron={false}
        danger
        disabled={!reason || (reason === 'other' && !note.trim())}
        busy={driver ? state.busy === 'remove:' + driver.did : false}
        onClick={async () => {
          if (!driver || !reason) return;
          const failed = await actions.removeDriver(driver.did, name, reason, reason === 'other' ? note : '');
          setRefused(failed);
          if (!failed) close();
        }}
      >
        {t('fleet.remove.cta', { name })}
      </Button>
      <Button variant="link" onClick={close}>
        {t('common.cancel')}
      </Button>
    </Sheet>
  );
}

/**
 * FP4 — the renewed licence, recorded by the fleet office. The new date is the whole of the renewal: the day it
 * is saved the driver can start a shift again, and nothing else has to be cleared. The driver's own word is
 * deliberately not enough — the office records what it has seen.
 */
function LicenceSheet({ driver, onClose, state, actions }: { driver: DriverRow | null; onClose: () => void; state: FleetState; actions: FleetActions }) {
  const t = useT();
  const [number, setNumber] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState('');
  const current = driver?.licence?.number && driver.licence.number !== 'n/a' ? driver.licence.number : '';
  const close = () => {
    setNumber(null);
    setExpiresAt('');
    onClose();
  };
  return (
    <Sheet open={Boolean(driver)} onClose={close} title={driver ? t('fleet.drivers.licenceSheetTitle', { name: driver.displayName }) : ''}>
      <p class="t-body">{t('fleet.drivers.licenceBody')}</p>
      {driver?.offRoad?.length ? <Note tone="danger" icon="clock" title={t('fleet.papers.offRoad')} detail={driver.offRoad.join(' · ')} /> : null}
      <div class="grid2">
        <div class="field">
          <label class="field__label" for="l-num">
            {t('fleet.drivers.licenceNumber')}
          </label>
          <input id="l-num" class="input input--mono" value={number ?? current} onInput={(e) => setNumber(e.currentTarget.value)} spellcheck={false} />
        </div>
        <div class="field">
          <label class="field__label" for="l-exp">
            {t('fleet.drivers.licenceNewExpires')}
          </label>
          <input id="l-exp" class="input" type="date" value={expiresAt} onInput={(e) => setExpiresAt(e.currentTarget.value)} />
        </div>
      </div>
      <Button
        chevron={false}
        disabled={!expiresAt}
        busy={driver ? state.busy === 'licence:' + driver.did : false}
        onClick={() => {
          if (!driver || !expiresAt) return;
          const n = (number ?? current).trim();
          const body = { expiresAt, ...(n && n !== current ? { number: n } : {}) };
          close();
          void actions.renewLicence(driver.did, body);
        }}
      >
        {t('fleet.drivers.saveLicence')}
      </Button>
      <Button variant="link" onClick={close}>
        {t('common.cancel')}
      </Button>
    </Sheet>
  );
}

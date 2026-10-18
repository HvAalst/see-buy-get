import { useEffect, useState } from 'preact/hooks';
import { DocumentButton, Button, Card, CheckGate, Checklist, ErrorNote, GlanceNumber, Icon, Note, OpenInMaps, PhotoField, Pill, ReadAloud, Sheet } from '../../../shared/ui';
import { InstructionsBlock } from '../../../shared/InstructionsBlock';
import { hasInstructions } from '../../../shared/instructions';
import { useT } from '../../../shared/i18n';
import { canLoadBag, capacitySubLine, cash, claimControl, isFull, loadsSummary, usedPercent } from '../logic';
import { vehicleWord } from '../vehicle-words';
import { RunSection } from './RunSection';
import type { Claimable } from '../types';
import type { DriverActions, DriverState } from '../useDriverApp';

export interface LoadsScreenProps {
  state: DriverState;
  actions: DriverActions;
}

export function LoadsScreen({ state, actions }: LoadsScreenProps) {
  const t = useT();
  const [pick, setPick] = useState<Claimable | null>(null);
  const [gate, setGate] = useState<Claimable | null>(null); // S33 — the freight in the load/unload safety gate
  const [tempFor, setTempFor] = useState<Claimable | null>(null); // S33b — the freight whose temperature we're logging
  const v = state.vehicle;
  const hasBadge = canLoadBag(state.driver?.badgeId);

  return (
    <div class="scr">
      <h1 class="scr__title">{t('driver.nav.loads')}</h1>

      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      {/* F3 — the runs the fleet rostered this driver onto. Here rather than on the home screen because a
          booked consignment on a scheduled run IS a load, and this is the tab called My loads. Renders
          nothing at all for a courier who is on no line, which is most of them. */}
      <RunSection state={state} actions={actions} />

      {v ? (
        <GlanceNumber
          label={t('driver.home.spaceLabel', { vehicle: vehicleWord(v.vehicleClass, t) })}
          value={state.remaining}
          unit="kg"
          percent={usedPercent(v.capacityKg, state.remaining)}
          alert={isFull(state.remaining)}
          sub={capacitySubLine(state.remaining, v.capacityKg, state.claims.length, t, undefined, vehicleWord(v.vehicleClass, t))}
        />
      ) : null}

      {!hasBadge && state.claims.length > 0 ? (
        <Note
          tone="warn"
          icon="badge"
          title={t('driver.loads.noBadgeTitle')}
          detail={t('driver.loads.noBadgeDetail')}
        />
      ) : null}

      {state.claims.length === 0 ? (
        <Card title={t('driver.loads.emptyTitle')} tone="soft">
          <Checklist items={[t('driver.loads.empty1'), t('driver.loads.empty2'), t('driver.loads.empty3')]} />
        </Card>
      ) : (
        <ul class="rows">
          {state.claims.map((c) => {
            const control = claimControl(c);
            const busy = state.busy === `load:${c.ref}`;
            const body = (
              <>
                <span class="row__ic">
                  <Icon name={c.kind === 'tote' ? 'box' : 'truck'} size={24} />
                </span>
                <span class="row__body">
                  <span class="load__ref">{c.code ?? c.ref}</span>
                  <span class="load__meta">{t('driver.loads.meta', { pickup: c.pickupLabel, dest: c.destLabel, kg: c.weightKg })}</span>
                  {/* S34 — the locked earning rides on the claimed freight, so a driver always sees what this job pays. */}
                  {c.lockedPrice != null ? <span class="load__earn">{t('driver.loads.youEarn', { amount: cash(c.lockedPrice, state.session.currency) })}</span> : null}
                  {/* FP5 — not their choice: said plainly, with whose it was. */}
                  {c.assignedBy ? <span class="load__meta">{t('driver.loads.assignedBy', { name: c.assignedBy.name ?? t('driver.loads.theOffice') })}</span> : null}
                  {/* FP7 — what the sender wrote for the door, on the card so it is read before the walk to the gate. */}
                  {hasInstructions(c.instructions) ? <InstructionsBlock view={c.instructions} compact /> : null}
                  {/* No papers, no loading: said on the card, before the drive to the gate. */}
                  {c.invoiceMissing ? <span class="load__warn">{t('driver.loads.invoiceMissingShort')}</span> : null}
                </span>
              </>
            );

            if (control === 'load') {
              return (
                <li key={c.ref}>
                  <button
                    type="button"
                    class="row"
                    onClick={() => setPick(c)}
                    disabled={!hasBadge || busy}
                    aria-label={t('driver.loads.loadAria', { ref: c.code ?? c.ref })}
                  >
                    {body}
                    <span class="row__end">
                      <Pill tone="info">{t('driver.loads.loadOn')}</Pill>
                      <Icon name="chevronRight" size={22} />
                    </span>
                  </button>
                  {c.pickupLocation ? (
                    <div class="load__nav">
                      <OpenInMaps point={c.pickupLocation} label={t('driver.navigateTo', { label: c.pickupLabel })} />
                    </div>
                  ) : null}
                </li>
              );
            }

            // S32b/S33 — a claimed dedicated-freight job: a tap opens the safety gate (load-safety checklist +
            // securement photo at pickup; the unload checklist at delivery), which then advances the freight.
            if (control === 'pickup' || control === 'deliver') {
              const isPickup = control === 'pickup';
              const freightBusy = state.busy === `freight:${c.ref}`;
              return (
                <li key={c.ref}>
                  <button
                    type="button"
                    class="row"
                    onClick={() => setGate(c)}
                    disabled={freightBusy}
                    aria-label={isPickup ? t('driver.loads.pickupAria', { ref: c.code ?? c.ref }) : t('driver.loads.deliverAria', { ref: c.code ?? c.ref })}
                  >
                    {body}
                    <span class="row__end">
                      <Pill tone={isPickup ? 'info' : 'ok'}>{isPickup ? t('driver.loads.pickup') : t('driver.loads.deliver')}</Pill>
                      <Icon name="chevronRight" size={22} />
                    </span>
                  </button>
                  {/* G3 — before pickup, offer turn-by-turn to the pickup point. */}
                  {isPickup && c.pickupLocation ? (
                    <div class="load__nav">
                      <OpenInMaps point={c.pickupLocation} label={t('driver.navigateTo', { label: c.pickupLabel })} />
                    </div>
                  ) : null}
                  {/* S33b — an in-transit cold-chain load: show the safe band + last reading + a log control. */}
                  {control === 'deliver' && c.tempBand ? <TempStrip claim={c} onLog={() => setTempFor(c)} /> : null}
                  {/* FP2 — the consignment note travels with the load; the driver can show it at any gate. */}
                  <div class="load__nav">
                    <DocumentButton label={t('common.cmr.open')} title={t('common.cmr.title')} fetch={() => actions.freightNote(c.ref)} />
                  </div>
                </li>
              );
            }

            return (
              <li key={c.ref}>
                <div class="row row--static">
                  {body}
                  <span class="row__end">
                    {control === 'onboard' ? (
                      <Pill tone="ok" dot>
                        {t('driver.loads.onBoard')}
                      </Pill>
                    ) : (
                      <Pill tone="idle">{t('driver.loads.inProgress')}</Pill>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div class="scr__cta">
        <Button onClick={() => actions.go('route')}>{t('driver.loads.findMore')}</Button>
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => loadsSummary(state.claims, state.remaining, t)} />
      </div>

      <Sheet open={!!pick} onClose={() => setPick(null)} title={t('driver.loads.pickSheetTitle')}>
        {pick ? (
          <>
            <p class="t-body">{t('driver.loads.pickBody', { ref: pick.ref, kg: pick.weightKg, dest: pick.destLabel })}</p>
            <Checklist items={[t('driver.loads.pick1', { vehicle: vehicleWord(v?.vehicleClass, t) }), t('driver.loads.pick2'), t('driver.loads.pick3')]} />
            <Button
              chevron={false}
              busy={state.busy === `load:${pick.ref}`}
              onClick={() => {
                const ref = pick.ref;
                setPick(null);
                void actions.loadBag(ref);
              }}
            >
              {t('driver.loads.pickConfirm')}
            </Button>
            <Button variant="link" onClick={() => setPick(null)}>
              {t('driver.notYet')}
            </Button>
          </>
        ) : null}
      </Sheet>

      <FreightGate claim={gate} state={state} actions={actions} onClose={() => setGate(null)} />
      <TempSheet claim={tempFor} state={state} actions={actions} onClose={() => setTempFor(null)} />
    </div>
  );
}

/** S33b — the cold-chain strip under an in-transit freight row: the safe band, the last reading, and a log control. */
function TempStrip({ claim, onLog }: { claim: Claimable; onLog: () => void }) {
  const t = useT();
  const band = claim.tempBand!;
  const breached = claim.tempBreached;
  return (
    <div class={`temp-strip${breached ? ' temp-strip--breach' : ''}`}>
      <span class="temp-strip__info">
        {breached ? <Icon name="warning" size={18} class="temp-strip__ic" /> : null}
        <span>
          {t(breached ? 'driver.loads.tempBreachedKeep' : 'driver.loads.tempKeep', { min: band.minC, max: band.maxC })}
          {claim.lastTempC != null ? t('driver.loads.tempLast', { temp: claim.lastTempC }) : ''}
        </span>
      </span>
      <Button variant="link" full={false} onClick={onLog}>
        {t('driver.loads.logTemp')}
      </Button>
    </div>
  );
}

/** S33b — log a temperature reading for a cold-chain freight in transit. */
function TempSheet({ claim, state, actions, onClose }: { claim: Claimable | null; state: DriverState; actions: DriverActions; onClose: () => void }) {
  const t = useT();
  const [val, setVal] = useState('');
  useEffect(() => setVal(''), [claim?.ref]);
  const band = claim?.tempBand;
  const num = Number(val);
  const valid = val.trim() !== '' && Number.isFinite(num);
  const busy = claim ? state.busy === `temp:${claim.ref}` : false;
  return (
    <Sheet open={!!claim} onClose={onClose} title={t('driver.loads.logTempTitle')}>
      {claim && band ? (
        <>
          <p class="t-body">{t('driver.loads.logTempBody', { min: band.minC, max: band.maxC })}</p>
          <div class="field">
            <label class="field__label" for={`temp-${claim.ref}`}>
              {t('driver.loads.tempFieldLabel')}
            </label>
            <input id={`temp-${claim.ref}`} class="input" type="number" inputMode="decimal" step="0.1" value={val} onInput={(e) => setVal(e.currentTarget.value)} />
          </div>
          <div style="margin-top:14px">
            <Button
              chevron={false}
              busy={busy}
              disabled={!valid}
              onClick={() => {
                const ref = claim.ref;
                void actions.logTemp(ref, num);
                onClose();
              }}
            >
              {t('driver.loads.logReading')}
            </Button>
          </div>
          <Button variant="link" onClick={onClose}>
            {t('driver.cancel')}
          </Button>
        </>
      ) : null}
    </Sheet>
  );
}

/**
 * S33 — the heavy-cargo safety gate. A claimed freight can't be picked up until the driver ticks every
 * load-safety item AND attaches a securement photo; an in-transit one can't be delivered until the unload
 * checklist is complete. The items come from the backend (the SAME list it enforces), so the checklist a
 * driver clears is exactly the checklist the server requires.
 */
function FreightGate({ claim, state, actions, onClose }: { claim: Claimable | null; state: DriverState; actions: DriverActions; onClose: () => void }) {
  const t = useT();
  const [checked, setChecked] = useState<string[]>([]);
  const [photoId, setPhotoId] = useState('');
  // FP3 — box 18 at pickup (the carrier's reservations), box 24 at delivery (who received it, the photo, their words).
  const [reservations, setReservations] = useState('');
  const [receiver, setReceiver] = useState('');
  const [podId, setPodId] = useState('');
  const [remarks, setRemarks] = useState('');
  // FP3b — the other ending at the door: nobody there, refused, or unreachable.
  const [failing, setFailing] = useState(false);
  const [failure, setFailure] = useState<'absent' | 'refused' | 'unreachable'>('absent');
  const [failNote, setFailNote] = useState('');
  // FP8 — the way out before pickup: hand the load back, with a reason.
  const [handing, setHanding] = useState(false);
  const [handReason, setHandReason] = useState('');
  useEffect(() => {
    setHanding(false);
    setHandReason('');
    setChecked([]);
    setPhotoId('');
    setReservations('');
    setReceiver('');
    setPodId('');
    setRemarks('');
    setFailing(false);
    setFailure('absent');
    setFailNote('');
  }, [claim?.ref]);

  const isPickup = claim?.status === 'claimed';
  const items = (isPickup ? claim?.loadChecklist : claim?.unloadChecklist) ?? [];
  const allChecked = items.length > 0 && items.every((i) => checked.includes(i.key));
  const photoOk = !isPickup || photoId.length > 0;
  const receiverOk = isPickup || receiver.trim().length >= 2;
  const podOk = isPickup || podId.length > 0;
  const busy = claim ? state.busy === `freight:${claim.ref}` : false;

  return (
    <Sheet open={!!claim} onClose={onClose} title={isPickup ? t('driver.loads.loadSafetyTitle') : t('driver.loads.unloadTitle')}>
      {claim ? (
        <>
          <p class="t-body">
            {isPickup
              ? t('driver.loads.gateBodyPickup', { ref: claim.code ?? claim.ref, kg: claim.weightKg, dest: claim.destLabel })
              : t('driver.loads.gateBodyDeliver', { ref: claim.code ?? claim.ref, kg: claim.weightKg, dest: claim.destLabel })}
          </p>
          {isPickup && claim.invoiceMissing ? <Note tone="warn" icon="warning" title={t('driver.loads.invoiceMissingTitle')} detail={t('driver.loads.invoiceMissingDetail')} /> : null}
          {/* FP7 — the sender's instructions, at the gate where they are acted on. */}
          {hasInstructions(claim.instructions) ? (
            <Card title={t('common.instructions.title')} tone="soft">
              <InstructionsBlock view={claim.instructions} />
            </Card>
          ) : null}
          <CheckGate items={items} checked={checked} onChange={setChecked} disabled={busy} />
          {isPickup ? (
            <>
              <div class="field" style="margin-top:14px">
                <span class="field__label">{t('driver.loads.securePhotoLabel')}</span>
                <PhotoField
                  id={`sec-${claim.ref}`}
                  value={photoId}
                  upload={(f) => actions.uploadPhoto('securement', f)}
                  onCapture={setPhotoId}
                  label={t('driver.loads.securePhotoAria')}
                  disabled={busy}
                />
              </div>
              {/* FP3 — the carrier's reservations (CMR box 18). Optional, and the driver's protection: a sack torn
                  BEFORE taking over is on the note as such, not as damage in transit. */}
              <div class="field" style="margin-top:14px">
                <label class="field__label" for={`res-${claim.ref}`}>
                  {t('driver.loads.reservationsLabel')}
                </label>
                <textarea id={`res-${claim.ref}`} class="input" rows={2} maxLength={500} value={reservations} onInput={(e) => setReservations(e.currentTarget.value)} disabled={busy} />
                <p class="hint">{t('driver.loads.reservationsHint')}</p>
              </div>
            </>
          ) : (
            <>
              {/* FP3 — proof of delivery (CMR box 24): who received the goods, a photo of them as put down, and what
                  the receiver said. Required, like the securement photo: "delivered" on its own is only the
                  driver's word. */}
              <div class="field" style="margin-top:14px">
                <label class="field__label" for={`rcv-${claim.ref}`}>
                  {t('driver.loads.receiverLabel')}
                </label>
                <input id={`rcv-${claim.ref}`} class="input" type="text" autocomplete="off" maxLength={120} placeholder={t('driver.loads.receiverPlaceholder')} value={receiver} onInput={(e) => setReceiver(e.currentTarget.value)} disabled={busy} />
              </div>
              <div class="field" style="margin-top:14px">
                <span class="field__label">{t('driver.loads.podPhotoLabel')}</span>
                <PhotoField
                  id={`pod-${claim.ref}`}
                  value={podId}
                  upload={(f) => actions.uploadPhoto('pod', f)}
                  onCapture={setPodId}
                  label={t('driver.loads.podPhotoAria')}
                  disabled={busy}
                />
              </div>
              <div class="field" style="margin-top:14px">
                <label class="field__label" for={`rem-${claim.ref}`}>
                  {t('driver.loads.remarksLabel')}
                </label>
                <textarea id={`rem-${claim.ref}`} class="input" rows={2} maxLength={500} value={remarks} onInput={(e) => setRemarks(e.currentTarget.value)} disabled={busy} />
                <p class="hint">{t('driver.loads.remarksHint')}</p>
              </div>
            </>
          )}
          <div style="margin-top:14px">
            <Button
              chevron={false}
              busy={busy}
              disabled={!allChecked || !photoOk || !receiverOk || !podOk}
              onClick={() => {
                const ref = claim.ref;
                if (isPickup) void actions.pickupFreight(ref, { confirmed: checked, securementPhotoId: photoId, ...(reservations.trim() ? { reservations: reservations.trim() } : {}) });
                else void actions.deliverFreight(ref, { confirmed: checked, receiverName: receiver.trim(), podPhotoId: podId, ...(remarks.trim() ? { remarks: remarks.trim() } : {}) });
                onClose();
              }}
            >
              {isPickup ? t('driver.loads.confirmPickup') : t('driver.loads.confirmDelivery')}
            </Button>
            {!allChecked ? (
              <p class="hint" style="margin-top:8px">{t('driver.loads.tickAll')}</p>
            ) : !photoOk ? (
              <p class="hint" style="margin-top:8px">{t('driver.loads.addPhoto')}</p>
            ) : !receiverOk ? (
              <p class="hint" style="margin-top:8px">{t('driver.loads.addReceiver')}</p>
            ) : !podOk ? (
              <p class="hint" style="margin-top:8px">{t('driver.loads.addPodPhoto')}</p>
            ) : null}
          </div>
          {/* FP8 — the other half of dispatch: a load can be put on a driver, so a driver can say no — and a driver
              who claimed it can change their mind. Only before the goods are on the vehicle; from pickup on, the
              way out is delivery or the sender's withdrawal. The reason travels to the sender and the office. */}
          {isPickup ? (
            !handing ? (
              <Button variant="link" onClick={() => setHanding(true)}>
                {t('driver.loads.handBackOpen')}
              </Button>
            ) : (
              <div class="card card--soft" style="margin-top:14px">
                <p class="t-body">{t('driver.loads.handBackBody')}</p>
                <div class="field">
                  <label class="field__label" for={`hb-${claim.ref}`}>
                    {t('driver.loads.handBackWhy')}
                  </label>
                  <textarea id={`hb-${claim.ref}`} class="input" rows={2} maxLength={500} value={handReason} onInput={(e) => setHandReason(e.currentTarget.value)} disabled={busy} />
                </div>
                <div style="margin-top:12px">
                  <Button
                    variant="outline"
                    chevron={false}
                    busy={busy}
                    disabled={handReason.trim().length < 3}
                    onClick={() => {
                      const ref = claim.ref;
                      void actions.handBack(ref, handReason.trim());
                      onClose();
                    }}
                  >
                    {t('driver.loads.handBackConfirm')}
                  </Button>
                  <Button variant="link" onClick={() => setHanding(false)}>
                    {t('driver.loads.handBackKeep')}
                  </Button>
                </div>
              </div>
            )
          ) : null}
          {/* FP3b — the delivery that cannot be made. Not a way out of the proof above: it records that the driver
              was at the door and why the goods are still on the van, and it tells the sender, who is the one
              who can do something about it. */}
          {!isPickup ? (
            !failing ? (
              <Button variant="link" onClick={() => setFailing(true)}>
                {t('driver.loads.couldNotDeliver')}
              </Button>
            ) : (
              <div class="card card--soft" style="margin-top:14px">
                <p class="t-body">{t('driver.loads.failBody')}</p>
                <div class="field">
                  <label class="field__label" for={`fail-${claim.ref}`}>
                    {t('driver.loads.failWhatLabel')}
                  </label>
                  <select id={`fail-${claim.ref}`} class="input" value={failure} onChange={(e) => setFailure(e.currentTarget.value as 'absent' | 'refused' | 'unreachable')} disabled={busy}>
                    <option value="absent">{t('driver.loads.failAbsent')}</option>
                    <option value="refused">{t('driver.loads.failRefused')}</option>
                    <option value="unreachable">{t('driver.loads.failUnreachable')}</option>
                  </select>
                </div>
                <div class="field" style="margin-top:10px">
                  <label class="field__label" for={`failnote-${claim.ref}`}>
                    {t('driver.loads.failNoteLabel')}
                  </label>
                  <textarea id={`failnote-${claim.ref}`} class="input" rows={2} maxLength={500} value={failNote} onInput={(e) => setFailNote(e.currentTarget.value)} disabled={busy} />
                </div>
                <div style="margin-top:12px">
                  <Button
                    variant="outline"
                    chevron={false}
                    busy={busy}
                    onClick={() => {
                      const ref = claim.ref;
                      void actions.failDelivery(ref, { outcome: failure, ...(failNote.trim() ? { note: failNote.trim() } : {}) });
                      onClose();
                    }}
                  >
                    {t('driver.loads.failConfirm')}
                  </Button>
                  <Button variant="link" onClick={() => setFailing(false)}>
                    {t('driver.loads.failBack')}
                  </Button>
                </div>
              </div>
            )
          ) : null}
          <Button variant="link" onClick={onClose}>
            {t('driver.notYet')}
          </Button>
        </>
      ) : null}
    </Sheet>
  );
}

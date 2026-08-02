import { useEffect, useState } from 'preact/hooks';
import { Button, Card, CheckGate, Checklist, ErrorNote, GlanceNumber, Icon, Note, OpenInMaps, PhotoField, Pill, ReadAloud, Sheet } from '../../../shared/ui';
import { canLoadBag, capacitySubLine, claimControl, isFull, loadsSummary, money, usedPercent } from '../logic';
import type { Claimable } from '../types';
import type { DriverActions, DriverState } from '../useDriverApp';

export interface LoadsScreenProps {
  state: DriverState;
  actions: DriverActions;
}

export function LoadsScreen({ state, actions }: LoadsScreenProps) {
  const [pick, setPick] = useState<Claimable | null>(null);
  const [gate, setGate] = useState<Claimable | null>(null); // S33 — the freight in the load/unload safety gate
  const [tempFor, setTempFor] = useState<Claimable | null>(null); // S33b — the freight whose temperature we're logging
  const v = state.vehicle;
  const hasBadge = canLoadBag(state.driver?.badgeId);

  return (
    <div class="scr">
      <h1 class="scr__title">My loads</h1>

      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      {v ? (
        <GlanceNumber
          label="Space left on the van"
          value={state.remaining}
          unit="kg"
          percent={usedPercent(v.capacityKg, state.remaining)}
          alert={isFull(state.remaining)}
          sub={capacitySubLine(state.remaining, v.capacityKg, state.claims.length)}
        />
      ) : null}

      {!hasBadge && state.claims.length > 0 ? (
        <Note
          tone="warn"
          icon="badge"
          title="No badge on your record"
          detail="You cannot scan bags onto the van until the office adds your badge number."
        />
      ) : null}

      {state.claims.length === 0 ? (
        <Card title="Nothing claimed yet" tone="soft">
          <Checklist items={['Pick a route', 'Claim the loads on your way', 'Scan each bag onto the van']} />
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
                  <span class="load__meta">{`${c.pickupLabel} → ${c.destLabel} · ${c.weightKg} kg`}</span>
                  {/* S34 — the locked earning rides on the claimed freight, so a driver always sees what this job pays. */}
                  {c.lockedPrice != null ? <span class="load__earn">You earn {money(c.lockedPrice)}</span> : null}
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
                    aria-label={`Load ${c.code ?? c.ref} onto the van`}
                  >
                    {body}
                    <span class="row__end">
                      <Pill tone="info">Load on</Pill>
                      <Icon name="chevronRight" size={22} />
                    </span>
                  </button>
                  {c.pickupLocation ? (
                    <div class="load__nav">
                      <OpenInMaps point={c.pickupLocation} label={`Navigate to ${c.pickupLabel}`} />
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
                    aria-label={`${isPickup ? 'Pick up' : 'Deliver'} freight ${c.code ?? c.ref}`}
                  >
                    {body}
                    <span class="row__end">
                      <Pill tone={isPickup ? 'info' : 'ok'}>{isPickup ? 'Pick up' : 'Deliver'}</Pill>
                      <Icon name="chevronRight" size={22} />
                    </span>
                  </button>
                  {/* G3 — before pickup, offer turn-by-turn to the pickup point. */}
                  {isPickup && c.pickupLocation ? (
                    <div class="load__nav">
                      <OpenInMaps point={c.pickupLocation} label={`Navigate to ${c.pickupLabel}`} />
                    </div>
                  ) : null}
                  {/* S33b — an in-transit cold-chain load: show the safe band + last reading + a log control. */}
                  {control === 'deliver' && c.tempBand ? <TempStrip claim={c} onLog={() => setTempFor(c)} /> : null}
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
                        On board
                      </Pill>
                    ) : (
                      <Pill tone="idle">In progress</Pill>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div class="scr__cta">
        <Button onClick={() => actions.go('route')}>Find more work</Button>
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => loadsSummary(state.claims, state.remaining)} />
      </div>

      <Sheet open={!!pick} onClose={() => setPick(null)} title="Put this bag on the van?">
        {pick ? (
          <>
            <p class="t-body">{`${pick.ref} — ${pick.weightKg} kg, going to ${pick.destLabel}.`}</p>
            <Checklist items={['Every parcel inside moves to your van', 'The shop is told it has left', 'Your delivery is booked against your badge']} />
            <Button
              chevron={false}
              busy={state.busy === `load:${pick.ref}`}
              onClick={() => {
                const ref = pick.ref;
                setPick(null);
                void actions.loadBag(ref);
              }}
            >
              Yes, it is on board
            </Button>
            <Button variant="link" onClick={() => setPick(null)}>
              Not yet
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
  const band = claim.tempBand!;
  const breached = claim.tempBreached;
  return (
    <div class={`temp-strip${breached ? ' temp-strip--breach' : ''}`}>
      <span class="temp-strip__info">
        {breached ? <Icon name="warning" size={18} class="temp-strip__ic" /> : null}
        <span>
          {breached ? 'Temperature breached — keep ' : 'Keep '}
          {band.minC}–{band.maxC}°C
          {claim.lastTempC != null ? ` · last ${claim.lastTempC}°C` : ''}
        </span>
      </span>
      <Button variant="link" full={false} onClick={onLog}>
        Log temp
      </Button>
    </div>
  );
}

/** S33b — log a temperature reading for a cold-chain freight in transit. */
function TempSheet({ claim, state, actions, onClose }: { claim: Claimable | null; state: DriverState; actions: DriverActions; onClose: () => void }) {
  const [val, setVal] = useState('');
  useEffect(() => setVal(''), [claim?.ref]);
  const band = claim?.tempBand;
  const num = Number(val);
  const valid = val.trim() !== '' && Number.isFinite(num);
  const busy = claim ? state.busy === `temp:${claim.ref}` : false;
  return (
    <Sheet open={!!claim} onClose={onClose} title="Log temperature">
      {claim && band ? (
        <>
          <p class="t-body">{`Keep this load between ${band.minC}°C and ${band.maxC}°C. Enter the current reading.`}</p>
          <div class="field">
            <label class="field__label" for={`temp-${claim.ref}`}>
              Temperature °C
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
              Log this reading
            </Button>
          </div>
          <Button variant="link" onClick={onClose}>
            Cancel
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
  const [checked, setChecked] = useState<string[]>([]);
  const [photoId, setPhotoId] = useState('');
  useEffect(() => {
    setChecked([]);
    setPhotoId('');
  }, [claim?.ref]);

  const isPickup = claim?.status === 'claimed';
  const items = (isPickup ? claim?.loadChecklist : claim?.unloadChecklist) ?? [];
  const allChecked = items.length > 0 && items.every((i) => checked.includes(i.key));
  const photoOk = !isPickup || photoId.length > 0;
  const busy = claim ? state.busy === `freight:${claim.ref}` : false;

  return (
    <Sheet open={!!claim} onClose={onClose} title={isPickup ? 'Load-safety check' : 'Unload check'}>
      {claim ? (
        <>
          <p class="t-body">{`${claim.code ?? claim.ref} — ${claim.weightKg} kg to ${claim.destLabel}. Confirm each item before you ${isPickup ? 'pick this up' : 'mark it delivered'}.`}</p>
          <CheckGate items={items} checked={checked} onChange={setChecked} disabled={busy} />
          {isPickup ? (
            <div class="field" style="margin-top:14px">
              <span class="field__label">Photo of the secured load</span>
              <PhotoField
                id={`sec-${claim.ref}`}
                value={photoId}
                upload={(f) => actions.uploadPhoto('securement', f)}
                onCapture={setPhotoId}
                label="Take a photo of the secured load"
                disabled={busy}
              />
            </div>
          ) : null}
          <div style="margin-top:14px">
            <Button
              chevron={false}
              busy={busy}
              disabled={!allChecked || !photoOk}
              onClick={() => {
                const ref = claim.ref;
                if (isPickup) void actions.pickupFreight(ref, { confirmed: checked, securementPhotoId: photoId });
                else void actions.deliverFreight(ref, { confirmed: checked });
                onClose();
              }}
            >
              {isPickup ? 'Confirm pickup' : 'Confirm delivery'}
            </Button>
            {!allChecked ? <p class="hint" style="margin-top:8px">Tick every item to continue.</p> : !photoOk ? <p class="hint" style="margin-top:8px">Add a photo of the secured load.</p> : null}
          </div>
          <Button variant="link" onClick={onClose}>
            Not yet
          </Button>
        </>
      ) : null}
    </Sheet>
  );
}

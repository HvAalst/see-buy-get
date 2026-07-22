import { useState } from 'preact/hooks';
import { Button, Card, Checklist, ErrorNote, GlanceNumber, Icon, Note, Pill, ReadAloud, Sheet } from '../../../shared/ui';
import { canLoadBag, capacitySubLine, claimControl, isFull, loadsSummary, usedPercent } from '../logic';
import type { Claimable } from '../types';
import type { DriverActions, DriverState } from '../useDriverApp';

export interface LoadsScreenProps {
  state: DriverState;
  actions: DriverActions;
}

export function LoadsScreen({ state, actions }: LoadsScreenProps) {
  const [pick, setPick] = useState<Claimable | null>(null);
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
                  <span class="load__ref">{c.ref}</span>
                  <span class="load__meta">{`${c.pickupLabel} → ${c.destLabel} · ${c.weightKg} kg`}</span>
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
                    aria-label={`Load ${c.ref} onto the van`}
                  >
                    {body}
                    <span class="row__end">
                      <Pill tone="info">Load on</Pill>
                      <Icon name="chevronRight" size={22} />
                    </span>
                  </button>
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
                      /* Freight pickup/deliver exists server-side but is not in the driver
                         facade, so this app cannot act on it. Say that plainly rather than
                         showing a button that does nothing. */
                      <Pill tone="idle">Hub handles this</Pill>
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
    </div>
  );
}

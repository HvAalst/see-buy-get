import { Button, Card, ErrorNote, Icon, ReadAloud, ScanField } from '../../../shared/ui';
import { bagLine, fillPercent, loadableBags, swatchIndex } from '../logic';
import type { MdpActions, MdpState } from '../useMdpApp';

export interface LoadScreenProps {
  state: MdpState;
  actions: MdpActions;
}

/**
 * Load a full destination bag onto the bus: tap the bag, scan the driver badge, one CTA.
 * One scan moves the whole bag — every parcel inside goes On the bus.
 */
export function LoadScreen({ state, actions }: LoadScreenProps) {
  const bags = loadableBags(state.totes);
  const f = state.form;

  return (
    <div class="scr">
      <h1 class="scr__title">Load a bag onward</h1>
      <p class="scr__lede">Tap the bag you are handing to the driver, then scan their badge.</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      {bags.length === 0 ? (
        <Card>
          <p class="hint">No bags with parcels are ready to load. Sort parcels to fill one.</p>
        </Card>
      ) : (
        <>
          <Card label="Pick the bag">
            <div class="bags" role="group" aria-label="Bags ready to load">
              {bags.map((t) => {
                const on = f.loadCode === t.code;
                return (
                  <button key={t.code} type="button" class={`bagrow${on ? ' bagrow--on' : ''}`} aria-pressed={on} onClick={() => actions.pickLoadCode(t.code)}>
                    <span class={`swatch swatch--${swatchIndex(t.destinationNodeId)}`} aria-hidden="true" />
                    <span class="bagrow__body">
                      <span class="bagrow__code">{t.code}</span>
                      <span class="bagrow__dest">{bagLine(t)}</span>
                      <span class="fillbar" role="progressbar" aria-valuenow={fillPercent(t.unitsUsed)} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.code} fill`}>
                        <span style={`width:${fillPercent(t.unitsUsed)}%`} />
                      </span>
                    </span>
                    {on ? (
                      <span class="bagrow__tick" aria-hidden="true">
                        <Icon name="check" size={22} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <ScanField
              id="load-badge"
              label="Driver badge"
              value={f.badge}
              onValue={(v) => actions.setForm({ badge: v })}
              expect="badge"
              placeholder="Scan the badge"
              upper
            />
            <p class="card__note">One scan moves the whole bag — every parcel inside goes on the bus.</p>
          </Card>

          <div class="scr__cta">
            <Button onClick={() => void actions.submitLoad()} disabled={!f.loadCode || !f.badge.trim()} busy={state.busy === 'load'}>
              {f.loadCode ? `Load ${f.loadCode} onto the bus` : 'Pick a bag above'}
            </Button>
          </div>
        </>
      )}

      <div class="scr__foot">
        <ReadAloud
          text={() =>
            bags.length === 0
              ? 'No bags are ready to load. Sort parcels to fill one.'
              : f.loadCode
                ? `Bag ${f.loadCode} is picked. Scan the driver badge, then load it.`
                : 'Tap the bag you are handing over, then scan the driver badge.'
          }
          label="Read this aloud"
        />
      </div>
    </div>
  );
}

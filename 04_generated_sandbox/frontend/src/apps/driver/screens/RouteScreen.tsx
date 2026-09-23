import { Button, Card, ErrorNote, Explainer, ExplainerReset, Icon, Note, PlacePicker, ReadAloud, type PlaceNote } from '../../../shared/ui';
import { useT, type Translate } from '../../../shared/i18n';
import { MAX_WORK_RADIUS_KM } from '../logic';
import { CUSTOM_PLACE, type CustomPlace, type DriverActions, type DriverState } from '../useDriverApp';
import { RoadSection } from './RoadSection';
import { CounterSection } from './CounterSection';

export interface RouteScreenProps {
  state: DriverState;
  actions: DriverActions;
}

/**
 * What a placed (or unplaced) road end MEANS here: whether we can match loads to it at all. A guessed pin
 * still works — it just matches around the wrong village, which the driver can see and correct on the map.
 */
function roadNote(t: Translate, note: PlaceNote): string {
  switch (note.kind) {
    case 'notFound':
      return t('driver.route.geoNotFound');
    case 'pinned':
      return t('driver.route.pinned');
    case 'found':
      return note.confidence === 'exact'
        ? t('driver.route.geoExact', { where: note.where })
        : note.confidence === 'approx'
          ? t('driver.route.geoApprox', { where: note.where })
          : t('driver.route.geoGuess');
    default:
      return t('driver.route.noPin');
  }
}

/** Is this end usable? A network place is; a hand-named one needs both a name and a pin. */
function ready(id: string, place: CustomPlace): boolean {
  if (!id) return false;
  return id === CUSTOM_PLACE ? Boolean(place.pin && place.label.trim()) : true;
}

/** One end of the road when it is not a place on the network — a market, a junction, a depot gate. */
function CustomEnd({ end, place, actions, reference, idPrefix }: { end: 'fromPlace' | 'toPlace'; place: CustomPlace; actions: DriverActions; reference: { lat: number; lng: number } | null; idPrefix: string }) {
  const t = useT();
  return (
    <PlacePicker
      id={`${idPrefix}-place`}
      fieldLabel={t('driver.route.customLabel')}
      placeholder={t('driver.route.customPh')}
      mapLabel={t('driver.route.customMapLabel')}
      findLabel={t('driver.route.findOnMap')}
      label={place.label}
      pin={place.pin}
      reference={reference}
      onLabel={(label) => actions.setPlace(end, { label })}
      onPin={(pin, from) => actions.setPlace(end, { pin, from })}
      geocode={actions.geocodePlace}
      noteText={(n) => roadNote(t, n)}
    />
  );
}

export function RouteScreen({ state, actions }: RouteScreenProps) {
  const t = useT();
  const loading = state.nodesState === 'loading';
  const empty = state.nodesState === 'error' || (state.nodesState === 'ready' && state.nodes.length === 0);
  const near = state.form.mode === 'near';

  return (
    <div class="scr">
      <h1 class="scr__title">{t('driver.route.title')}</h1>
      <Explainer who={state.driver?.did} id="driver.route.how" text={near ? t('driver.route.ledeNear') : t('driver.route.lede')} />

      {state.error ? <ErrorNote error={state.error} onRetry={() => void actions.loadNodes()} /> : null}

      {/* Two shapes a working day has. A click-only choice, so it is a group of pressed buttons rather than
          a tablist — nothing is being revealed behind a tab, the search itself changes. */}
      <div class="pmap-toggle" role="group" aria-label={t('driver.route.modeAria')}>
        <button type="button" class={`pmap-toggle__btn${!near ? ' is-on' : ''}`} aria-pressed={!near} onClick={() => actions.setForm({ mode: 'route' })}>
          <Icon name="route" size={18} /> {t('driver.route.modeRoad')}
        </button>
        <button type="button" class={`pmap-toggle__btn${near ? ' is-on' : ''}`} aria-pressed={near} onClick={() => actions.setForm({ mode: 'near' })}>
          <Icon name="pin" size={18} /> {t('driver.route.modeNear')}
        </button>
      </div>

      {near ? (
        <>
          <Card>
            {/* No place to name: for a rider there is only here, and how far they will go for a load. */}
            <div class="stepper">
              <span class="stepper__label" id="radius-l">{t('driver.route.radiusLabel')}</span>
              <div class="stepper__ctrl" role="group" aria-labelledby="radius-l">
                <button type="button" class="stepper__btn" aria-label={t('driver.route.radiusLess')} disabled={state.form.radiusKm <= 1} onClick={() => actions.setForm({ radiusKm: state.form.radiusKm - 1 })}>−</button>
                <span class="stepper__val" aria-live="polite">{t('driver.route.radiusValue', { km: state.form.radiusKm })}</span>
                <button type="button" class="stepper__btn" aria-label={t('driver.route.radiusMore')} disabled={state.form.radiusKm >= MAX_WORK_RADIUS_KM} onClick={() => actions.setForm({ radiusKm: state.form.radiusKm + 1 })}>+</button>
              </div>
            </div>
            <p class="card__note">{t('driver.route.radiusNote')}</p>

            <div class="field" style="margin-top:16px">
              <label class="field__label" for="min-earn-near">
                {t('driver.route.minEarnLabel')}
              </label>
              <input
                id="min-earn-near"
                class="input"
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                placeholder={t('driver.route.minEarnPlaceholder')}
                value={state.form.minEarn}
                onInput={(e) => actions.setForm({ minEarn: e.currentTarget.value })}
              />
            </div>
          </Card>

          <div class="scr__cta">
            <Button onClick={() => void actions.findNearby()} busy={state.busy === 'suggest'}>
              {t('driver.route.findNear')}
            </Button>
          </div>

          <div class="scr__foot">
            <ReadAloud text={() => t('driver.route.aloudNear', { km: state.form.radiusKm })} label={t('driver.readAloud')} />
            <ExplainerReset who={state.driver?.did} />
          </div>
        </>
      ) : (
        <RouteSearch state={state} actions={actions} loading={loading} empty={empty} />
      )}

      {/* Below the search, in both modes. Whichever way this driver is looking for work, they are about to
          drive a road — and the map of it only exists because the people driving it report it. */}
      <RoadSection state={state} actions={actions} />
      {/* CL5 — the counter beside the road. The same argument in a different building: nobody publishes
          what either will demand this month, so the people who meet them write it down. */}
      <CounterSection state={state} actions={actions} />
    </div>
  );
}

function RouteSearch({ state, actions, loading, empty }: RouteScreenProps & { loading: boolean; empty: boolean }) {
  const t = useT();
  return (
    <>

      {empty ? (
        /* The legacy page swallowed this failure into an empty <select> and a button that
           always errored. An empty list has a cause and a way out. */
        <Note tone="warn" icon="pin" title={t('driver.route.emptyTitle')} detail={t('driver.route.emptyDetail')} />
      ) : null}

      <Card>
        <div class="field">
          <label class="field__label" for="from">
            {t('driver.route.fromLabel')}
          </label>
          <select
            id="from"
            class="select"
            value={state.form.fromId}
            disabled={loading || empty}
            onChange={(e) => actions.setForm({ fromId: e.currentTarget.value })}
          >
            <option value="">{loading ? t('driver.route.loadingPlaces') : t('driver.route.choosePlace')}</option>
            {state.nodes.map((n) => (
              <option value={n.id} key={n.id}>
                {n.label}
              </option>
            ))}
            {/* Not every road starts at a shop or a hub. A depot gate, a market, the junction where you
                actually join the highway — name it and put it on the map. */}
            <option value={CUSTOM_PLACE}>{t('driver.route.somewhereElse')}</option>
          </select>
        </div>
        {state.form.fromId === CUSTOM_PLACE ? (
          <CustomEnd end="fromPlace" place={state.form.fromPlace} actions={actions} reference={state.route?.from ?? null} idPrefix="from" />
        ) : null}

        <div class="field" style="margin-top:16px">
          <label class="field__label" for="to">
            {t('driver.route.toLabel')}
          </label>
          <select
            id="to"
            class="select"
            value={state.form.toId}
            disabled={loading || empty}
            onChange={(e) => actions.setForm({ toId: e.currentTarget.value })}
          >
            <option value="">{loading ? t('driver.route.loadingPlaces') : t('driver.route.choosePlace')}</option>
            {state.nodes.map((n) => (
              <option value={n.id} key={n.id}>
                {n.label}
              </option>
            ))}
            <option value={CUSTOM_PLACE}>{t('driver.route.somewhereElse')}</option>
          </select>
        </div>
        {state.form.toId === CUSTOM_PLACE ? (
          <CustomEnd end="toPlace" place={state.form.toPlace} actions={actions} reference={state.form.fromPlace.pin ?? state.route?.from ?? null} idPrefix="to" />
        ) : null}

        <div class="field" style="margin-top:16px">
          <label class="field__label" for="min-earn">
            {t('driver.route.minEarnLabel')}
          </label>
          <input
            id="min-earn"
            class="input"
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            placeholder={t('driver.route.minEarnPlaceholder')}
            value={state.form.minEarn}
            disabled={loading || empty}
            onInput={(e) => actions.setForm({ minEarn: e.currentTarget.value })}
          />
        </div>
      </Card>

      <div class="scr__cta">
        <Button
          onClick={() => void actions.submitRoute()}
          busy={state.busy === 'suggest'}
          // A hand-named end is only an end once it has BOTH a name and a point — a road that stops at a
          // word cannot be matched against anything.
          disabled={
            loading ||
            empty ||
            !ready(state.form.fromId, state.form.fromPlace) ||
            !ready(state.form.toId, state.form.toPlace)
          }
        >
          {t('driver.route.submit')}
        </Button>
      </div>

      {empty ? (
        <Button variant="outline" onClick={() => void actions.loadNodes()} busy={loading}>
          {t('driver.route.retryPlaces')}
        </Button>
      ) : null}

      {state.route ? (
        <Button variant="link" full={false} busy={state.busy === 'suggest'} onClick={() => void actions.repeatRoute()}>
          {t('driver.repeat', { from: state.route.fromLabel, to: state.route.toLabel })}
        </Button>
      ) : null}

      <div class="scr__foot">
        <ReadAloud text={() => t('driver.route.aloud')} label={t('driver.readAloud')} />
        <ExplainerReset who={state.driver?.did} />
      </div>
    </>
  );
}

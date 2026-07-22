import { Button, Card, ErrorNote, Note, ReadAloud } from '../../../shared/ui';
import type { DriverActions, DriverState } from '../useDriverApp';

export interface RouteScreenProps {
  state: DriverState;
  actions: DriverActions;
}

const SPOKEN =
  'Choose where you are starting from and where you are heading. We will only offer you loads that are on your way and fit in your van.';

export function RouteScreen({ state, actions }: RouteScreenProps) {
  const loading = state.nodesState === 'loading';
  const empty = state.nodesState === 'error' || (state.nodesState === 'ready' && state.nodes.length === 0);

  return (
    <div class="scr">
      <h1 class="scr__title">Where are you going?</h1>
      <p class="scr__lede">We only offer loads that are on your way and fit the space you have left.</p>

      {state.error ? <ErrorNote error={state.error} onRetry={() => void actions.loadNodes()} /> : null}

      {empty ? (
        /* The legacy page swallowed this failure into an empty <select> and a button that
           always errored. An empty list has a cause and a way out. */
        <Note tone="warn" icon="pin" title="We could not load the places list" detail="Check your signal, then try again." />
      ) : null}

      <Card>
        <div class="field">
          <label class="field__label" for="from">
            Starting from
          </label>
          <select
            id="from"
            class="select"
            value={state.form.fromId}
            disabled={loading || empty}
            onChange={(e) => actions.setForm({ fromId: e.currentTarget.value })}
          >
            <option value="">{loading ? 'Loading places…' : 'Choose a place'}</option>
            {state.nodes.map((n) => (
              <option value={n.id} key={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </div>

        <div class="field" style="margin-top:16px">
          <label class="field__label" for="to">
            Heading to
          </label>
          <select
            id="to"
            class="select"
            value={state.form.toId}
            disabled={loading || empty}
            onChange={(e) => actions.setForm({ toId: e.currentTarget.value })}
          >
            <option value="">{loading ? 'Loading places…' : 'Choose a place'}</option>
            {state.nodes.map((n) => (
              <option value={n.id} key={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </div>

        <p class="card__note">We only suggest loads on your route that fit your remaining capacity.</p>
      </Card>

      <div class="scr__cta">
        <Button
          onClick={() => void actions.submitRoute()}
          busy={state.busy === 'suggest'}
          disabled={loading || empty || !state.form.fromId || !state.form.toId}
        >
          Show shipments on my way
        </Button>
      </div>

      {empty ? (
        <Button variant="outline" onClick={() => void actions.loadNodes()} busy={loading}>
          Try loading the places again
        </Button>
      ) : null}

      {state.route ? (
        <Button variant="link" full={false} busy={state.busy === 'suggest'} onClick={() => void actions.repeatRoute()}>
          {`Repeat: ${state.route.fromLabel} → ${state.route.toLabel}`}
        </Button>
      ) : null}

      <div class="scr__foot">
        <ReadAloud text={() => SPOKEN} label="Read this aloud" />
      </div>
    </div>
  );
}

import { Button, Card, ErrorNote, Note, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { DriverActions, DriverState } from '../useDriverApp';

export interface RouteScreenProps {
  state: DriverState;
  actions: DriverActions;
}

export function RouteScreen({ state, actions }: RouteScreenProps) {
  const t = useT();
  const loading = state.nodesState === 'loading';
  const empty = state.nodesState === 'error' || (state.nodesState === 'ready' && state.nodes.length === 0);

  return (
    <div class="scr">
      <h1 class="scr__title">{t('driver.route.title')}</h1>
      <p class="scr__lede">{t('driver.route.lede')}</p>

      {state.error ? <ErrorNote error={state.error} onRetry={() => void actions.loadNodes()} /> : null}

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
          </select>
        </div>

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
          </select>
        </div>

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

        <p class="card__note">{t('driver.route.note')}</p>
      </Card>

      <div class="scr__cta">
        <Button
          onClick={() => void actions.submitRoute()}
          busy={state.busy === 'suggest'}
          disabled={loading || empty || !state.form.fromId || !state.form.toId}
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
      </div>
    </div>
  );
}

import { Button, Card, ErrorNote, Explainer, Icon, ReadAloud, ScanField } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
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
  const t = useT();
  const bags = loadableBags(state.totes);
  const f = state.form;

  return (
    <div class="scr">
      <h1 class="scr__title">{t('mdp.load.title')}</h1>
      <Explainer who={state.hub?.did} id="mdp.load.how" text={t('mdp.load.lede')} />

      {state.error ? <ErrorNote error={state.error} /> : null}

      {bags.length === 0 ? (
        <Card>
          <p class="hint">{t('mdp.load.noBags')}</p>
        </Card>
      ) : (
        <>
          <Card label={t('mdp.load.pickBag')}>
            <div class="bags" role="group" aria-label={t('mdp.load.bagsGroup')}>
              {bags.map((bag) => {
                const on = f.loadCode === bag.code;
                return (
                  <button key={bag.code} type="button" class={`bagrow${on ? ' bagrow--on' : ''}`} aria-pressed={on} onClick={() => actions.pickLoadCode(bag.code)}>
                    <span class={`swatch swatch--${swatchIndex(bag.destinationNodeId)}`} aria-hidden="true" />
                    <span class="bagrow__body">
                      <span class="bagrow__code">{bag.code}</span>
                      <span class="bagrow__dest">{bagLine(bag, t)}</span>
                      <span class="fillbar" role="progressbar" aria-valuenow={fillPercent(bag.unitsUsed)} aria-valuemin={0} aria-valuemax={100} aria-label={t('mdp.bagFillAria', { code: bag.code })}>
                        <span style={`width:${fillPercent(bag.unitsUsed)}%`} />
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
              label={t('mdp.load.driverBadge')}
              value={f.badge}
              onValue={(v) => actions.setForm({ badge: v })}
              expect="badge"
              placeholder={t('mdp.load.scanBadge')}
              upper
            />
            <p class="card__note">{t('mdp.load.oneScan')}</p>
          </Card>

          <div class="scr__cta">
            <Button onClick={() => void actions.submitLoad()} disabled={!f.loadCode || !f.badge.trim()} busy={state.busy === 'load'}>
              {f.loadCode ? t('mdp.load.loadOnto', { code: f.loadCode }) : t('mdp.load.pickAbove')}
            </Button>
          </div>
        </>
      )}

      <div class="scr__foot">
        <ReadAloud
          text={() =>
            bags.length === 0
              ? t('mdp.load.aloudEmpty')
              : f.loadCode
                ? t('mdp.load.aloudPicked', { code: f.loadCode })
                : t('mdp.load.aloudPick')
          }
          label={t('mdp.readAloud')}
        />
      </div>
    </div>
  );
}

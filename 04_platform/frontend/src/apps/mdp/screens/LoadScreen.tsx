import { useEffect, useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Explainer, Icon, Note, ReadAloud, ScanField } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { BagCloseFields } from '../../../shared/BagSealFields';
import { closeReady, closureBody, EMPTY_BAG_CLOSE, type BagCloseForm } from '../../../shared/bagSeal';
import { heldLine } from '../../../shared/tamper';
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
  // Round 36 — a bag leaves closed: its coded seal and a photograph, or a photograph alone. Closed here before the badge.
  const picked = bags.find((b) => b.code === f.loadCode);
  const [closing, setClosing] = useState<BagCloseForm>(EMPTY_BAG_CLOSE);
  useEffect(() => setClosing(EMPTY_BAG_CLOSE), [f.loadCode]);
  const ready = Boolean(picked?.closedWith) && !picked?.held;

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
                      {bag.closedWith ? <span class="bagrow__dest">{t(bag.closedWith === 'seal' ? 'mdp.bag.closedLine' : 'mdp.bag.closedPhotoLine')}</span> : null}
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

          {picked?.held ? <Note tone="warn" icon="warning" title={t('mdp.bag.heldTitle')} detail={`${heldLine(picked.held, t)} ${t('common.bag.heldNote')}`} /> : null}

          {picked && !picked.closedWith && !picked.held ? (
            <Card title={t('mdp.bag.closeFirst')}>
              <BagCloseFields id="load-close" value={closing} onChange={setClosing} upload={(file) => actions.uploadPhoto(file, 'seal')} disabled={state.busy === 'close'} />
              <div style="margin-top:12px">
                <Button chevron={false} busy={state.busy === 'close'} disabled={!closeReady(closing)} onClick={() => void actions.closeBag(picked.code, closureBody(closing))}>
                  {t('mdp.bag.closeCta')}
                </Button>
              </div>
            </Card>
          ) : null}

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
            <Button onClick={() => void actions.submitLoad()} disabled={!f.loadCode || !f.badge.trim() || !ready} busy={state.busy === 'load'}>
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

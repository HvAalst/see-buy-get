import { Button, Card, Checklist, Note, QrBlock, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { qrPayload } from '../../../shared/qr';
import type { AgentActions, AgentState } from '../useAgentApp';
import { PhotoField } from './PhotoField';

export interface CollectScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/**
 * Everything that happens once an ORDER code has resolved a parcel: the shelf slot (the hero — it is the
 * one thing the shopkeeper needs), the contents check, what is owed, hand over, or report a problem.
 *
 * Split out from the screen so the merged counter flow can render it without duplicating any of it. The
 * counter asks for the customer's code once and then shows whichever hand-over that code turned out to
 * be; two copies of this markup would be two places for the hand-over to drift apart.
 */
export function CollectBody({ state, actions }: CollectScreenProps) {
  const t = useT();
  const f = state.collect;
  const found = f.found;
  const items = found?.parcel.items ?? [];
  const slot = f.found?.binSlot || found?.parcel.binSlot;

  return (
    <>
      {found ? (
        <>
          <section class="slot" aria-label={t('agent.collect.shelfAria')}>
            <p class="slot__label">{t('agent.collect.fetchFromShelf')}</p>
            <p class="slot__value">{slot ?? '—'}</p>
            <p class="slot__sub">{found.parcel.parcelId}</p>
          </section>

          {/* The parcel's own code, so a shelf search can be a scan rather than a squint
              at a sticker in bad light. */}
          <Card label={t('agent.collect.parcelCode')}>
            <QrBlock
              value={qrPayload('parcel', found.parcel.parcelId)}
              size={132}
              caption={found.parcel.parcelId}
              label={t('agent.collect.qrLabel', { id: found.parcel.parcelId })}
            />
          </Card>

          {/* Money owed BEFORE the hand-over button, never after it. This shop has already been paid for
              holding the slot; what it is collecting here is the network's money, and the amount is the
              same figure the customer's own app showed them — one arithmetic, one number, no argument. */}
          {found.holdingOwed ? (
            <Note
              tone="warn"
              icon="clock"
              title={t('agent.collect.holdingTitle', { amount: found.holdingOwed.toFixed(2) })}
              detail={t('agent.collect.holdingDetail')}
            />
          ) : null}

          <Card label={t('agent.collect.checkContents')}>
            {items.length ? (
              <Checklist items={items.map((it) => t('agent.collect.itemLine', { qty: it.qty, name: it.name }))} />
            ) : (
              <p class="hint">{t('agent.collect.noItems')}</p>
            )}
          </Card>

          <div class="scr__cta">
            <Button onClick={() => void actions.confirmCollect()} busy={state.busy === 'collect-confirm'}>
              {t('agent.collect.handOverGood')}
            </Button>
          </div>
          <Button variant="outline" onClick={() => actions.setCollect({ disputing: true })}>
            {t('agent.collect.reportProblem')}
          </Button>
        </>
      ) : null}

      <Sheet open={f.disputing} onClose={() => actions.setCollect({ disputing: false })} title={t('agent.collect.disputeTitle')}>
        <div class="field">
          <label class="field__label" for="dispute-reason">
            {t('agent.collect.problemLabel')}
          </label>
          <input
            id="dispute-reason"
            class="input"
            value={f.reason}
            onInput={(e) => actions.setCollect({ reason: e.currentTarget.value })}
            placeholder={t('agent.collect.problemPh')}
          />
        </div>
        <PhotoField id="dispute-photo" value={f.photoRef} label={t('agent.collect.problemPhoto')} upload={(file) => actions.uploadPhoto('dispute', file)} onCapture={(ref) => actions.setCollect({ photoRef: ref })} />
        <Button
          chevron={false}
          disabled={!f.reason.trim() || !f.photoRef}
          busy={state.busy === 'dispute'}
          onClick={() => void actions.submitDispute()}
        >
          {t('agent.collect.sendReport')}
        </Button>
        <Button variant="link" onClick={() => actions.setCollect({ disputing: false })}>
          {t('agent.collect.goBack')}
        </Button>
      </Sheet>
    </>
  );
}

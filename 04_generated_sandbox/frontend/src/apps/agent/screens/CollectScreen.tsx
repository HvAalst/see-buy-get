import { Button, Card, Checklist, ErrorNote, QrBlock, ReadAloud, ScanField, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { qrPayload } from '../../../shared/qr';
import type { AgentActions, AgentState } from '../useAgentApp';
import { PhotoField } from './PhotoField';

export interface CollectScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/**
 * Click-and-collect counter flow: the buyer shows their collection code, the screen answers
 * with the SHELF SLOT (the one thing the shopkeeper needs, so it is the hero), the buyer
 * checks the contents, then confirm — or file a dispute with a reason + photo.
 */
export function CollectScreen({ state, actions }: CollectScreenProps) {
  const t = useT();
  const f = state.collect;
  const found = f.found;
  const items = found?.parcel.items ?? [];
  const slot = f.found?.binSlot || found?.parcel.binSlot;

  return (
    <div class="scr">
      <h1 class="scr__title">{t('agent.collect.title')}</h1>
      <p class="scr__lede">{t('agent.collect.lede')}</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      <Card>
        <ScanField
          id="collect-code"
          label={t('agent.collect.codeLabel')}
          value={f.code}
          onValue={(v) => actions.setCollect({ code: v })}
          expect="collect"
          placeholder={t('agent.scanPlaceholder')}
          upper
          enterKeyHint="search"
          onScan={(v) => void actions.findCollect(v)}
        />
        <div style="margin-top:12px">
          <Button chevron={false} onClick={() => void actions.findCollect()} disabled={!f.code.trim()} busy={state.busy === 'collect-find'}>
            {t('agent.collect.findOrder')}
          </Button>
        </div>
      </Card>

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

      <div class="scr__foot">
        <ReadAloud
          text={() =>
            found
              ? t('agent.collect.aloudFound', { slot: slot ?? t('agent.collect.slotUnknown') })
              : t('agent.collect.aloudPrompt')
          }
          label={t('agent.readAloud')}
        />
      </div>

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
    </div>
  );
}

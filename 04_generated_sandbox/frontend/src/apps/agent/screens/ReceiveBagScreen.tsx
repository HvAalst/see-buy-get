import { Button, Card, Checklist, ErrorNote, ReadAloud, ScanField } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { AgentActions, AgentState } from '../useAgentApp';

export interface ReceiveBagScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/**
 * The tote last-mile: a bus dropped a bag for this shop — one scan shelves every parcel
 * inside and frees the bag for reuse.
 */
export function ReceiveBagScreen({ state, actions }: ReceiveBagScreenProps) {
  const t = useT();
  const code = state.receivebag.code;

  return (
    <div class="scr">
      <h1 class="scr__title">{t('agent.receivebag.title')}</h1>
      <p class="scr__lede">{t('agent.receivebag.lede')}</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      <Card>
        <ScanField
          id="bag-code"
          label={t('agent.receivebag.codeLabel')}
          value={code}
          onValue={(v) => actions.setReceiveBag(v)}
          expect="tote"
          placeholder="BAG-000"
          upper
          enterKeyHint="go"
          onScan={(v) => void actions.submitReceiveBag(v)}
        />
      </Card>

      <div class="scr__cta">
        <Button onClick={() => void actions.submitReceiveBag()} disabled={!code.trim()} busy={state.busy === 'receivebag'}>
          {t('agent.receivebag.receiveShelve')}
        </Button>
      </div>

      <Card title={t('agent.receivebag.whatHappens')} tone="soft">
        <Checklist
          items={[t('agent.receivebag.step1'), t('agent.receivebag.step2'), t('agent.receivebag.step3')]}
        />
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => t('agent.receivebag.aloud')} label={t('agent.readAloud')} />
      </div>
    </div>
  );
}

import { Button, Card, Checklist, ErrorNote, Icon, ReadAloud, ScanField } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { putAwayAloud } from '../logic';
import type { AgentActions, AgentState } from '../useAgentApp';

export interface ReceiveBagScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/**
 * The tote last-mile: a bus dropped a bag for this shop — one scan shelves every parcel
 * inside and frees the bag for reuse.
 *
 * Then WHERE EACH ONE GOES: the slot every parcel was given, slot by slot in the order the shelf is walked.
 * It stays until the shop says the parcels are in — this is the only moment anybody is holding them.
 */
export function ReceiveBagScreen({ state, actions }: ReceiveBagScreenProps) {
  const t = useT();
  const code = state.receivebag.code;
  const putAway = state.receivebag.putAway;

  if (putAway?.length) {
    return (
      <div class="scr">
        <h1 class="scr__title">{t('agent.receivebag.putAwayTitle')}</h1>
        <p class="scr__lede">{t('agent.receivebag.putAwayLede')}</p>

        <Card>
          <div class="rows" role="list">
            {putAway.map((row) => (
              <div key={row.slot} class="row row--static" role="listitem">
                <span class="row__ic"><Icon name="grid" size={24} /></span>
                <span class="row__body">
                  <span class="row__t">{row.slot}</span>
                  <span class="row__s">{row.parcelIds.join(' · ')}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>

        <div class="scr__cta">
          <Button onClick={() => actions.donePutAway()}>{t('agent.receivebag.putAwayDone')}</Button>
        </div>

        <div class="scr__foot">
          <ReadAloud text={() => putAwayAloud(putAway, t)} label={t('agent.readAloud')} />
        </div>
      </div>
    );
  }

  return (
    <div class="scr">
      <h1 class="scr__title">{t('agent.receivebag.title')}</h1>
      <p class="scr__lede">{t('agent.receivebag.lede')}</p>

      {/* A full shelf says how many the bag holds and what to do about it — the server's own sentence. */}
      {state.error ? <ErrorNote error={state.error} showDetail={state.error.code === 'SHELF_FULL'} /> : null}

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

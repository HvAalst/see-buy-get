import { Button, Card, Checklist, ErrorNote, ReadAloud, ScanField } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { MdpActions, MdpState } from '../useMdpApp';

export interface DropScreenProps {
  state: MdpState;
  actions: MdpActions;
}

/** A bus dropped a bag: one scan empties it — parcels join the queue, the tote frees up. */
export function DropScreen({ state, actions }: DropScreenProps) {
  const t = useT();
  const code = state.form.dropCode;

  return (
    <div class="scr">
      <h1 class="scr__title">{t('mdp.drop.title')}</h1>
      <p class="scr__lede">{t('mdp.drop.lede')}</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      <Card>
        <ScanField
          id="drop-code"
          label={t('mdp.drop.bagCode')}
          value={code}
          onValue={(v) => actions.setForm({ dropCode: v })}
          expect="tote"
          placeholder="BAG-000"
          upper
          enterKeyHint="go"
          onScan={(v) => void actions.submitDrop(v)}
        />
      </Card>

      <div class="scr__cta">
        <Button onClick={() => void actions.submitDrop()} disabled={!code.trim()} busy={state.busy === 'drop'}>
          {t('mdp.drop.empty')}
        </Button>
      </div>

      {state.queue.length ? (
        <Card title={state.queue.length === 1 ? t('mdp.drop.readyOne', { count: state.queue.length }) : t('mdp.drop.readyMany', { count: state.queue.length })}>
          <div class="chips">
            {state.queue.slice(0, 12).map((id) => (
              <span key={id} class="chip mono">
                {id}
              </span>
            ))}
          </div>
          <div style="margin-top:12px">
            <Button chevron onClick={() => actions.go('sort')}>
              {t('mdp.drop.startSorting')}
            </Button>
          </div>
        </Card>
      ) : (
        <Card title={t('mdp.drop.whatHappens')} tone="soft">
          <Checklist items={[t('mdp.drop.item1'), t('mdp.drop.item2'), t('mdp.drop.item3')]} />
        </Card>
      )}

      <div class="scr__foot">
        <ReadAloud
          text={() =>
            state.queue.length
              ? t('mdp.drop.aloudReady', { count: state.queue.length })
              : t('mdp.drop.aloudEmpty')
          }
          label={t('mdp.readAloud')}
        />
      </div>
    </div>
  );
}

import { Button, Card, Checklist, ErrorNote, ReadAloud } from '../../../shared/ui';
import type { MdpActions, MdpState } from '../useMdpApp';

export interface NewToteScreenProps {
  state: MdpState;
  actions: MdpActions;
}

/** Register a fresh laminated tote into this hub's pool; the code is shown for printing. */
export function NewToteScreen({ state, actions }: NewToteScreenProps) {
  const t = state.lastTote;

  return (
    <div class="scr">
      <h1 class="scr__title">New tote</h1>
      <p class="scr__lede">Add a fresh reusable bag to this hub's pool.</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      <Card title="How it works" tone="soft">
        <Checklist items={['The system issues a bag code', 'Print it, laminate it, slot it into the bag pocket', 'The bag starts free and fills as you sort']} />
      </Card>

      <div class="scr__cta">
        <Button onClick={() => void actions.submitNewTote()} busy={state.busy === 'newtote'}>
          Register a tote
        </Button>
      </div>

      {t ? (
        <section class="slotcard" aria-live="polite">
          <p class="slotcard__label">Print and laminate this</p>
          <p class="slotcard__value mono">{t.code}</p>
          <p class="slotcard__sub mono">{t.toteId}</p>
        </section>
      ) : null}

      <div class="scr__foot">
        <ReadAloud
          text={() => (t ? `Tote registered. Print and laminate the code ${t.code}.` : 'Tap register a tote to add a fresh bag to the pool.')}
          label="Read this aloud"
        />
      </div>
    </div>
  );
}

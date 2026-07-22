import { Button, Card, Checklist, ErrorNote, ReadAloud } from '../../../shared/ui';
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
  const code = state.receivebag.code;

  return (
    <div class="scr">
      <h1 class="scr__title">Receive a bag</h1>
      <p class="scr__lede">Scan the code on the bag the driver handed you.</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      <Card>
        <div class="field">
          <label class="field__label" for="bag-code">
            Bag code
          </label>
          <input
            id="bag-code"
            class="input input--mono"
            value={code}
            onInput={(e) => actions.setReceiveBag(e.currentTarget.value)}
            placeholder="BAG-000"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck={false}
            enterkeyhint="go"
          />
        </div>
      </Card>

      <div class="scr__cta">
        <Button onClick={() => void actions.submitReceiveBag()} disabled={!code.trim()} busy={state.busy === 'receivebag'}>
          Receive and shelve
        </Button>
      </div>

      <Card title="What happens" tone="soft">
        <Checklist
          items={['Every parcel inside goes onto your shelf', 'Each customer gets their pickup code', 'The empty bag goes back with the next bus']}
        />
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => 'Scan the bag code. Every parcel inside is shelved and the customers get their pickup codes.'} label="Read this aloud" />
      </div>
    </div>
  );
}

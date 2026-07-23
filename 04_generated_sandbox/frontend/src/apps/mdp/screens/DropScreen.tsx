import { Button, Card, Checklist, ErrorNote, ReadAloud, ScanField } from '../../../shared/ui';
import type { MdpActions, MdpState } from '../useMdpApp';

export interface DropScreenProps {
  state: MdpState;
  actions: MdpActions;
}

/** A bus dropped a bag: one scan empties it — parcels join the queue, the tote frees up. */
export function DropScreen({ state, actions }: DropScreenProps) {
  const code = state.form.dropCode;

  return (
    <div class="scr">
      <h1 class="scr__title">Drop a bag</h1>
      <p class="scr__lede">Scan the code on the bag the bus brought in.</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      <Card>
        <ScanField
          id="drop-code"
          label="Bag code"
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
          Empty this bag
        </Button>
      </div>

      {state.queue.length ? (
        <Card title={`${state.queue.length} parcel${state.queue.length === 1 ? '' : 's'} ready to sort`}>
          <div class="chips">
            {state.queue.slice(0, 12).map((id) => (
              <span key={id} class="chip mono">
                {id}
              </span>
            ))}
          </div>
          <div style="margin-top:12px">
            <Button chevron onClick={() => actions.go('sort')}>
              Start sorting
            </Button>
          </div>
        </Card>
      ) : (
        <Card title="What happens" tone="soft">
          <Checklist items={['The bag is emptied and freed for reuse', 'Every parcel inside joins the sort queue', 'Sort them one scan at a time']} />
        </Card>
      )}

      <div class="scr__foot">
        <ReadAloud
          text={() =>
            state.queue.length
              ? `${state.queue.length} parcels are ready to sort. Tap start sorting.`
              : 'Scan the bag code. The bag is emptied and its parcels join the sort queue.'
          }
          label="Read this aloud"
        />
      </div>
    </div>
  );
}

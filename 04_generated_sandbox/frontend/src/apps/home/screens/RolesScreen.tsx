import { Button, Icon, Pill, ReadAloud } from '../../../shared/ui';
import { ROLES } from '../logic';
import type { HomeActions } from '../useHomeApp';

export interface RolesScreenProps {
  actions: HomeActions;
}

/**
 * Role choice as big tap cards with a pictogram and the PROMISE — the WS-UX rule that
 * this must never be a dropdown, and the franchise formula's "earn on every drop" said in
 * the person's own terms.
 */
export function RolesScreen({ actions }: RolesScreenProps) {
  return (
    <div class="scr">
      <h1 class="scr__title">What are you?</h1>
      <p class="scr__lede">Pick the one that fits. You can join in a few minutes.</p>

      <div class="rows" role="list">
        {ROLES.map((r) => (
          <button key={r.id} type="button" class="row role" onClick={() => actions.startJoin(r.id)}>
            <span class="row__ic">
              <Icon name={r.icon} size={24} />
            </span>
            <span class="row__body">
              <span class="row__t">{r.label}</span>
              <span class="row__s">{r.blurb}</span>
              <span class="role__promise">{r.promise}</span>
            </span>
            <span class="row__end">
              {r.kind === 'invite' ? <Pill tone="idle">By invite</Pill> : null}
              <Icon name="chevronRight" size={22} />
            </span>
          </button>
        ))}
      </div>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.go('welcome')}>
          Go back
        </Button>
        <ReadAloud
          text={() =>
            `Pick what you are. ${ROLES.map((r) => `${r.label}: ${r.promise}`).join(' ')}`
          }
          label="Read the choices aloud"
        />
      </div>
    </div>
  );
}

import { Button, Icon, Pill, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { ROLES, roleMeta } from '../logic';
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
  const t = useT();
  return (
    <div class="scr">
      <h1 class="scr__title">{t('home.roles.title')}</h1>
      <p class="scr__lede">{t('home.roles.lede')}</p>

      <div class="rows" role="list">
        {ROLES.map((r) => {
          const m = roleMeta(r, t);
          return (
            <button key={r.id} type="button" class="row role" onClick={() => actions.startJoin(r.id)}>
              <span class="row__ic">
                <Icon name={r.icon} size={24} />
              </span>
              <span class="row__body">
                <span class="row__t">{m.label}</span>
                <span class="row__s">{m.blurb}</span>
                <span class="role__promise">{m.promise}</span>
              </span>
              <span class="row__end">
                {r.kind === 'invite' ? <Pill tone="idle">{t('home.roles.byInvite')}</Pill> : null}
                <Icon name="chevronRight" size={22} />
              </span>
            </button>
          );
        })}
      </div>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.go('welcome')}>
          {t('home.goBack')}
        </Button>
        <ReadAloud
          text={() =>
            `${t('home.roles.aloudLead')} ${ROLES.map((r) => {
              const m = roleMeta(r, t);
              return t('home.roles.aloudRole', { label: m.label, promise: m.promise });
            }).join(' ')}`
          }
          label={t('home.roles.aloudLabel')}
        />
      </div>
    </div>
  );
}

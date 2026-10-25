import { Icon, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { ROLES, roleMeta } from '../logic';
import type { HomeActions } from '../useHomeApp';

export interface RolesScreenProps {
  actions: HomeActions;
}

/** Where a business signs up: its own app, which opens on the phone step for a browser that knows no number. */
const BUSINESS_APP = '/business/';

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
                <Icon name="chevronRight" size={22} />
              </span>
            </button>
          );
        })}
        {/* A BUSINESS signs up in its own app — a code to the phone, a PIN, then the business — so its card opens that
            app instead of a sign-up here. It was the one kind of account "What are you?" did not offer (2026-10-25). */}
        <a class="row role" href={BUSINESS_APP}>
          <span class="row__ic">
            <Icon name="box" size={24} />
          </span>
          <span class="row__body">
            <span class="row__t">{t('home.role.business.label')}</span>
            <span class="row__s">{t('home.role.business.blurb')}</span>
            <span class="role__promise">{t('home.role.business.promise')}</span>
          </span>
          <span class="row__end">
            <Icon name="chevronRight" size={22} />
          </span>
        </a>
      </div>

      <div class="scr__foot">
        <ReadAloud
          text={() =>
            `${t('home.roles.aloudLead')} ${[
              ...ROLES.map((r) => {
                const m = roleMeta(r, t);
                return t('home.roles.aloudRole', { label: m.label, promise: m.promise });
              }),
              t('home.roles.aloudRole', { label: t('home.role.business.label'), promise: t('home.role.business.promise') }),
            ].join(' ')}`
          }
          label={t('home.roles.aloudLabel')}
        />
      </div>
    </div>
  );
}

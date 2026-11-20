import { Abbreviated } from '../../../shared/ui/Abbr';
import { BrandMark, Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { PartnerActions, PartnerState } from '../usePartnerApp';

/**
 * 2026-11-20 — THE PARTNERS A PERSON IS IN, AND THOSE THEY ARE ASKED TO JOIN (the payments plan, 3c). Only SeeBuyGet's staff
 * add a partner's people, so there is nothing to sign up here: an invitation to answer, a company to open — or, for somebody
 * in none yet, who to ask and which number to give them.
 */
export function ChooseScreen({ state, actions }: { state: PartnerState; actions: PartnerActions }) {
  const t = useT();
  const items = state.memberships ?? [];
  const invited = items.filter((m) => m.state === 'invited');
  const joined = items.filter((m) => m.state === 'joined');
  const error = state.error ? state.error.detail || state.error.title : null;

  return (
    <div class="twr-signin pa-door">
      <div class="twr-signin__card pa-choose">
        <div class="twr-signin__brand">
          <BrandMark size={34} />
          <span class="cons__brandname">{t('partner.app.title')}</span>
        </div>
        <h1 class="cons__title">{t('partner.app.choose.title')}</h1>
        <p class="cons__lede">{t('partner.app.choose.lede')}</p>
        {error ? (
          <p class="cerr">
            <Abbreviated text={error} />
          </p>
        ) : null}

        {invited.length ? (
          <section>
            <h2 class="cons__panelt">{t('partner.app.choose.invitedTitle')}</h2>
            <div class="crows">
              {invited.map((m) => (
                <div class="crow" key={m.memberId}>
                  <span class="crow__body">
                    <span class="crow__top">
                      <span class="crow__name">{m.name}</span>
                    </span>
                    <span class="crow__sub">{t('partner.app.choose.invitedBy', { who: m.invitedBy, country: m.country })}</span>
                  </span>
                  <span class="crow__tail pa-choose__acts">
                    <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={state.busy} onClick={() => void actions.accept(m.memberId)}>
                      {t('partner.app.choose.join')}
                    </button>
                    <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={state.busy} onClick={() => void actions.decline(m.memberId)}>
                      {t('partner.app.choose.decline')}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {joined.length ? (
          <section>
            <h2 class="cons__panelt">{t('partner.app.choose.yoursTitle')}</h2>
            <div class="cdos">
              {joined.map((m) => (
                <button type="button" class="cdo" key={m.memberId} disabled={state.busy} onClick={() => void actions.open(m.entityId)} aria-label={`${t('partner.app.choose.open')} ${m.name}`}>
                  <span class="cdo__body">
                    <span class="cdo__t">{m.name}</span>
                    <span class="cdo__sub">{m.country}</span>
                  </span>
                  <Icon name="chevronRight" size={16} class="cdo__go" />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {!invited.length && !joined.length ? <p class="cons__empty">{t('partner.app.choose.none', { phone: state.phone || '—' })}</p> : null}

        <p class="twr-signin__foot">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={actions.signOut}>
            {t('partner.app.signOut')}
          </button>
        </p>
      </div>
    </div>
  );
}

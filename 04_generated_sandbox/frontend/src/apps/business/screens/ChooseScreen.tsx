import { useState } from 'preact/hooks';
import { BrandMark, Icon } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { publicRequest } from '../../../lib/sbg';
import { CountrySelect, useCountryAtlas } from '../../tower/screens/CountrySelect';
import { businessConfig, type BusinessActivity, type NewBusiness } from '../api';
import { ACTIVITIES, checkTone, newBusinessGaps } from '../logic';
import type { BusinessActions, BusinessState } from '../useBusinessApp';

// The country list is public: somebody setting up a business has no business session yet.
const atlasApi = { countryCatalogue: () => publicRequest(businessConfig(), '/v1/sbg/country-catalogue') };

export const ACTIVITY_LABEL: Record<BusinessActivity, MessageKey> = {
  shipper: 'business.activity.shipper',
  importer: 'business.activity.importer',
  expeditor: 'business.activity.expeditor',
  clearing_agent: 'business.activity.clearing_agent',
  depot: 'business.activity.depot',
};
export const ACTIVITY_SUB: Record<BusinessActivity, MessageKey> = {
  shipper: 'business.activity.shipperSub',
  importer: 'business.activity.importerSub',
  expeditor: 'business.activity.expeditorSub',
  clearing_agent: 'business.activity.clearing_agentSub',
  depot: 'business.activity.depotSub',
};
export const ROLE_LABEL: Record<'owner' | 'booker' | 'finance' | 'viewer', MessageKey> = {
  owner: 'business.role.owner',
  booker: 'business.role.booker',
  finance: 'business.role.finance',
  viewer: 'business.role.viewer',
};
export const CHECK_LABEL: Record<'unverified' | 'asked' | 'checking' | 'verified' | 'refused', MessageKey> = {
  unverified: 'business.check.tag.unverified',
  asked: 'business.check.tag.asked',
  checking: 'business.check.tag.checking',
  verified: 'business.check.tag.verified',
  refused: 'business.check.tag.refused',
};

/**
 * YOUR BUSINESSES — the ones you are in, the ones you are asked to join, and setting a new one up.
 *
 * Shown after signing in whenever there is a choice to make: more than one business and no memory of the last, an
 * invitation waiting (always — an invitation opened over is an invitation unanswered), or none at all yet.
 */
export function ChooseScreen({ state, actions }: { state: BusinessState; actions: BusinessActions }) {
  const t = useT();
  const items = state.memberships ?? [];
  const invited = items.filter((m) => m.state === 'invited');
  const joined = items.filter((m) => m.state === 'joined');
  const [making, setMaking] = useState(items.length === 0);
  const error = state.error ? state.error.detail || state.error.title : null;

  return (
    <div class="twr-signin">
      <div class="twr-signin__card biz-choose">
        <div class="twr-signin__brand">
          <BrandMark size={34} />
          <span class="cons__brandname">{t('business.appTitle')}</span>
        </div>

        {error && !making ? <p class="cerr">{error}</p> : null}

        {invited.length ? (
          <section>
            <h2 class="cons__panelt">{t('business.choose.invitedTitle')}</h2>
            <div class="crows">
              {invited.map((m) => (
                <div class="crow" key={m.memberId}>
                  <span class="crow__body">
                    <span class="crow__top">
                      <span class="crow__name">{m.name}</span>
                      <span class="ctag ctag--info">{t(ROLE_LABEL[m.role])}</span>
                    </span>
                    <span class="crow__sub">{t('business.choose.invitedBy', { who: m.invitedBy, country: m.country })}</span>
                  </span>
                  <span class="crow__tail biz-choose__acts">
                    <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={state.busy} onClick={() => void actions.accept(m.memberId)}>
                      {t('business.choose.join')}
                    </button>
                    <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={state.busy} onClick={() => void actions.decline(m.memberId)}>
                      {t('business.choose.decline')}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {joined.length ? (
          <section>
            <h2 class="cons__panelt">{t('business.choose.yoursTitle')}</h2>
            <div class="cdos">
              {joined.map((m) => (
                <button type="button" class="cdo" key={m.memberId} disabled={state.busy} onClick={() => void actions.open(m.entityId)}>
                  <span class="cdo__body">
                    <span class="cdo__t">{m.name}</span>
                    <span class="cdo__sub">
                      {t(ROLE_LABEL[m.role])} · {m.country} · <span class={`ctag ctag--${checkTone(m.checked)}`}>{t(CHECK_LABEL[m.checked])}</span>
                    </span>
                  </span>
                  <Icon name="chevronRight" size={16} class="cdo__go" />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {making ? (
          <NewBusinessForm state={state} actions={actions} onCancel={items.length ? () => setMaking(false) : undefined} />
        ) : (
          <p class="twr-signin__foot">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setMaking(true)}>
              {t('business.choose.newLink')}
            </button>
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={actions.signOut}>
              {t('business.signOut')}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * SETTING A BUSINESS UP — who it is, where, what it does, and who is setting it up.
 *
 * It works from the moment it is saved. What waits for SeeBuyGet's check (its papers, two members of staff) is being
 * shown to strangers: a public page, a place in the agent finder. The form says so before anybody starts, not after.
 */
function NewBusinessForm({ state, actions, onCancel }: { state: BusinessState; actions: BusinessActions; onCancel?: () => void }) {
  const t = useT();
  const countries = useCountryAtlas(atlasApi);
  const [form, setForm] = useState<NewBusiness>({ name: '', country: '', registrationNo: '', taxNo: '', activities: [], yourName: '' });
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gaps = newBusinessGaps(form);
  const toggle = (a: BusinessActivity) => setForm((f) => ({ ...f, activities: f.activities.includes(a) ? f.activities.filter((x) => x !== a) : [...f.activities, a] }));

  const submit = async (e: Event) => {
    e.preventDefault();
    setTried(true);
    if (gaps.length) return;
    const refused = await actions.create({ ...form, taxNo: form.taxNo?.trim() || undefined });
    setError(refused ? refused.detail || refused.title : null);
  };

  const gap = (field: keyof NewBusiness) => (tried && gaps.includes(field) ? <span class="cerr">{t(`business.new.need.${field}` as MessageKey)}</span> : null);

  return (
    <form onSubmit={(e) => void submit(e)} class="biz-new">
      <h1 class="cons__title">{t('business.new.title')}</h1>
      <p class="cons__lede">{t('business.new.lede')}</p>

      <label class="cfield">
        <span class="cfield__label">{t('business.new.name')}</span>
        <input class="cinput" value={form.name} autocomplete="organization" onInput={(e) => setForm((prev) => ({ ...prev, name: (e.target as HTMLInputElement).value }))} />
        <span class="chint">{t('business.new.nameHint')}</span>
        {gap('name')}
      </label>

      <CountrySelect value={form.country} onChange={(country) => setForm((prev) => ({ ...prev, country }))} label={t('business.new.country')} options={countries} />
      {gap('country')}

      <div class="biz-two">
        <label class="cfield">
          <span class="cfield__label">{t('business.new.registrationNo')}</span>
          <input class="cinput" value={form.registrationNo} onInput={(e) => setForm((prev) => ({ ...prev, registrationNo: (e.target as HTMLInputElement).value }))} />
          {gap('registrationNo')}
        </label>
        <label class="cfield">
          <span class="cfield__label">{t('business.new.taxNo')}</span>
          <input class="cinput" value={form.taxNo} onInput={(e) => setForm((prev) => ({ ...prev, taxNo: (e.target as HTMLInputElement).value }))} />
        </label>
      </div>

      <fieldset class="cfield biz-acts">
        <legend class="cfield__label">{t('business.new.activities')}</legend>
        {ACTIVITIES.map((a) => (
          <label class="cfield--check biz-act" key={a}>
            <input type="checkbox" checked={form.activities.includes(a)} onChange={() => toggle(a)} />
            <span>
              <strong>{t(ACTIVITY_LABEL[a])}</strong>
              <span class="chint">{t(ACTIVITY_SUB[a])}</span>
            </span>
          </label>
        ))}
        {gap('activities')}
      </fieldset>

      <label class="cfield">
        <span class="cfield__label">{t('business.new.yourName')}</span>
        <input class="cinput" value={form.yourName} autocomplete="name" onInput={(e) => setForm((prev) => ({ ...prev, yourName: (e.target as HTMLInputElement).value }))} />
        <span class="chint">{t('business.new.yourNameHint')}</span>
        {gap('yourName')}
      </label>

      <p class="cnote">{t('business.new.checkNote')}</p>
      {error ? <p class="cerr">{error}</p> : null}

      <div class="twr-panelend">
        {onCancel ? (
          <button type="button" class="cbtn cbtn--ghost" onClick={onCancel}>
            {t('common.back')}
          </button>
        ) : (
          <button type="button" class="cbtn cbtn--ghost" onClick={actions.signOut}>
            {t('business.signOut')}
          </button>
        )}
        <button type="submit" class="cbtn cbtn--primary" disabled={state.busy}>
          {t('business.new.cta')}
        </button>
      </div>
    </form>
  );
}

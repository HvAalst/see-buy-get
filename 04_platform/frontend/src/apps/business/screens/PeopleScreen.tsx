import { Abbreviated } from '../../../shared/ui/Abbr';
import { PhoneField } from '../../../shared/ui';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT, type MessageKey } from '../../../shared/i18n';
import type { BusinessClient, BusinessView, MemberRole, MemberRow } from '../api';
import { isLastOwner, mayManage, phoneReady, ROLES } from '../logic';
import type { BusinessActions } from '../useBusinessApp';
import { ROLE_LABEL } from './ChooseScreen';
import { ConsolePick } from '../../tower/ConsolePick';

const ROLE_SUB: Record<MemberRole, MessageKey> = {
  owner: 'business.role.ownerSub',
  booker: 'business.role.bookerSub',
  finance: 'business.role.financeSub',
  viewer: 'business.role.viewerSub',
};

/**
 * THE PEOPLE IN THE BUSINESS — and the only place anybody is added, changed or taken out.
 *
 * Added by the phone number they sign in with. Nothing opens until that person signs in with their own phone and PIN
 * and says yes, so the list shows who is in and who is only invited. Taking somebody out holds from their next click.
 */
export function PeopleScreen({ business, actions, client }: { business: BusinessView; actions: BusinessActions; client: BusinessClient | null }) {
  const t = useT();
  const owner = mayManage(business.you.role);
  const [rows, setRows] = useState<MemberRow[] | null>(null);
  const [form, setForm] = useState<{ phone: string; name: string; role: MemberRole }>({ phone: '', name: '', role: 'booker' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.members();
    if (r.error) return setError(r.error.detail || r.error.title);
    setRows(r.data?.items ?? []);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const invite = async (e: Event) => {
    e.preventDefault();
    if (!client || !phoneReady(form.phone) || !form.name.trim()) return;
    setBusy('invite');
    setError(null);
    const r = await client.invite({ phone: form.phone.trim(), name: form.name.trim(), role: form.role });
    setBusy(null);
    if (r.error) return setError(r.error.detail || r.error.title);
    actions.say(t('business.people.invited', { name: form.name.trim() }));
    setForm({ phone: '', name: '', role: 'booker' });
    await load();
  };

  const setRole = async (memberId: string, role: MemberRole) => {
    if (!client) return;
    setBusy(memberId);
    setError(null);
    const r = await client.setRole(memberId, role);
    setBusy(null);
    if (r.error) return setError(r.error.detail || r.error.title);
    await load();
    // Changing your own role changes what this screen may do.
    if (rows?.find((m) => m.memberId === memberId)?.you) await actions.reloadBusiness();
  };

  const remove = async (row: MemberRow) => {
    if (!client) return;
    setBusy(row.memberId);
    setError(null);
    const r = await client.remove(row.memberId);
    setBusy(null);
    setConfirm(null);
    if (r.error) return setError(r.error.detail || r.error.title);
    if (row.you) return actions.backToList();
    actions.say(t(row.state === 'invited' ? 'business.people.withdrawn' : 'business.people.removed', { name: row.name }));
    await load();
  };

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('business.people.title')}</h1>
        <p class="cons__lede">{t('business.people.lede')}</p>
      </header>

      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}

      <section class="cons__panel">
        {rows === null ? (
          <p class="cons__empty">{t('business.loading')}</p>
        ) : (
          <div class="crows">
            {rows.map((m) => {
              const last = isLastOwner(rows, m.memberId);
              return (
                <div class="crow" key={m.memberId}>
                  <span class="crow__body">
                    <span class="crow__top">
                      <span class="crow__name">{m.you ? t('business.people.you', { name: m.name }) : m.name}</span>
                      {m.state === 'invited' ? <span class="ctag ctag--info">{t('business.people.invitedTag')}</span> : null}
                    </span>
                    <span class="crow__sub">
                      {m.state === 'invited'
                        ? t('business.people.invitedSub', { ends: m.phoneEnds, who: m.invitedBy, when: m.invitedAt.slice(0, 10) })
                        : t('business.people.joinedSub', { when: (m.joinedAt ?? m.invitedAt).slice(0, 10) })}
                    </span>
                  </span>
                  <span class="crow__tail biz-people__acts">
                    {owner ? (
                      // The only owner cannot change their own role: said beneath the list, and the picker is greyed.
                      <ConsolePick
                        bare
                        small
                        label={t('business.people.roleOf', { name: m.name })}
                        value={m.role}
                        disabled={busy !== null || last}
                        options={ROLES.map((r) => ({ value: r, label: t(ROLE_LABEL[r]), sub: t(ROLE_SUB[r]) }))}
                        onChange={(role) => void setRole(m.memberId, role as MemberRole)}
                      />
                    ) : (
                      <span class="ctag ctag--quiet">{t(ROLE_LABEL[m.role])}</span>
                    )}
                    {last ? null : owner || m.you ? (
                      confirm === m.memberId ? (
                        <>
                          <button type="button" class="cbtn cbtn--danger cbtn--sm" disabled={busy !== null} onClick={() => void remove(m)}>
                            {t(m.you ? 'business.people.leaveYes' : m.state === 'invited' ? 'business.people.withdrawYes' : 'business.people.removeYes')}
                          </button>
                          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setConfirm(null)}>
                            {t('common.cancel')}
                          </button>
                        </>
                      ) : (
                        <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy !== null} onClick={() => setConfirm(m.memberId)}>
                          {t(m.you ? 'business.people.leave' : m.state === 'invited' ? 'business.people.withdraw' : 'business.people.remove')}
                        </button>
                      )
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {/* Said once, under the list, rather than as a refusal after somebody tries. */}
        {rows && owner && rows.some((m) => m.you && isLastOwner(rows, m.memberId)) ? <p class="chint">{t('business.people.lastOwner')}</p> : null}
      </section>

      {owner ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('business.people.addTitle')}</span>
          </div>
          <p class="cons__lede">{t('business.people.addLede')}</p>
          <form onSubmit={(e) => void invite(e)}>
            <div class="biz-two">
              <label class="cfield">
                <span class="cfield__label">{t('business.people.phone')}</span>
                <PhoneField
                  id="people-phone"
                  value={form.phone}
                  onInput={(v) => setForm((prev) => ({ ...prev, phone: v }))}
                  autoComplete="off"
                  inputClass="cinput"
                />
              </label>
              <label class="cfield">
                <span class="cfield__label">{t('business.people.name')}</span>
                <input class="cinput" value={form.name} onInput={(e) => setForm((prev) => ({ ...prev, name: (e.target as HTMLInputElement).value }))} />
                <span class="chint">{t('business.people.nameHint')}</span>
              </label>
            </div>
            <fieldset class="cfield biz-acts">
              <legend class="cfield__label">{t('business.people.role')}</legend>
              {ROLES.map((r) => (
                <label class="cfield--check biz-act" key={r}>
                  <input type="radio" name="biz-role" checked={form.role === r} onChange={() => setForm((prev) => ({ ...prev, role: r }))} />
                  <span>
                    <strong>{t(ROLE_LABEL[r])}</strong>
                    <span class="chint">{t(ROLE_SUB[r])}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div class="twr-panelend">
              <button type="submit" class="cbtn cbtn--primary" disabled={busy !== null || !phoneReady(form.phone) || !form.name.trim()}>
                {t('business.people.addCta')}
              </button>
            </div>
          </form>
        </section>
      ) : (
        <p class="chint">{t('business.people.ownerAdds')}</p>
      )}
    </>
  );
}

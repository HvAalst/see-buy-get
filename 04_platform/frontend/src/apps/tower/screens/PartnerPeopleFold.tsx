import { useEffect, useState } from 'preact/hooks';
import { narrow, type Result } from '../../../lib/sbg';
import { useT, type MessageKey, type Translate } from '../../../shared/i18n';
import { ConsoleFold } from '../ConsoleFold';

/**
 * 2026-11-20 — A PARTNER'S OWN PEOPLE, FOR OUR STAFF (the payments plan, 3c; the owner: a separate Partner app). On a partner
 * company's own page: who of its people reads the Partner app, who is invited, who said no or was taken out — added by the
 * number they sign in with and a name, taken out by name. They sign in with their own PIN; we never see it.
 */
export interface PartnerMemberRow {
  memberId: string;
  name: string;
  phoneEnds: string;
  state: 'invited' | 'joined' | 'declined' | 'removed';
  invitedBy: string;
  invitedAt: string;
  joinedAt?: string;
  removedBy?: string;
}

const STATE: Record<PartnerMemberRow['state'], { key: MessageKey; tone: 'ok' | 'info' | 'quiet' }> = {
  joined: { key: 'tower.partner.people.state.joined', tone: 'ok' },
  invited: { key: 'tower.partner.people.state.invited', tone: 'info' },
  declined: { key: 'tower.partner.people.state.declined', tone: 'quiet' },
  removed: { key: 'tower.partner.people.state.removed', tone: 'quiet' },
};
const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');

/** The fold's inside — pure, for the test. */
export function PartnerPeopleBody({ rows, t, busy, onAdd, onRemove }: { rows: PartnerMemberRow[]; t: Translate; busy?: string | null; onAdd?: (phone: string, name: string) => void; onRemove?: (memberId: string) => void }) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const ready = phone.trim().length >= 5 && name.trim().length > 0;
  return (
    <>
      <p class="chint">{t('tower.partner.people.lede')}</p>
      {onAdd ? (
        <div class="twr-knobs__row">
          <input class="cinput cinput--sm" type="tel" inputMode="tel" autoComplete="off" aria-label={t('tower.partner.people.phone')} placeholder={t('tower.partner.people.phone')} value={phone} onInput={(e) => setPhone((e.target as HTMLInputElement).value)} />
          <input class="cinput cinput--sm" maxLength={80} aria-label={t('tower.partner.people.name')} placeholder={t('tower.partner.people.name')} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <button
            type="button"
            class="cbtn cbtn--primary cbtn--sm"
            disabled={!ready || busy === 'add'}
            onClick={() => {
              onAdd(phone.trim(), name.trim());
              setPhone('');
              setName('');
            }}
          >
            {t('tower.partner.people.add')}
          </button>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p class="cons__empty">{t('tower.partner.people.none')}</p>
      ) : (
        <div class="crows">
          {rows.map((m) => (
            <div class="crow" key={m.memberId}>
              <span class="crow__body">
                <span class="crow__top">
                  <span class="crow__name">{m.name}</span>
                  <span class={`ctag ctag--${STATE[m.state].tone}`}>{t(STATE[m.state].key)}</span>
                </span>
                <span class="crow__sub">
                  {m.phoneEnds ? `${t('tower.partner.people.ends', { ends: m.phoneEnds })} · ` : ''}
                  {t('tower.partner.people.addedBy', { by: m.invitedBy, at: when(m.invitedAt) })}
                  {m.removedBy ? ` · ${t('tower.partner.people.removedBy', { by: m.removedBy })}` : ''}
                </span>
              </span>
              {onRemove && (m.state === 'joined' || m.state === 'invited') ? (
                <span class="crow__tail">
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy === m.memberId} onClick={() => onRemove(m.memberId)}>
                    {t('tower.partner.people.takeOut')}
                  </button>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

type Call = () => Promise<Result<unknown>>;

export function PartnerPeopleFold({ entityId, load, add, remove }: { entityId: string; load: (entityId: string) => Promise<Result<unknown>>; add: (entityId: string, phone: string, name: string) => Promise<Result<unknown>>; remove: (entityId: string, memberId: string) => Promise<Result<unknown>> }) {
  const t = useT();
  const [rows, setRows] = useState<PartnerMemberRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const refresh = () => load(entityId).then((r) => setRows(r.error || !r.data ? null : (narrow<PartnerMemberRow[]>(r.data) ?? [])));
  useEffect(() => {
    void refresh();
  }, [entityId]);
  const act = async (key: string, run: Call) => {
    setBusy(key);
    setFailed(null);
    const r = await run();
    setBusy(null);
    if (r.error) setFailed(r.error.detail || r.error.title || t('tower.partner.checks.failed'));
    await refresh();
  };
  if (!rows) return null;
  const inIt = rows.filter((m) => m.state === 'joined').length;
  return (
    <ConsoleFold title={t('tower.partner.people.title')} hint={inIt ? t('tower.partner.people.hintSome', { n: inIt }) : t('tower.partner.people.hintNone')} defaultOpen={false}>
      {failed ? <p class="cerr">{failed}</p> : null}
      <PartnerPeopleBody rows={rows} t={t} busy={busy} onAdd={(phone, name) => void act('add', () => add(entityId, phone, name))} onRemove={(memberId) => void act(memberId, () => remove(entityId, memberId))} />
    </ConsoleFold>
  );
}

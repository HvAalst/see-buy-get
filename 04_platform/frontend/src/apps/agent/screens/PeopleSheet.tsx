import { useEffect, useState } from 'preact/hooks';
import { Button, ErrorNote, Icon, Note, Sheet, PhoneField } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import type { SbgError } from '../../../lib/sbg';
import { actLine, canRemove, staffLine, type CounterActRow, type PeopleApi, type StaffRow } from '../people';

/**
 * THE PEOPLE AT THE COUNTER, for the shop's owner (the user, 2026-10-18: "who is at the counter"). Add a person by their
 * number; they say yes from their own phone + PIN sign-in and work the counter under their own name; take them out and
 * they are signed out at once. "Who did what" is the counter's own record — the owner's, never on a parcel.
 */
export function PeopleSheet({ open, onClose, api, words, statePrefix }: { open: boolean; onClose: () => void; api: PeopleApi | undefined; words?: Partial<Record<MessageKey, MessageKey>>; statePrefix?: string }) {
  const tt = useT();
  // A hub's owner reads the same sheet in a hub's words (its floor, not a counter).
  const t = ((key: MessageKey, params?: Record<string, string | number>) => tt(words?.[key] ?? key, params)) as typeof tt;
  const [view, setView] = useState<'people' | 'log'>('people');
  const [rows, setRows] = useState<StaffRow[] | null>(null);
  const [acts, setActs] = useState<CounterActRow[] | null>(null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);

  const read = async () => {
    if (!api) return;
    const r = await api.list();
    if (r.error) return setError(r.error);
    setRows(r.data ?? []);
  };
  useEffect(() => {
    if (!open) return;
    setView('people');
    setError(null);
    setRows(null);
    void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const add = async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    const r = await api.add(phone, name);
    setBusy(false);
    if (r.error) return setError(r.error);
    setPhone('');
    setName('');
    await read();
  };
  const remove = async (memberId: string) => {
    if (!api) return;
    setBusy(true);
    const r = await api.remove(memberId);
    setBusy(false);
    if (r.error) return setError(r.error);
    await read();
  };
  const showLog = async () => {
    if (!api) return;
    setView('log');
    setActs(null);
    const r = await api.log();
    if (r.error) return setError(r.error);
    setActs(r.data ?? []);
  };
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Sheet open={open} onClose={onClose} title={t(view === 'log' ? 'agent.people.logTitle' : 'agent.people.title')}>
      {error ? <ErrorNote error={error} /> : null}
      {view === 'log' ? (
        <>
          <p class="t-body">{t('agent.people.logLede')}</p>
          {acts === null ? (
            <p class="t-body">{t('common.loading')}</p>
          ) : acts.length === 0 ? (
            <Note tone="info" icon="info" title={t('agent.people.logEmpty')} />
          ) : (
            <div class="rows" role="list">
              {acts.map((a, i) => (
                <div class="row row--static" role="listitem" key={i}>
                  <span class="row__ic">
                    <Icon name={a.staff ? 'person' : 'home'} size={22} />
                  </span>
                  <span class="row__body">
                    <span class="row__t">{actLine(a, t)}</span>
                    <span class="row__s">{when(a.at)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
          <Button variant="link" onClick={() => setView('people')}>
            {t('common.back')}
          </Button>
        </>
      ) : (
        <>
          <p class="t-body">{t('agent.people.lede')}</p>
          {rows === null ? (
            <p class="t-body">{t('common.loading')}</p>
          ) : rows.length ? (
            <div class="rows" role="list">
              {rows.map((r) => (
                <div class="row row--static" role="listitem" key={r.memberId}>
                  <span class="row__ic">
                    <Icon name="person" size={22} />
                  </span>
                  <span class="row__body">
                    <span class="row__t">{r.name}</span>
                    <span class="row__s">{staffLine(r, tt, statePrefix)}</span>
                  </span>
                  {canRemove(r) ? (
                    <span class="row__end">
                      <Button variant="link" full={false} disabled={busy} onClick={() => void remove(r.memberId)}>
                        {t('agent.people.remove')}
                      </Button>
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <Note tone="info" icon="info" title={t('agent.people.none')} />
          )}
          <div class="field">
            <label class="field__label" for="staff-name">
              {t('agent.people.nameLabel')}
            </label>
            <input id="staff-name" class="input" maxLength={60} value={name} disabled={busy} onInput={(e) => setName(e.currentTarget.value)} />
          </div>
          <div class="field">
            <label class="field__label" for="staff-phone">
              {t('agent.people.phoneLabel')}
            </label>
            <PhoneField id="staff-phone" value={phone} onInput={(v) => setPhone(v)} disabled={busy} autoComplete="off" />
          </div>
          <Button chevron={false} busy={busy} disabled={!name.trim() || !phone.trim()} onClick={() => void add()}>
            {t('agent.people.add')}
          </Button>
          <Button variant="outline" chevron={false} onClick={() => void showLog()}>
            {t('agent.people.logCta')}
          </Button>
          <Button variant="link" onClick={onClose}>
            {t('agent.home.notNow')}
          </Button>
        </>
      )}
    </Sheet>
  );
}

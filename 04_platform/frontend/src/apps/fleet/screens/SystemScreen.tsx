import { Abbreviated } from '../../../shared/ui/Abbr';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import type { SbgClient } from '../../../lib/sbg';
import { Button, Card, Chip, ErrorNote, Note } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { POSITION_EVERY, eventWords, messageLine, positionsLines, subjectOf, systemApi, type SystemView } from '../system';
import { keyLine, keysInOrder, keyTitle, type CompanyKey } from '../../../shared/companyKeys';

/**
 * YOUR OWN SYSTEM (the user, round 11: the events recommended; a load's money only where we pay the fleet; where its
 * vehicles are is the fleet's own choice, and its drivers are told; any manager sets it up, under their own name).
 *
 * The fleet's transport system is told each step of its work as this app shows it. Any manager gives the address, and
 * with the first one gets the signing secret, shown once; makes a new secret; turns where its vehicles are on or off and
 * says how often; sends one again, or a test. Each act carries their name, so the other managers see who did it.
 */
export function SystemScreen({ sbg, managerDid }: { sbg: SbgClient | null; managerDid?: string }) {
  const t = useT();
  const api = useMemo(() => (sbg && managerDid ? systemApi(sbg, managerDid) : null), [sbg, managerDid]);
  const [view, setView] = useState<SystemView | null>(null);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmTurn, setConfirmTurn] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const load = useCallback(async () => {
    if (!api) return;
    const r = await api.view();
    if (r.error || !r.data) return setError(r.error);
    setError(null);
    setView(r.data);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!view) return <div class="scr">{error ? <ErrorNote error={error as never} onRetry={() => void load()} /> : <p class="hint">{t('common.loading')}</p>}</div>;

  /** One act: busy while it runs, its refusal said, the screen read again from what came back. */
  const act = async <T,>(key: string, run: () => Promise<{ data?: T | null; error?: unknown }>, then?: (data: T) => void) => {
    setBusy(key);
    setError(null);
    setSaid(null);
    const r = await run();
    setBusy(null);
    if (r.error || !r.data) return setError(r.error);
    then?.(r.data);
  };
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const shown = all ? view.messages : view.messages.slice(0, 10);
  const positions = positionsLines(view.positions, t);

  return (
    <div class="scr">
      <Card title={t('fleet.system.title')}>
        <p class="card__note">{t('fleet.system.lede')}</p>
        {/* The secret, the one time it is shown. */}
        {secret ? (
          <>
            <Note tone="warn" icon="key" title={t('fleet.system.secretOnce')} />
            <p class="system__word">{secret}</p>
          </>
        ) : null}
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(
                'address',
                () => api!.setAddress(url.trim()),
                (v) => {
                  if (v.secret) setSecret(v.secret);
                  setView(v);
                  setEditing(false);
                  setSaid(t(url.trim() ? 'fleet.system.saved' : 'fleet.system.stopped'));
                },
              );
            }}
          >
            <div class="field">
              <label class="field__label" for="system-url">
                {t('fleet.system.address')}
              </label>
              <input id="system-url" class="input input--mono" value={url} placeholder="https://tms.example.com/hooks/seebuyget" autocapitalize="none" spellcheck={false} onInput={(e) => setUrl(e.currentTarget.value)} />
              <p class="hint">{t('fleet.system.addressHint')}</p>
            </div>
            <div class="btnrow">
              <Button type="submit" full={false} busy={busy === 'address'}>
                {t('fleet.system.save')}
              </Button>
              <Button variant="link" full={false} onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <>
            {view.url ? (
              <>
                <p class="card__note">{t('fleet.system.sentTo')}</p>
                <p class="system__word">{view.url}</p>
              </>
            ) : (
              <p class="hint">{t('fleet.system.none')}</p>
            )}
            {view.url && view.setBy ? <p class="hint">{t('fleet.system.setBy', { name: view.setBy, when: when(view.setAt) })}</p> : null}
            {view.hasSecret ? <p class="hint">{t('fleet.system.signed', { name: view.secretTurnedBy ?? '', when: when(view.secretTurnedAt) })}</p> : null}
            <div class="btnrow">
              <Button
                variant={view.url ? 'link' : 'primary'}
                full={false}
                onClick={() => {
                  setUrl(view.url ?? '');
                  setEditing(true);
                }}
              >
                {t(view.url ? 'fleet.system.change' : 'fleet.system.set')}
              </Button>
              {view.url ? (
                <Button
                  variant="link"
                  full={false}
                  busy={busy === 'test'}
                  onClick={() =>
                    void act('test', () => api!.test(), (m) => {
                      setSaid(t(m.state === 'delivered' ? 'fleet.system.arrived' : 'fleet.system.notArrived'));
                      void load();
                    })
                  }
                >
                  {t('fleet.system.test')}
                </Button>
              ) : null}
              {view.hasSecret ? (
                <Button variant="link" full={false} onClick={() => setConfirmTurn((c) => !c)}>
                  {t('fleet.system.turnSecret')}
                </Button>
              ) : null}
            </div>
            {confirmTurn ? (
              <>
                <p class="card__note">{t('fleet.system.turnSecretWarn')}</p>
                <div class="btnrow">
                  <Button
                    full={false}
                    busy={busy === 'secret'}
                    onClick={() =>
                      void act('secret', () => api!.turnSecret(), (v) => {
                        setSecret(v.secret ?? null);
                        setView(v);
                        setConfirmTurn(false);
                      })
                    }
                  >
                    {t('fleet.system.turnSecretConfirm')}
                  </Button>
                  <Button variant="link" full={false} onClick={() => setConfirmTurn(false)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </>
            ) : null}
          </>
        )}
        {said ? <Note tone="ok" icon="check" title={said} /> : null}
        {error ? <ErrorNote error={error as never} showDetail /> : null}
        <p class="hint">{t('fleet.system.anyManager')}</p>
      </Card>

      <Card title={t('fleet.system.pos.title')}>
        <p class="card__note">{t('fleet.system.pos.lede')}</p>
        {positions.map((line, i) => (line.warn ? <Note key={i} tone="warn" icon="warning" title={line.text} /> : <p key={i} class="hint">{line.text}</p>))}
        {view.url ? (
          <div class="chips" role="radiogroup" aria-label={t('fleet.system.pos.title')}>
            {POSITION_EVERY.map((n) => (
              <Chip key={n} label={t('fleet.system.pos.every', { n })} active={view.positions?.everyMin === n} onClick={() => void act(`pos-${n}`, () => api!.setPositions(n), setView)} />
            ))}
            <Chip label={t('fleet.system.pos.turnOff')} active={!view.positions} onClick={() => void act('pos-0', () => api!.setPositions(0), setView)} />
          </div>
        ) : (
          <p class="hint">{t('fleet.system.pos.needsAddress')}</p>
        )}
      </Card>

      <Card title={t('fleet.system.messagesTitle')}>
        {view.messages.length === 0 ? <p class="hint">{view.url ? t('fleet.system.nothingYet') : t('fleet.system.none')}</p> : null}
        {shown.map((m) => {
          const line = messageLine(m, t);
          const subject = subjectOf(m);
          return (
            <div key={m.id} style="margin-top:10px">
              <div class="kv">
                <span>
                  {eventWords(m.event, t)}
                  {subject ? <span class="mono-t"> · {subject}</span> : null}
                </span>
                <b>{when(m.at)}</b>
              </div>
              {line.warn ? <Note tone="warn" icon="warning" title={line.text} /> : <p class="hint">{line.text}</p>}
              {view.url ? (
                <Button
                  variant="link"
                  full={false}
                  busy={busy === m.id}
                  onClick={() =>
                    void act(m.id, () => api!.resend(m.id), (sent) => {
                      setSaid(t(sent.state === 'delivered' ? 'fleet.system.arrived' : 'fleet.system.notArrived'));
                      void load();
                    })
                  }
                >
                  {t('fleet.system.sendAgain')}
                </Button>
              ) : null}
            </div>
          );
        })}
        {!all && view.messages.length > 10 ? (
          <Button variant="link" full={false} onClick={() => setAll(true)}>
            {t('fleet.system.showAll', { n: view.messages.length })}
          </Button>
        ) : null}
      </Card>

      {api ? <KeysCard api={api} /> : null}
    </div>
  );
}

/**
 * KEYS FOR YOUR OWN SYSTEM (round 12: "Post, send in, take at its price"; "Same as the system"). Any manager makes a key —
 * live, or a test key that runs every check and keeps nothing — and sees it once; any manager takes one away; each act
 * under their name. Never the key itself after the answer that made it.
 */
function KeysCard({ api }: { api: ReturnType<typeof systemApi> }) {
  const t = useT();
  const [keys, setKeys] = useState<CompanyKey[] | null>(null);
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    const r = await api.keys();
    if (r.error || !r.data) return setError(r.error);
    setKeys(r.data.items);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!keys) return null;

  const make = async (mode: 'live' | 'test') => {
    setBusy(mode);
    setError(null);
    const r = await api.issueKey(mode, label.trim() || undefined);
    setBusy(null);
    if (r.error || !r.data) return setError(r.error);
    setSecret(r.data.secret);
    setLabel('');
    await load();
  };
  const revoke = async (keyId: string) => {
    setBusy(keyId);
    setError(null);
    const r = await api.revokeKey(keyId);
    setBusy(null);
    setConfirm(null);
    if (r.error) return setError(r.error);
    await load();
  };

  return (
    <Card title={t('fleet.keys.title')}>
      <p class="card__note">{t('fleet.keys.lede')}</p>
      {/* The key, the one time it is shown. */}
      {secret ? (
        <>
          <Note tone="warn" icon="key" title={t('fleet.keys.secretOnce')} />
          <p class="system__word">{secret}</p>
        </>
      ) : null}
      <div class="field">
        <label class="field__label" for="key-label">
          {t('fleet.keys.label')}
        </label>
        <input id="key-label" class="input" value={label} maxLength={60} onInput={(e) => setLabel(e.currentTarget.value)} />
        <p class="hint"><Abbreviated text={t('fleet.keys.labelHint')} /></p>
      </div>
      <div class="btnrow">
        <Button full={false} busy={busy === 'live'} disabled={busy !== null} onClick={() => void make('live')}>
          {t('fleet.keys.makeLive')}
        </Button>
        <Button variant="link" full={false} busy={busy === 'test'} disabled={busy !== null} onClick={() => void make('test')}>
          {t('fleet.keys.makeTest')}
        </Button>
      </div>
      {error ? <ErrorNote error={error as never} showDetail /> : null}
      {keys.length === 0 ? <p class="hint">{t('fleet.keys.none')}</p> : null}
      {keysInOrder(keys).map((k) => (
        <div key={k.keyId} style="margin-top:10px">
          <p class={k.revokedAt ? 'hint' : 'card__note'} style="margin-bottom:0">
            <b>{keyTitle(k, t)}</b>
          </p>
          <p class="hint">{keyLine(k, t)}</p>
          {!k.revokedAt ? (
            confirm === k.keyId ? (
              <>
                <p class="card__note">{t('fleet.keys.revokeWarn')}</p>
                <div class="btnrow">
                  <Button full={false} busy={busy === k.keyId} disabled={busy !== null} onClick={() => void revoke(k.keyId)}>
                    {t('fleet.keys.revokeConfirm')}
                  </Button>
                  <Button variant="link" full={false} onClick={() => setConfirm(null)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </>
            ) : (
              <Button variant="link" full={false} disabled={busy !== null} onClick={() => setConfirm(k.keyId)}>
                {t('fleet.keys.revoke')}
              </Button>
            )
          ) : null}
        </div>
      ))}
      <p class="hint">{t('fleet.keys.anyManager')}</p>
    </Card>
  );
}

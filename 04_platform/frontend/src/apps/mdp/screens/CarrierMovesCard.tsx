import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { createMdpApi, narrow, type SbgClient, type SbgError } from '../../../lib/sbg';
import { useT } from '../../../shared/i18n';
import { Button, Card, ErrorNote, Note, refusalSentence, ScanField, Sheet } from '../../../shared/ui';
import { CARRIER_WAYS_BACK, moveLine, sendBody, type CarrierMovesView, type CarrierMoveView, type CarrierWayBack, type HubCarrierView } from '../carriers';
import type { MdpView } from '../types';

type Api = ReturnType<typeof createMdpApi>;

/**
 * A HUB'S CARRIERS BETWEEN HUBS — on its home (the user, 2026-10-27, D11: "Back with the driver, or abandoned or select
 * separate return trip"; "Post it as a job"). Its own, sent with a driver and how they come back; other hubs', come to it,
 * with what their hub said to do. Its people work the floor; posting a return job, which the hub pays, is its owner's.
 */
export function CarrierMovesCard({ sbg, mdpId, staff, kinds }: { sbg: SbgClient | null; mdpId: string | undefined; staff: boolean; kinds: HubCarrierView[] }) {
  const t = useT();
  const api = useMemo(() => (sbg ? createMdpApi(sbg) : null), [sbg]);
  const [view, setView] = useState<CarrierMovesView | null>(null);
  const [error, setError] = useState<SbgError | null>(null);
  const [sheet, setSheet] = useState<{ kind: 'send' } | { kind: 'countOut' | 'job'; move: CarrierMoveView } | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api || !mdpId) return;
    const r = await api.carrierMoves(mdpId);
    if (r.error) return setError(r.error);
    setView(narrow<CarrierMovesView>(r.data));
  }, [api, mdpId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!view) return error ? <ErrorNote error={error} /> : null;
  const after = (message: string) => {
    setSheet(null);
    setSaid(message);
    void load();
  };
  const doneNow = async (m: CarrierMoveView, count?: number): Promise<string | null> => {
    if (!api || !mdpId) return null;
    const r = await api.carriersDone(mdpId, m.moveId, count);
    if (r.error) return refusalSentence(r.error);
    after(t(`mdp.moves.do.${m.wayBack}` as never));
    return null;
  };

  return (
    <>
      <Card title={t('mdp.moves.title')}>
        <p class="card__note">{t('mdp.moves.lede')}</p>
        {said ? <Note tone="ok" icon="check" title={said} /> : null}
        {view.here.length ? (
          <>
            <h2 class="scr__section">{t('mdp.moves.hereTitle')}</h2>
            <div class="rows" role="list">
              {view.here.map((m) => (
                <div key={m.moveId} class="row row--static" role="listitem">
                  <span class="row__body">
                    <span class="row__t">{t('mdp.moves.what', { count: m.count, name: m.carrierName })}</span>
                    <span class="row__s">{moveLine(m, 'here', t)}</span>
                    {m.state === 'on_the_way' ? (
                      <span class="row__end">
                        <Button
                          variant="outline"
                          full={false}
                          chevron={false}
                          onClick={() => (m.wayBack === 'with_driver' ? setSheet({ kind: 'countOut', move: m }) : void doneNow(m))}
                        >
                          {t(`mdp.moves.do.${m.wayBack}` as never)}
                        </Button>
                      </span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : null}
        <h2 class="scr__section">{t('mdp.moves.awayTitle')}</h2>
        {view.away.length ? (
          <div class="rows" role="list">
            {view.away.map((m) => (
              <div key={m.moveId} class="row row--static" role="listitem">
                <span class="row__body">
                  <span class="row__t">{t('mdp.moves.what', { count: m.count, name: m.carrierName })}</span>
                  <span class="row__s">{moveLine(m, 'away', t)}</span>
                  {m.state === 'kept' ? (
                    staff ? (
                      <span class="row__s">{t('mdp.moves.ownerPosts')}</span>
                    ) : (
                      <span class="row__end">
                        <Button variant="outline" full={false} chevron={false} onClick={() => setSheet({ kind: 'job', move: m })}>
                          {t('mdp.moves.postJob')}
                        </Button>
                      </span>
                    )
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p class="card__note">{t('mdp.moves.none')}</p>
        )}
        {kinds.length ? (
          <div class="btnrow">
            <Button variant="outline" full={false} onClick={() => setSheet({ kind: 'send' })}>
              {t('mdp.moves.send')}
            </Button>
          </div>
        ) : (
          <p class="hint">{t('mdp.moves.noKinds')}</p>
        )}
      </Card>
      {sheet?.kind === 'send' && api && mdpId ? <SendSheet api={api} mdpId={mdpId} kinds={kinds} onClose={() => setSheet(null)} onSent={() => after(t('mdp.moves.sent'))} /> : null}
      {sheet?.kind === 'countOut' ? <CountOutSheet move={sheet.move} onClose={() => setSheet(null)} countOut={(n) => doneNow(sheet.move, n)} /> : null}
      {sheet?.kind === 'job' && api && mdpId ? <JobSheet api={api} mdpId={mdpId} move={sheet.move} onClose={() => setSheet(null)} onPosted={(code) => after(t('mdp.moves.posted', { code }))} /> : null}
    </>
  );
}

/** Carriers going with a driver: which, how many, to which hub, the driver's pass, and how they come back. */
function SendSheet({ api, mdpId, kinds, onClose, onSent }: { api: Api; mdpId: string; kinds: HubCarrierView[]; onClose: () => void; onSent: () => void }) {
  const t = useT();
  const [hubs, setHubs] = useState<MdpView[]>([]);
  const [form, setForm] = useState({ carrierId: kinds[0]?.carrierId ?? '', count: '', toMdpId: '', badge: '', wayBack: 'with_driver' as CarrierWayBack });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void api.mdps().then((r) => {
      if (!r.error) setHubs(narrow<MdpView[]>(r.data).filter((h) => h.mdpId !== mdpId));
    });
  }, [api, mdpId]);

  const send = async () => {
    const made = sendBody(form);
    if ('error' in made) return setProblem(t(made.error as never));
    setProblem(null);
    setBusy(true);
    const r = await api.sendCarriers(mdpId, made.body);
    setBusy(false);
    if (r.error) return setProblem(refusalSentence(r.error));
    onSent();
  };

  return (
    <Sheet open onClose={onClose} title={t('mdp.moves.sendTitle')}>
      <p class="t-body">{t('mdp.moves.sendBody')}</p>
      <div class="field">
        <label class="field__label" for="move-kind">
          {t('mdp.moves.kindLabel')}
        </label>
        <select id="move-kind" class="input" value={form.carrierId} onChange={(e) => setForm({ ...form, carrierId: e.currentTarget.value })}>
          {kinds.map((k) => (
            <option key={k.carrierId} value={k.carrierId}>
              {k.name}
            </option>
          ))}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="move-count">
          {t('mdp.moves.countLabel')}
        </label>
        <input id="move-count" class="input" inputMode="numeric" maxLength={2} value={form.count} onInput={(e) => setForm({ ...form, count: e.currentTarget.value })} />
      </div>
      <div class="field">
        <label class="field__label" for="move-to">
          {t('mdp.moves.toLabel')}
        </label>
        <select id="move-to" class="input" value={form.toMdpId} onChange={(e) => setForm({ ...form, toMdpId: e.currentTarget.value })}>
          <option value="">{t('mdp.moves.toPick')}</option>
          {hubs.map((h) => (
            <option key={h.mdpId} value={h.mdpId}>
              {h.name}
            </option>
          ))}
        </select>
      </div>
      <div class="field" role="radiogroup" aria-labelledby="move-way-label">
        <span id="move-way-label" class="field__label">
          {t('mdp.moves.wayLabel')}
        </span>
        {CARRIER_WAYS_BACK.map((w) => (
          <label class="checkline" key={w}>
            <input type="radio" name="move-way" checked={form.wayBack === w} onChange={() => setForm({ ...form, wayBack: w })} />
            <span>{t(`mdp.moves.wayOpt.${w}` as never)}</span>
          </label>
        ))}
      </div>
      <ScanField id="move-pass" label={t('mdp.moves.passLabel')} value={form.badge} onValue={(v) => setForm({ ...form, badge: v })} expect="badge" placeholder={t('mdp.moves.passScan')} upper />
      {problem ? <Note tone="danger" icon="warning" title={problem} /> : null}
      <Button chevron={false} busy={busy} onClick={() => void send()}>
        {t('mdp.moves.sendYes')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('mdp.moves.notNow')}
      </Button>
    </Sheet>
  );
}

/** Counted back out to the driver who brought them: how many — never more than came. */
function CountOutSheet({ move, onClose, countOut }: { move: CarrierMoveView; onClose: () => void; countOut: (n: number) => Promise<string | null> }) {
  const t = useT();
  const [n, setN] = useState(String(move.count));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    const v = Number(n.trim());
    if (!/^\d+$/.test(n.trim()) || v > move.count) return setProblem(t('mdp.moves.err.countOut', { count: move.count }));
    setBusy(true);
    const refused = await countOut(v);
    setBusy(false);
    if (refused) setProblem(refused);
  };
  return (
    <Sheet open onClose={onClose} title={t('mdp.moves.countOutTitle')}>
      <p class="t-body">{t('mdp.moves.countOutBody', { driver: move.driverName ?? t('mdp.moves.theDriver'), count: move.count })}</p>
      <div class="field">
        <label class="field__label" for="move-out">
          {t('mdp.moves.countOutLabel')}
        </label>
        <input id="move-out" class="input" inputMode="numeric" maxLength={2} value={n} onInput={(e) => setN(e.currentTarget.value)} />
      </div>
      {problem ? <Note tone="danger" icon="warning" title={problem} /> : null}
      <Button chevron={false} busy={busy} onClick={() => void save()}>
        {t('mdp.moves.countOutYes')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('mdp.moves.notNow')}
      </Button>
    </Sheet>
  );
}

/** The return job: what they weigh together — prefilled from what one weighs empty, where the kind says. */
function JobSheet({ api, mdpId, move, onClose, onPosted }: { api: Api; mdpId: string; move: CarrierMoveView; onClose: () => void; onPosted: (code: string) => void }) {
  const t = useT();
  const [kg, setKg] = useState(move.emptyKg ? String(move.emptyKg * move.count) : '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const post = async () => {
    const v = Number(kg.trim());
    if (!/^\d+$/.test(kg.trim()) || v < 1) return setProblem(t('mdp.moves.err.weight'));
    setProblem(null);
    setBusy(true);
    const r = await api.carrierReturnJob(mdpId, move.moveId, v);
    setBusy(false);
    if (r.error) return setProblem(refusalSentence(r.error));
    onPosted(narrow<CarrierMoveView>(r.data).job?.code ?? '');
  };
  return (
    <Sheet open onClose={onClose} title={t('mdp.moves.jobTitle')}>
      <p class="t-body">{t('mdp.moves.jobBody', { hub: move.toName })}</p>
      <div class="field">
        <label class="field__label" for="move-kg">
          {t('mdp.moves.weightLabel')}
        </label>
        <input id="move-kg" class="input" inputMode="numeric" maxLength={5} value={kg} onInput={(e) => setKg(e.currentTarget.value)} />
      </div>
      {problem ? <Note tone="danger" icon="warning" title={problem} /> : null}
      <Button chevron={false} busy={busy} onClick={() => void post()}>
        {t('mdp.moves.jobYes')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('mdp.moves.notNow')}
      </Button>
    </Sheet>
  );
}

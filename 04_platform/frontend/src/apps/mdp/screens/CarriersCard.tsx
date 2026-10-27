import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { createMdpApi, narrow, type SbgClient, type SbgError } from '../../../lib/sbg';
import { useT } from '../../../shared/i18n';
import { Button, Card, ErrorNote, Icon, Note, refusalSentence, Sheet } from '../../../shared/ui';
import { CarrierMovesCard } from './CarrierMovesCard';
import { CARRIER_KINDS, CARRIER_MAX_KINDS, carrierForm, carrierHoldsLine, carrierInput, carrierSizeLine, listWith, type CarrierForm, type CarrierKind, type HubCarriersView, type HubCarrierView } from '../carriers';

/**
 * WHAT THE HUB MOVES BAGS ON TO OTHER HUBS — on the hub's home (D11; the user, 2026-10-27). Its owner says each kind's size
 * and what it may carry; how many parcels each holds comes back worked out, never typed. Its people read it.
 */
export function CarriersCard({ sbg, mdpId, staff }: { sbg: SbgClient | null; mdpId: string | undefined; staff: boolean }) {
  const t = useT();
  const api = useMemo(() => (sbg ? createMdpApi(sbg) : null), [sbg]);
  const [view, setView] = useState<HubCarriersView | null>(null);
  const [error, setError] = useState<SbgError | null>(null);
  // The kind open in the sheet: one on the list, a new one, or none.
  const [editing, setEditing] = useState<HubCarrierView | 'new' | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!api || !mdpId) return;
    const r = await api.carriers(mdpId);
    if (r.error) return setError(r.error);
    setView(narrow<HubCarriersView>(r.data));
  }, [api, mdpId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!view) return error ? <ErrorNote error={error} /> : null;
  const full = view.carriers.length >= CARRIER_MAX_KINDS;

  return (
    <>
      <Card title={t('mdp.carriers.title')}>
        <p class="card__note">{t('mdp.carriers.lede')}</p>
        {saved ? <Note tone="ok" icon="check" title={t('mdp.carriers.saved')} /> : null}
        {view.carriers.length ? (
          <div class="rows" role="list">
            {view.carriers.map((c) => (staff ? <CarrierRow key={c.carrierId} c={c} /> : <CarrierRow key={c.carrierId} c={c} onOpen={() => setEditing(c)} />))}
          </div>
        ) : (
          <p class="t-body">{t('mdp.carriers.none')}</p>
        )}
        {staff ? (
          <p class="hint">{t('mdp.carriers.ownerDecides')}</p>
        ) : full ? (
          <p class="hint">{t('mdp.carriers.full', { n: CARRIER_MAX_KINDS })}</p>
        ) : (
          <div class="btnrow">
            <Button variant="outline" full={false} onClick={() => setEditing('new')}>
              {t('mdp.carriers.add')}
            </Button>
          </div>
        )}
      </Card>
      {/* D11 — its carriers on the move between hubs, and other hubs' come to it. */}
      <CarrierMovesCard sbg={sbg} mdpId={mdpId} staff={staff} kinds={view.carriers} />
      {editing && api && mdpId ? (
        <CarrierSheet
          carrier={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          save={(change) => api.setCarriers(mdpId, listWith(view.carriers, change))}
          onSaved={(next) => {
            setView(next);
            setEditing(null);
            setSaved(true);
          }}
        />
      ) : null}
    </>
  );
}

/** One kind: its name, what it is and its size, and what it holds. The owner opens it to change it; its people only read it. */
function CarrierRow({ c, onOpen }: { c: HubCarrierView; onOpen?: () => void }) {
  const t = useT();
  const body = (
    <>
      <span class="row__ic">
        <Icon name="box" size={24} />
      </span>
      <span class="row__body">
        <span class="row__t">{c.name}</span>
        <span class="row__s">{carrierSizeLine(c, t)}</span>
        <span class="row__s">{carrierHoldsLine(c, t)}</span>
      </span>
    </>
  );
  // A list's item holds the button, so the button stays a button to a screen reader.
  return onOpen ? (
    <div role="listitem">
      <button type="button" class="row" onClick={onOpen}>
        {body}
        <span class="row__end">
          <Icon name="chevronRight" size={22} />
        </span>
      </button>
    </div>
  ) : (
    <div class="row row--static" role="listitem">
      {body}
    </div>
  );
}

type Change = Parameters<typeof listWith>[1];
type SaveResult = ReturnType<ReturnType<typeof createMdpApi>['setCarriers']>;

/** One kind, as its owner says it: what it is, its name, its size and what it may carry — or taking it off the list. */
function CarrierSheet({ carrier, onClose, save, onSaved }: { carrier?: HubCarrierView; onClose: () => void; save: (change: Change) => SaveResult; onSaved: (next: HubCarriersView) => void }) {
  const t = useT();
  const [form, setForm] = useState<CarrierForm>(carrierForm(carrier));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<CarrierForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const send = async (change: Change) => {
    setProblem(null);
    setBusy(true);
    const r = await save(change);
    setBusy(false);
    if (r.error) return setProblem(refusalSentence(r.error));
    onSaved(narrow<HubCarriersView>(r.data));
  };

  const submit = async () => {
    const made = carrierInput(form);
    if ('error' in made) return setProblem(t(made.error as never));
    await send({ put: made.input });
  };

  const size = (id: 'lengthCm' | 'widthCm' | 'heightCm' | 'maxKg' | 'emptyKg', label: string) => (
    <div class="field">
      <label class="field__label" for={`carrier-${id}`}>
        {label}
      </label>
      <input id={`carrier-${id}`} class="input" inputMode="numeric" maxLength={4} value={form[id]} onInput={(e) => set({ [id]: e.currentTarget.value } as Partial<CarrierForm>)} />
    </div>
  );

  return (
    <Sheet open onClose={onClose} title={carrier ? t('mdp.carriers.sheetChange', { name: carrier.name }) : t('mdp.carriers.sheetNew')}>
      <p class="t-body">{t('mdp.carriers.sheetBody')}</p>
      <div class="field">
        <label class="field__label" for="carrier-kind">
          {t('mdp.carriers.kindLabel')}
        </label>
        <select id="carrier-kind" class="input" value={form.kind} onChange={(e) => set({ kind: e.currentTarget.value as CarrierKind })}>
          {CARRIER_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`mdp.carriers.kind.${k}` as never)}
            </option>
          ))}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="carrier-name">
          {t('mdp.carriers.nameLabel')}
        </label>
        <input id="carrier-name" class="input" maxLength={40} value={form.name} onInput={(e) => set({ name: e.currentTarget.value })} />
      </div>
      {size('lengthCm', t('mdp.carriers.lengthLabel'))}
      {size('widthCm', t('mdp.carriers.widthLabel'))}
      {size('heightCm', t('mdp.carriers.heightLabel'))}
      {size('maxKg', t('mdp.carriers.kgLabel'))}
      {size('emptyKg', t('mdp.carriers.emptyLabel'))}
      {problem ? <Note tone="danger" icon="warning" title={problem} /> : null}
      <Button chevron={false} busy={busy} onClick={() => void submit()}>
        {t('mdp.carriers.save')}
      </Button>
      {carrier ? (
        <Button variant="link" disabled={busy} onClick={() => void send({ drop: carrier.carrierId })}>
          {t('mdp.carriers.remove')}
        </Button>
      ) : null}
      <Button variant="link" onClick={onClose}>
        {t('mdp.carriers.keep')}
      </Button>
    </Sheet>
  );
}

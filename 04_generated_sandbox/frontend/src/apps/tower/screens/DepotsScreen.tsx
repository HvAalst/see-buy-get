import { useCallback, useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { TowerActions, TowerState } from '../useTowerApp';

/** One yard as the finder lists it. Counts travel; the container numbers do not. */
export interface DepotRow {
  entityId: string;
  placeLabel: string;
  country: string;
  note?: string;
  saidAt: string;
  saidBy: string;
  saidCount: number;
  derivedCount: number;
  inboundCount: number;
}

export interface DepotLeg {
  containerNo: string;
  legCode: string;
  state: 'posted' | 'moving' | 'arrived';
  at?: string;
  empty: boolean;
}

export interface DepotRegister {
  entityId: string;
  placeLabel: string;
  country: string;
  note?: string;
  closed: boolean;
  said: Array<{ containerNo: string; position?: string; note?: string; at: string; by: string }>;
  derived: DepotLeg[];
  inbound: DepotLeg[];
  inBoth: number;
  basis: string;
}

/**
 * Y4 — A YARD THAT WANTS TO BE FINDABLE, and what is on its way to it.
 *
 * WHAT IS NOT ON THIS SCREEN is the thing worth explaining, because yard management is mainly smart
 * planning and this screen does none of it. Planning answers one question all day — where do I put this
 * box so I do not have to move it twice — and that needs the yard's geometry, the rules that bind a slot
 * to a box (a powered row for a reefer, segregation distances for dangerous goods, tier weights, ground
 * bearing) and the departure order. The first two are a model of a site we have never seen, and a
 * segregation distance we got wrong is advice that hurts somebody.
 *
 * So: the position is the yard's OWN WORDS, recorded and never assigned — and what we bring is the one
 * thing a gate man with a notebook cannot have, which is what is arriving and whether it is empty.
 */
export function DepotsScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const who = state.who?.name;
  const mine = state.who?.entityId;

  const [rows, setRows] = useState<DepotRow[] | null>(null);
  const [register, setRegister] = useState<DepotRegister | null>(null);
  const [form, setForm] = useState({ placeLabel: '', country: '', note: '' });
  const [boxForm, setBoxForm] = useState({ containerNo: '', position: '', note: '' });
  const [find, setFind] = useState({ country: '', q: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const list = await client.api.findDepots(find.country || undefined, find.q || undefined);
    setRows(list.error ? [] : (((list.data as unknown as { items?: DepotRow[] })?.items ?? []) as DepotRow[]));
    // A company that has never said it holds empties has no register, and that is a 404 rather than a
    // failure — the screen then offers the form instead of an error.
    if (mine) {
      const own = await client.api.depotRegister(mine);
      setRegister(own.error ? null : (own.data as unknown as DepotRegister));
    }
  }, [client, mine, find.country, find.q]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, write: () => Promise<{ error?: { detail?: string; title?: string } | null }>, message: string) => {
    setBusy(key);
    setError(null);
    setDone(null);
    const r = await write();
    setBusy(null);
    if (r.error) {
      setError(r.error.detail || r.error.title || 'That did not work');
      return;
    }
    setDone(message);
    await load();
  };

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.depots.title')}</h1>
        <p class="cons__lede">{t('tower.depots.lede')}</p>
      </header>

      {error ? (
        <p class="cons__caveat">
          <Icon name="warning" size={18} /> <span>{error}</span>
        </p>
      ) : null}
      {done ? <p class="cons__lede">{done}</p> : null}

      {/* ---- The yard's own register, when the caller is a yard ---- */}
      {mine && !register ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.depots.declareTitle')}</span>
          </div>
          <p class="cons__lede">{t('tower.depots.declareHint')}</p>
          <div class="twr-knobs">
            <label class="twr-knob">
              <span>{t('tower.depots.f.place')}</span>
              <input value={form.placeLabel} onChange={(e) => setForm({ ...form, placeLabel: (e.target as HTMLInputElement).value })} placeholder={t('tower.depots.f.placePh')} />
            </label>
            <label class="twr-knob">
              <span>{t('tower.depots.f.country')}</span>
              <input maxLength={2} value={form.country} onChange={(e) => setForm({ ...form, country: (e.target as HTMLInputElement).value.toUpperCase() })} placeholder="KE" />
            </label>
            <label class="twr-knob">
              <span>{t('tower.depots.f.note')}</span>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: (e.target as HTMLInputElement).value })} placeholder={t('tower.depots.f.notePh')} />
            </label>
          </div>
          <div class="twr-panelend">
            <button
              type="button"
              class="cbtn"
              disabled={busy === 'declare' || !form.placeLabel.trim() || form.country.length !== 2}
              onClick={() =>
                run(
                  'declare',
                  () => client!.api.declareDepot({ placeLabel: form.placeLabel.trim(), country: form.country, ...(form.note.trim() ? { note: form.note.trim() } : {}), ...(who ? { by: who } : {}) }),
                  t('tower.depots.declared'),
                )
              }
            >
              {t('tower.depots.declare')}
            </button>
          </div>
        </section>
      ) : null}

      {register ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{register.placeLabel}</span>
            <span class="ctag ctag--quiet">{register.country}</span>
            {register.closed ? <span class="ctag ctag--warn">{t('tower.depots.closed')}</span> : null}
          </div>

          {/* THE THREE NUMBERS, AND NEVER A TOTAL. The yard's claim can be stale and our derivation is
              incomplete by construction, so adding them would produce a false inventory. */}
          <p class="cons__lede">
            {t('tower.depots.counts', { said: register.said.length, derived: register.derived.length, both: register.inBoth })}
          </p>
          <p class="cons__lede">{register.basis}</p>

          {/* WHAT IS ON ITS WAY — the half a notebook cannot have, and the only planning help we offer. */}
          <div class="cons__gate">
            <div class="cons__gatehead">
              <span class="cons__gatet">{t('tower.depots.inbound')}</span>
              {register.inbound.length ? <span class="ctag ctag--quiet">{register.inbound.length}</span> : null}
            </div>
            {register.inbound.length === 0 ? (
              <p class="cons__lede">{t('tower.depots.inboundNone')}</p>
            ) : (
              <div class="ctbl">
                {register.inbound.map((l) => (
                  <div key={l.containerNo} class="ctbl__row">
                    <span class="ctbl__k">{l.containerNo}</span>
                    <span class="ctbl__v">
                      {t(`tower.depots.leg.${l.state}` as never, { code: l.legCode })}
                      <span class="ctbl__sub">{l.empty ? t('tower.depots.legEmpty') : t('tower.depots.legLaden')}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* WHAT THE YARD SAYS IS STANDING THERE, with the position in their own handwriting. */}
          <div class="cons__gate">
            <div class="cons__gatehead">
              <span class="cons__gatet">{t('tower.depots.said')}</span>
            </div>
            {register.said.length === 0 ? (
              <p class="cons__lede">{t('tower.depots.saidNone')}</p>
            ) : (
              <div class="ctbl">
                {register.said.map((s) => (
                  <div key={s.containerNo} class="ctbl__row">
                    <span class="ctbl__k">{s.containerNo}</span>
                    <span class="ctbl__v">
                      {s.position || t('tower.depots.noPosition')}
                      <span class="ctbl__sub">
                        {t('tower.depots.saidBy', { by: s.by, d: s.at.slice(0, 10) })}
                        {s.note ? ` · ${s.note}` : ''}
                      </span>
                    </span>
                    <button type="button" class="cbtn cbtn--ghost" disabled={busy === `gone-${s.containerNo}`} onClick={() => run(`gone-${s.containerNo}`, () => client!.api.depotBoxGone(register.entityId, s.containerNo), t('tower.depots.goneSaved'))}>
                      {t('tower.depots.gone')}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div class="twr-knobs">
              <label class="twr-knob">
                <span>{t('tower.depots.f.containerNo')}</span>
                <input maxLength={13} value={boxForm.containerNo} onChange={(e) => setBoxForm({ ...boxForm, containerNo: (e.target as HTMLInputElement).value.toUpperCase() })} placeholder="MSCU1234566" />
              </label>
              {/* THEIR words. We record a position; we never assign one — see the screen's own comment. */}
              <label class="twr-knob">
                <span>{t('tower.depots.f.position')}</span>
                <input maxLength={60} value={boxForm.position} onChange={(e) => setBoxForm({ ...boxForm, position: (e.target as HTMLInputElement).value })} placeholder={t('tower.depots.f.positionPh')} />
              </label>
            </div>
            <div class="twr-panelend">
              <button
                type="button"
                class="cbtn"
                disabled={busy === 'say' || boxForm.containerNo.trim().length < 11}
                onClick={() =>
                  run(
                    'say',
                    () =>
                      client!.api.depotBoxHere(register.entityId, {
                        containerNo: boxForm.containerNo.trim(),
                        ...(boxForm.position.trim() ? { position: boxForm.position.trim() } : {}),
                        ...(who ? { by: who } : {}),
                      }),
                    t('tower.depots.saidSaved'),
                  )
                }
              >
                {t('tower.depots.say')}
              </button>
            </div>
            <p class="cons__lede">{t('tower.depots.positionHint')}</p>
          </div>

          {/* WHAT WE DERIVED — legs that ended here. Incomplete by construction, and it says so. */}
          <div class="cons__gate">
            <div class="cons__gatehead">
              <span class="cons__gatet">{t('tower.depots.derived')}</span>
            </div>
            {register.derived.length === 0 ? (
              <p class="cons__lede">{t('tower.depots.derivedNone')}</p>
            ) : (
              <div class="ctbl">
                {register.derived.map((l) => (
                  <div key={l.containerNo} class="ctbl__row">
                    <span class="ctbl__k">{l.containerNo}</span>
                    <span class="ctbl__v">
                      {t('tower.depots.arrivedOn', { code: l.legCode, d: (l.at ?? '').slice(0, 10) })}
                      <span class="ctbl__sub">{l.empty ? t('tower.depots.legEmpty') : t('tower.depots.legLaden')}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!register.closed ? (
            <div class="twr-panelend">
              <button type="button" class="cbtn cbtn--ghost" disabled={busy === 'close'} onClick={() => run('close', () => client!.api.closeDepot(register.entityId, who), t('tower.depots.closedSaved'))}>
                {t('tower.depots.close')}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ---- The finder: which yards exist, and what each SAYS it holds ---- */}
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.depots.findTitle')}</span>
          {rows ? <span class="ctag ctag--quiet">{rows.length}</span> : null}
        </div>
        <p class="cons__lede">{t('tower.depots.findHint')}</p>
        <div class="twr-knobs">
          <label class="twr-knob">
            <span>{t('tower.depots.f.country')}</span>
            <input maxLength={2} value={find.country} onChange={(e) => setFind({ ...find, country: (e.target as HTMLInputElement).value.toUpperCase() })} placeholder="KE" />
          </label>
          <label class="twr-knob">
            <span>{t('tower.depots.f.search')}</span>
            <input value={find.q} onChange={(e) => setFind({ ...find, q: (e.target as HTMLInputElement).value })} placeholder={t('tower.depots.f.searchPh')} />
          </label>
        </div>

        {rows && rows.length === 0 ? <p class="cons__lede">{t('tower.depots.findNone')}</p> : null}
        {rows?.map((d) => (
          <div key={d.entityId} class="ctbl">
            <div class="ctbl__row">
              <span class="ctbl__k">{d.placeLabel}</span>
              <span class="ctbl__v">
                {t('tower.depots.rowCounts', { said: d.saidCount, inbound: d.inboundCount })}
                <span class="ctbl__sub">
                  {d.country}
                  {d.note ? ` · ${d.note}` : ''}
                  {` · ${t('tower.depots.rowSaidBy', { by: d.saidBy, d: d.saidAt.slice(0, 10) })}`}
                </span>
              </span>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}

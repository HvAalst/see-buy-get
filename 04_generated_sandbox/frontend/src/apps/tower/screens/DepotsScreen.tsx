import { useCallback, useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { ContactCardPanel, type ContactCardView } from './ContactCardPanel';
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
  /** How to reach them — their own entry. A finder without it tells you to ring nobody. */
  contact?: ContactCardView;
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
  contact?: ContactCardView;
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
  /*
   * NO FREE-TEXT "anything a haulier should know" HERE, and the user's reason is the right one: it is a
   * leading question. A box that suggests "gate open 6am to 6pm, reach stacker on site" is us deciding
   * what matters and then pretending the yard said it. If we need the hours, we ask for the hours — and
   * we do, as their own fields on the entry below.
   */
  const [form, setForm] = useState({ placeLabel: '', country: '' });
  const [boxForm, setBoxForm] = useState({ containerNo: '', position: '', note: '' });
  const [find, setFind] = useState({ country: '', q: '' });
  /**
   * The declare form is SHUT until somebody asks for it.
   *
   * Every company administrator opening this screen was being invited to say they hold empties, which is
   * noise in the account of an importer who came here to find a yard. A screen that asks everybody the
   * question only one reader has is how a console fills up with text nobody needs.
   */
  const [declaring, setDeclaring] = useState(false);
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
      {mine && !register && !declaring ? (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost" onClick={() => setDeclaring(true)}>
            {t('tower.depots.declareTitle')}
          </button>
        </div>
      ) : null}

      {mine && !register && declaring ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.depots.declareTitle')}</span>
          </div>
          <p class="chint">{t('tower.depots.declareHint')}</p>
          <div class="twr-knobs__row">
            <label class="twr-knob cfield">
              <span class="cfield__label">{t('tower.depots.f.place')}</span>
              <input class="cinput" value={form.placeLabel} onChange={(e) => setForm({ ...form, placeLabel: (e.target as HTMLInputElement).value })} placeholder={t('tower.depots.f.placePh')} />
            </label>
            <label class="twr-knob cfield">
              <span class="cfield__label">{t('tower.depots.f.country')}</span>
              <input class="cinput" maxLength={2} value={form.country} onChange={(e) => setForm({ ...form, country: (e.target as HTMLInputElement).value.toUpperCase() })} placeholder="KE" />
            </label>
          </div>
          <div class="twr-panelend">
            <button
              type="button"
              class="cbtn cbtn--primary"
              disabled={busy === 'declare' || !form.placeLabel.trim() || form.country.length !== 2}
              onClick={() =>
                run(
                  'declare',
                  () => client!.api.declareDepot({ placeLabel: form.placeLabel.trim(), country: form.country, ...(who ? { by: who } : {}) }),
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
          <p class="cons__lede">{t('tower.depots.counts', { said: register.said.length, derived: register.derived.length, both: register.inBoth })}</p>
          {/* The basis sits UNDER the numbers as a hint rather than as a second paragraph of argument. */}
          <p class="chint">{register.basis}</p>

          {/* WHAT IS ON ITS WAY — the half a notebook cannot have, and the only planning help we offer. */}
          <div class="cons__gate">
            <div class="cons__gatehead">
              <span class="cons__gatet">{t('tower.depots.inbound')}</span>
              {register.inbound.length ? <span class="ctag ctag--quiet">{register.inbound.length}</span> : null}
            </div>
            {register.inbound.length === 0 ? (
              <p class="chint">{t('tower.depots.inboundNone')}</p>
            ) : (
              <div class="cons__facts">
                {register.inbound.map((l) => (
                  <div key={l.containerNo} class="cons__fact">
                    <span class="cons__factk">{l.containerNo}</span>
                    <span class="cons__factv">
                      {t(`tower.depots.leg.${l.state}` as never, { code: l.legCode })}
                      <span class="chint">{l.empty ? t('tower.depots.legEmpty') : t('tower.depots.legLaden')}</span>
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
              <p class="chint">{t('tower.depots.saidNone')}</p>
            ) : (
              <div class="cons__facts">
                {register.said.map((s) => (
                  <div key={s.containerNo} class="cons__fact">
                    <span class="cons__factk">{s.containerNo}</span>
                    <span class="cons__factv">
                      {s.position || t('tower.depots.noPosition')}
                      <span class="chint">
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

            <div class="twr-knobs__row">
              <label class="twr-knob cfield">
                <span class="cfield__label">{t('tower.depots.f.containerNo')}</span>
                <input class="cinput" maxLength={13} value={boxForm.containerNo} onChange={(e) => setBoxForm({ ...boxForm, containerNo: (e.target as HTMLInputElement).value.toUpperCase() })} placeholder="MSCU1234566" />
              </label>
              {/* THEIR words. We record a position; we never assign one — see the screen's own comment. */}
              <label class="twr-knob cfield">
                <span class="cfield__label">{t('tower.depots.f.position')}</span>
                <input class="cinput" maxLength={60} value={boxForm.position} onChange={(e) => setBoxForm({ ...boxForm, position: (e.target as HTMLInputElement).value })} placeholder={t('tower.depots.f.positionPh')} />
              </label>
            </div>
            <div class="twr-panelend">
              <button
                type="button"
                class="cbtn cbtn--primary"
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
            <p class="chint">{t('tower.depots.positionHint')}</p>
          </div>

          {/* WHAT WE DERIVED — legs that ended here. Incomplete by construction, and it says so. */}
          <div class="cons__gate">
            <div class="cons__gatehead">
              <span class="cons__gatet">{t('tower.depots.derived')}</span>
            </div>
            {register.derived.length === 0 ? (
              <p class="chint">{t('tower.depots.derivedNone')}</p>
            ) : (
              <div class="cons__facts">
                {register.derived.map((l) => (
                  <div key={l.containerNo} class="cons__fact">
                    <span class="cons__factk">{l.containerNo}</span>
                    <span class="cons__factv">
                      {t('tower.depots.arrivedOn', { code: l.legCode, d: (l.at ?? '').slice(0, 10) })}
                      <span class="chint">{l.empty ? t('tower.depots.legEmpty') : t('tower.depots.legLaden')}</span>
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

      {/* THE YARD'S OWN ENTRY — how to reach them, beside the register they keep. One card per company:
          the same panel a clearing agent edits, because it is the same entry. */}
      {register ? <ContactCardPanel entityId={register.entityId} who={who} client={client as never} /> : null}

      {/* ---- The finder: which yards exist, and what each SAYS it holds ---- */}
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.depots.findTitle')}</span>
          {rows ? <span class="ctag ctag--quiet">{rows.length}</span> : null}
        </div>
        <p class="chint">{t('tower.depots.findHint')}</p>
        <div class="twr-knobs__row">
          <label class="twr-knob cfield">
            <span class="cfield__label">{t('tower.depots.f.country')}</span>
            <input class="cinput" maxLength={2} value={find.country} onChange={(e) => setFind({ ...find, country: (e.target as HTMLInputElement).value.toUpperCase() })} placeholder="KE" />
          </label>
          <label class="twr-knob cfield">
            <span class="cfield__label">{t('tower.depots.f.search')}</span>
            <input class="cinput" value={find.q} onChange={(e) => setFind({ ...find, q: (e.target as HTMLInputElement).value })} placeholder={t('tower.depots.f.searchPh')} />
          </label>
        </div>

        {rows && rows.length === 0 ? <p class="cons__empty">{t('tower.depots.findNone')}</p> : null}
        {rows && rows.length > 0 ? (
          <table class="ctbl">
            <thead>
              <tr>
                <th>{t('tower.depots.col.yard')}</th>
                <th>{t('tower.depots.col.holding')}</th>
                <th>{t('tower.depots.col.reach')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.entityId}>
                  <td>
                    <span class="ctbl__strong">{d.placeLabel}</span>
                    <span class="chint">
                      {d.country}
                      {d.note ? ` · ${d.note}` : ''}
                    </span>
                  </td>
                  <td>
                    {t('tower.depots.rowCounts', { said: d.saidCount, inbound: d.inboundCount })}
                    <span class="chint">{t('tower.depots.rowSaidBy', { by: d.saidBy, d: d.saidAt.slice(0, 10) })}</span>
                  </td>
                  {/* HOW TO REACH THEM — the finder's whole purpose, and the column it first shipped
                      without. A yard with no entry says so rather than looking like one nobody rings. */}
                  <td>
                    {d.contact ? (
                      <>
                        {d.contact.phone ?? d.contact.email ?? d.contact.website ?? '—'}
                        <span class="chint">
                          {[d.contact.contactName, d.contact.phoneAlt, d.contact.hours, d.contact.address].filter(Boolean).join(' · ')}
                        </span>
                      </>
                    ) : (
                      <span class="chint">{t('tower.depots.noContact')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </>
  );
}

import { useCallback, useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { ContactCardPanel, type ContactCardView } from './ContactCardPanel';
import { ConsoleAction } from '../ConsoleAction';
import { CountrySelect, useCountryAtlas } from './CountrySelect';
import { YardSheet } from './YardSheet';
import { initials } from '../ConsoleMenu';
import { PlaceMap } from '../../../shared/ui';
import type { GeoPoint } from '../../../shared/geo';
import type { TowerActions, TowerState } from '../useTowerApp';

/** One yard as the finder lists it. Counts travel; the container numbers do not. */
export interface DepotRow {
  /** Where it is, and HOW WELL WE KNOW: a pin the yard dropped, or their name resolved to a town. */
  location?: GeoPoint;
  locationFrom?: 'pin' | 'name';
  /** Two sources kept apart, and neither is an inventory. Printed verbatim wherever the counts are. */
  basis: string;
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
  /*
   * THE CONTACT DETAILS ARE PART OF DECLARING, not a separate errand.
   *
   * A yard could say it holds empties and publish no way of being reached, and the finder's whole
   * purpose is somewhere to ring — so the listing it produced was one nobody could use. The user, on
   * the declare form: "has no input fields on how you can be reached. confusing." Asked here, once, at
   * the moment somebody is putting themselves on a list.
   */
  const [form, setForm] = useState<{ placeLabel: string; country: string; phone: string; email: string; hours: string; pin: GeoPoint | null }>({
    placeLabel: '',
    country: '',
    phone: '',
    email: '',
    hours: '',
    pin: null,
  });
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

  const run = async (key: string, write: () => Promise<{ error?: { detail?: string; title?: string } | null }>, message: string, after?: () => void) => {
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
    after?.();
    await load();
  };

  const [openYard, setOpenYard] = useState<DepotRow | null>(null);

  const atlas = useCountryAtlas(client?.api as never);
  /* The countries that actually have yards, out of the answer itself — never a menu of empty answers. */
  const withYards = [...new Map((rows ?? []).map((d) => [d.country, { code: d.country, name: atlas.find((c) => c.code === d.country)?.name ?? d.country }])).values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

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
          <div class="cdos">
            <ConsoleAction title={t('tower.depots.declareTitle')} hint={t('tower.depots.declareHint')}>
              {(close) => (
                <>
                  <label class="cfield">
                    <span class="cfield__label">{t('tower.depots.f.place')}</span>
                    <input class="cinput" value={form.placeLabel} onChange={(e) => setForm({ ...form, placeLabel: (e.target as HTMLInputElement).value })} placeholder={t('tower.depots.f.placePh')} />
                  </label>
                  {/* The ATLAS: a yard may stand anywhere, and refusing a real one because the network
                      is not there yet would be absurd. */}
                  <CountrySelect value={form.country} onChange={(country) => setForm({ ...form, country })} label={t('tower.depots.f.country')} options={atlas} />
                  <label class="cfield">
                    <span class="cfield__label">{t('tower.contact.f.phone')}</span>
                    <input class="cinput" value={form.phone} onChange={(e) => setForm({ ...form, phone: (e.target as HTMLInputElement).value })} placeholder="+254 712 345 678" />
                  </label>
                  <label class="cfield">
                    <span class="cfield__label">{t('tower.contact.f.email')}</span>
                    <input class="cinput" value={form.email} onChange={(e) => setForm({ ...form, email: (e.target as HTMLInputElement).value })} placeholder="gate@example.com" />
                  </label>
                  <label class="cfield">
                    <span class="cfield__label">{t('tower.contact.f.hours')}</span>
                    <input class="cinput" value={form.hours} onChange={(e) => setForm({ ...form, hours: (e.target as HTMLInputElement).value })} placeholder={t('tower.contact.f.hoursPh')} />
                  </label>
                  {/* THE GATE, dropped by the only people who know where it is. Without this the finder
                      can only resolve the yard's NAME to the middle of a town, which is a direction
                      rather than an address. Optional, because a yard that will not is still a yard. */}
                  <div class="cfield">
                    <span class="cfield__label">{t('tower.depots.f.pin')}</span>
                    <PlaceMap onDrop={(p) => setForm({ ...form, pin: p })} dropped={form.pin} label={t('tower.depots.f.pinLabel')} />
                    <span class="chint">{form.pin ? t('tower.sites.pinAt', { lat: form.pin.lat.toFixed(4), lng: form.pin.lng.toFixed(4) }) : t('tower.depots.f.pinNone')}</span>
                  </div>
                  <p class="chint">{t('tower.depots.reachHint')}</p>
                  <div class="twr-panelend">
                    <button
                      type="button"
                      class="cbtn cbtn--primary"
                      disabled={busy === 'declare' || !form.placeLabel.trim() || form.country.length !== 2 || !form.phone.trim()}
                      onClick={() =>
                        run(
                          'declare',
                          async () => {
                            const made = await client!.api.declareDepot({
                              placeLabel: form.placeLabel.trim(),
                              country: form.country,
                              ...(form.pin ? { location: form.pin } : {}),
                              ...(who ? { by: who } : {}),
                            });
                            if (made.error) return made;
                            /*
                             * ONE ACT, TWO WRITES. Being listed and being reachable are the same
                             * decision, so the second call is not a step somebody can forget: a yard on
                             * the finder with no number on it is a row that wastes a haulier's morning.
                             */
                            return (client!.api as never as { setContactCard: (id: string, body: Record<string, string>) => Promise<{ error?: { detail?: string; title?: string } | null }> }).setContactCard(mine, {
                              phone: form.phone.trim(),
                              email: form.email.trim(),
                              hours: form.hours.trim(),
                              ...(who ? { by: who } : {}),
                            });
                          },
                          t('tower.depots.declared'),
                          close,
                        )
                      }
                    >
                      {t('tower.depots.declare')}
                    </button>
                  </div>
                </>
              )}
            </ConsoleAction>
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

            {/* A form behind a click opens in a sheet, like every other on this surface. */}
            <div class="cdos">
              <ConsoleAction title={t('tower.depots.say')} hint={t('tower.depots.positionHint')}>
                {(close) => (
                  <>
                    <label class="cfield">
                      <span class="cfield__label">{t('tower.depots.f.containerNo')}</span>
                      <input class="cinput" maxLength={13} value={boxForm.containerNo} onChange={(e) => setBoxForm({ ...boxForm, containerNo: (e.target as HTMLInputElement).value.toUpperCase() })} placeholder="MSCU1234566" />
                    </label>
                    {/* THEIR words. We record a position; we never assign one — see the screen's own comment. */}
                    <label class="cfield">
                      <span class="cfield__label">{t('tower.depots.f.position')}</span>
                      <input class="cinput" maxLength={60} value={boxForm.position} onChange={(e) => setBoxForm({ ...boxForm, position: (e.target as HTMLInputElement).value })} placeholder={t('tower.depots.f.positionPh')} />
                    </label>
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
                            () => {
                              setBoxForm({ containerNo: '', position: '', note: '' });
                              close();
                            },
                          )
                        }
                      >
                        {t('tower.depots.say')}
                      </button>
                    </div>
                  </>
                )}
              </ConsoleAction>
            </div>
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
        {/*
          * ONE SEARCH AND A COUNTRY LIST — not two labelled boxes over a three-column table. The
          * countries offered are the ones that ACTUALLY HAVE YARDS, derived from the answer: a filter
          * that can empty its own list is a wall, and there is no sense offering Mongolia.
          */}
        <div class="twr-knobs__row">
          <label class="twr-knob cfield">
            <span class="cfield__label">{t('tower.depots.f.search')}</span>
            <input class="cinput" value={find.q} onChange={(e) => setFind({ ...find, q: (e.target as HTMLInputElement).value })} placeholder={t('tower.depots.f.searchPh')} />
          </label>
          <div class="twr-knob">
            <CountrySelect value={find.country} onChange={(country) => setFind({ ...find, country })} label={t('tower.depots.f.country')} options={withYards} anyLabel={t('tower.depots.anywhere')} />
          </div>
        </div>
        <p class="chint">{t('tower.depots.findHint')}</p>

        {rows && rows.length === 0 ? <p class="cons__empty">{t('tower.depots.findNone')}</p> : null}
        {rows && rows.length > 0 ? (
          /*
            * A NAME, A COUNTRY AND AN ARROW. The row carried the counts, who said so and when, the
            * telephone, the hours and a contact name — four lines to read past before comparing this
            * yard with the next. All of it is one tap away and none of it helps you choose which yard
            * to open, which is the only question a list answers.
            */
          <div class="crows">
            {rows.map((d) => (
              <button key={d.entityId} type="button" class="crow" onClick={() => setOpenYard(d)}>
                {/* Initials, the same avatar the account menu uses: something to recognise a yard by
                    at a glance, in a list somebody scrolls. */}
                <span class="cmenu__face" aria-hidden="true">
                  {initials(d.placeLabel)}
                </span>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">{d.placeLabel}</span>
                    <span class="ctag ctag--quiet">{d.country}</span>
                  </span>
                </span>
                <span class="crow__tail">
                  <Icon name="chevronRight" size={16} />
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {openYard ? <YardSheet yard={openYard} onClose={() => setOpenYard(null)} /> : null}
      </section>
    </>
  );
}

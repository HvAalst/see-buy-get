import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT, type MessageKey, type Translate } from '../../../shared/i18n';
import { EntityPicker } from './EntityPicker';
import {
  coverFormError,
  coverFormOf,
  coverPayload,
  isOwnedHere,
  laneLabel,
  originLabel,
  pctLabel,
  pctText,
  rateFormError,
  rateFormOf,
  ratesPayload,
  taxFormError,
  taxFormOf,
  taxPayload,
  topUpFeeFormError,
  topUpFeeFormOf,
  topUpFeePayload,
  type CoverForm,
  type EntityPricing,
  type LanePricing,
  type RateForm,
  type TaxForm,
  type TopUpFeeForm,
} from '../money';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * What each sister charges — the three rate layers, the tax it collects, and the cover it carries.
 *
 * THE SPLIT IS INTERNAL. A buyer sees a price; a merchant sees one platform fee; only this screen sees
 * that the fee is a cost of risk plus a return for carrying it plus a margin. The separation exists so
 * somebody can answer "are we earning because the market is good, or because we are carrying risk nobody
 * is paying for" — a question a single blended percentage cannot be asked.
 *
 * The table's real subject is INHERITANCE. Every number here resolves through fallbacks, so two lanes
 * showing 2% can be two completely different situations: one a decision, the other the absence of one.
 * Only one of them moves when the default moves, so every cell says which it is.
 */
export function RatesScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const pricing = state.pricing;

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.rates.title')}</h1>
        <p class="cons__lede">{t('tower.rates.lede')}</p>
      </header>

      <p class="cons__caveat">
        <Icon name="lock" size={18} />
        <span>
          <b>{t('tower.rates.caveatLead')}</b> {t('tower.rates.caveat')}
        </span>
      </p>

      <EntityPicker
        entities={state.entities ?? []}
        chosen={state.entityId}
        onChoose={(id) => void actions.chooseEntity(id)}
        label={t('tower.rates.pickSister')}
      />

      {state.error ? (
        <p class="cerr" style="max-width:96ch">
          <b>{t('tower.rates.failedTitle')}</b> — {state.error.detail || state.error.title}
        </p>
      ) : null}

      {!pricing ? (
        <p class="cons__empty">{t('tower.rates.loading')}</p>
      ) : (
        <>
          {/* A company that cannot transact gets the explanation and NOTHING ELSE. The resolution still
              answers for it — every fallback ends at the network default — so a table here would show the
              mother company charging 2%% under a paragraph saying it charges nothing. The numbers are real
              and the row would be a lie. */}
          {!pricing.transacting ? (
            <p class="cons__caveat">
              <Icon name="info" size={18} />
              <span>
                <b>{t('tower.rates.groupLead', { name: pricing.name })}</b> {t('tower.rates.groupBody')}
              </span>
            </p>
          ) : (
          <>
          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.rates.whatItCharges', { name: pricing.name })}</span>
              <span class="ctbl__sub">
                {pricing.taxRegistration
                  ? t('tower.rates.registeredAs', { registration: pricing.taxRegistration })
                  : t('tower.rates.notRegistered')}
              </span>
            </div>

            {state.done ? (
              <p class="twr-done">
                <Icon name="check" size={16} />
                {state.done}
              </p>
            ) : null}

            <table class="ctbl">
              <thead>
                <tr>
                  <th>{t('tower.rates.col.lane')}</th>
                  <th class="ctbl__num">{t('tower.rates.costOfRisk')}</th>
                  <th class="ctbl__num">{t('tower.rates.profitOnRisk')}</th>
                  <th class="ctbl__num">{t('tower.rates.margin')}</th>
                  <th class="ctbl__num">{t('tower.rates.col.total')}</th>
                  <th class="ctbl__num">{t('tower.tax.rate')}</th>
                  <th class="ctbl__num">{t('tower.cover.freeLimit')}</th>
                  <th class="ctbl__num">{t('tower.cover.premium')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pricing.lanes.map((row) => (
                  <LaneRow key={row.lane ?? 'default'} row={row} pricing={pricing} state={state} actions={actions} />
                ))}
              </tbody>
            </table>
          </section>

          <TopUpFee pricing={pricing} state={state} actions={actions} />
          <RecentChanges pricing={pricing} />
          <Administrators pricing={pricing} state={state} actions={actions} />
          <RateImpact state={state} />
          </>
          )}
        </>
      )}
    </>
  );
}

/** One lane, read across: what it charges, and for each number, whether this lane is what decided it. */
function LaneRow({ row, pricing, state, actions }: { row: LanePricing; pricing: EntityPricing; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const key = row.lane ?? 'default';
  const open = state.openId === key;
  const money = (n: number) => (n ? `${n.toLocaleString()} ${pricing.currency ?? ''}`.trim() : '—');

  return (
    <>
      <tr class={open ? 'is-open' : undefined}>
        <td class="ctbl__strong">{laneLabel(row.lane, t)}</td>
        <Cell value={pctLabel(row.rates.costOfRiskPct)} origin={row.rateOrigin.costOfRiskPct} lane={row.lane} t={t} />
        <Cell value={pctLabel(row.rates.profitOnRiskPct)} origin={row.rateOrigin.profitOnRiskPct} lane={row.lane} t={t} />
        <Cell value={pctLabel(row.rates.marginPct)} origin={row.rateOrigin.marginPct} lane={row.lane} t={t} />
        <td class="ctbl__num ctbl__strong">{pctLabel(row.rates.totalPct)}</td>
        <Cell value={row.tax.ratePct ? `${pctLabel(row.tax.ratePct)} ${row.tax.label}` : '—'} origin={row.taxOrigin} lane={row.lane} t={t} />
        <Cell value={money(row.insurance.freeLimit)} origin={row.insuranceOrigin} lane={row.lane} t={t} />
        <Cell value={row.insurance.premiumPct ? pctLabel(row.insurance.premiumPct) : '—'} origin={row.insuranceOrigin} lane={row.lane} t={t} />
        <td class="ctbl__num">
          <button
            type="button"
            class="cbtn cbtn--ghost cbtn--sm"
            aria-expanded={open}
            disabled={!pricing.editable}
            onClick={() => actions.open(open ? null : key)}
          >
            {open ? t('common.close') : t('tower.rates.edit')}
          </button>
        </td>
      </tr>
      {open ? (
        <tr class="is-open ctbl__editor">
          <td colSpan={9}>
            <LaneEditor row={row} pricing={pricing} state={state} actions={actions} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * WHAT IT COSTS A SHOP OR A STORE TO PUT MONEY IN.
 *
 * ITS OWN PANEL, OUTSIDE THE TABLE, because it is the one charge on this screen that is not per lane.
 * Everything in the table above resolves through lane → sister → network; this resolves through nothing.
 * Putting it in a lane row would invite somebody to set a different top-up fee for bulk than for parcels,
 * which is not a distinction a payment has.
 *
 * ABSENT IS STATED IN WORDS, not shown as two zeroes. A threshold of 0 against a charge of 0 reads like a
 * decision somebody made and could adjust; nobody made it, and the difference matters because removing
 * the rule is the only way to charge nothing — a fee of zero is refused by the server on purpose.
 */
function TopUpFee({ pricing, state, actions }: { pricing: EntityPricing; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [form, setForm] = useState<TopUpFeeForm>(() => topUpFeeFormOf(pricing));
  const [tried, setTried] = useState(false);

  // A save re-reads the pricing, so the boxes follow what was actually stored rather than what was typed.
  useEffect(() => {
    setForm(topUpFeeFormOf(pricing));
    setTried(false);
  }, [pricing]);

  const err = tried ? topUpFeeFormError(form, t) : null;
  const busy = state.busyId === 'topUpFee';
  const currency = pricing.currency ?? '';
  const label = (key: MessageKey) => (currency ? t('tower.topupfee.inCurrency', { label: t(key), currency }) : t(key));

  const save = () => {
    setTried(true);
    if (topUpFeeFormError(form, t)) return;
    void actions.saveTopUpFee(topUpFeePayload(form));
  };

  return (
    <section class="cons__panel" style="margin-top:18px">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.topupfee.title')}</span>
        {/* What is charged TODAY, read off the record rather than off the boxes — the boxes are a draft
            until somebody saves them, and the two are not the same claim. */}
        <span class="ctbl__sub">
          {pricing.topUpFee
            ? t('tower.topupfee.current', {
                charge: `${pricing.topUpFee.amount.toLocaleString()} ${currency}`.trim(),
                freeAbove: `${pricing.topUpFee.freeAbove.toLocaleString()} ${currency}`.trim(),
              })
            : t('tower.topupfee.none')}
        </span>
      </div>

      <div class="twr-knobs">
        <p class="chint">{t('tower.topupfee.hint')}</p>
        <div class="twr-knobs__row">
          <section class="twr-knob">
            <Text label={label('tower.topupfee.charge')} value={form.charge} onInput={(v) => setForm({ ...form, charge: v })} />
            <Text
              label={label('tower.topupfee.freeAbove')}
              value={form.freeAbove}
              hint={t('tower.topupfee.clearHint')}
              onInput={(v) => setForm({ ...form, freeAbove: v })}
            />
            {err ? <p class="cerr">{err}</p> : null}
            <button type="button" class="cbtn cbtn--primary" disabled={!pricing.editable || busy} onClick={save}>
              {t('tower.rates.save')}
            </button>
          </section>
        </div>
      </div>
    </section>
  );
}

/**
 * WHO SET WHAT IS ON THIS SCREEN.
 *
 * The reason a company has administrators of its own is that a commercial decision has a person behind
 * it — which is only true if the decision is recorded with the person on it. Otherwise this console has
 * merely widened who may change a price.
 */
function RecentChanges({ pricing }: { pricing: EntityPricing }) {
  const t = useT();
  if (!pricing.recentChanges.length) return null;
  return (
    <section class="cons__panel" style="margin-top:18px">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.changes.title')}</span>
        <span class="ctbl__sub">{t('tower.changes.hint')}</span>
      </div>
      <table class="ctbl ctbl--stack">
        <thead>
          <tr>
            <th>{t('tower.changes.col.when')}</th>
            <th>{t('tower.changes.col.who')}</th>
            <th>{t('tower.changes.col.what')}</th>
            <th>{t('tower.changes.col.from')}</th>
            <th>{t('tower.changes.col.to')}</th>
          </tr>
        </thead>
        <tbody>
          {pricing.recentChanges.map((c, i) => (
            <tr key={`${c.at}-${i}`}>
              <td class="ctbl__sub">{new Date(c.at).toLocaleString()}</td>
              <td class="ctbl__strong"><span class="ctbl__lbl">{t('tower.changes.col.who')}</span>{c.by}</td>
              <td><span class="ctbl__lbl">{t('tower.changes.col.what')}</span>
                {t(`tower.changes.what.${c.what}` as never)}
                {c.lane ? <span class="ctbl__sub"> · {laneLabel(c.lane, t)}</span> : null}
              </td>
              <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.changes.col.from')}</span>{c.from}</td>
              <td><span class="ctbl__lbl">{t('tower.changes.col.to')}</span>{c.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Who may sign in for this company.
 *
 * Creating one is how a company stops depending on network staff to change its own prices. The password
 * is generated by the server and shown ONCE, in a panel closed by hand — never a toast, which would take
 * the only copy of a credential away on a timer.
 */
function Administrators({ pricing, state, actions }: { pricing: EntityPricing; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const rows = state.admins;

  const add = () => {
    if (!email.trim() || !name.trim()) return;
    void actions.addAdmin(pricing.entityId, email.trim(), name.trim());
    setEmail('');
    setName('');
  };

  return (
    <section class="cons__panel" style="margin-top:18px">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.admins.title', { name: pricing.name })}</span>
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t('common.close') : t('tower.admins.add')}
        </button>
      </div>

      {/* Shown until it is closed BY HAND: this is the only time this password exists anywhere. */}
      {state.newAdmin ? (
        <div class="twr-reveal">
          <p class="twr-clear__t">{t('tower.admins.revealTitle', { name: state.newAdmin.name })}</p>
          <p class="twr-clear__b">{t('tower.admins.revealBody')}</p>
          <p class="twr-reveal__creds">
            <span class="ctbl__mono">{state.newAdmin.email}</span>
            <span class="ctbl__mono twr-reveal__pw">{state.newAdmin.password}</span>
          </p>
          <button type="button" class="cbtn cbtn--primary" onClick={actions.dismissNewAdmin}>
            {t('tower.admins.revealDone')}
          </button>
        </div>
      ) : null}

      {open ? (
        <div class="twr-knobs" style="padding:12px 0">
          <div class="twr-knobs__row">
            <div class="twr-knob">
              <label class="cfield">
                <span class="cfield__label">{t('tower.admins.name')}</span>
                <input class="cinput" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
                <span class="chint">{t('tower.admins.nameHint')}</span>
              </label>
              <label class="cfield">
                <span class="cfield__label">{t('tower.admins.email')}</span>
                <input class="cinput" type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
              </label>
              <button type="button" class="cbtn cbtn--primary" disabled={state.busyId === 'admin' || !email.trim() || !name.trim()} onClick={add}>
                {t('tower.admins.create')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rows === null ? (
        <p class="cons__empty">{t('tower.admins.loading')}</p>
      ) : rows.length === 0 ? (
        <div class="cons__empty">
          <p class="cons__emptyt">{t('tower.admins.emptyTitle')}</p>
          <p>{t('tower.admins.emptyBody')}</p>
        </div>
      ) : (
        <table class="ctbl ctbl--stack">
          <thead>
            <tr>
              <th>{t('tower.admins.col.who')}</th>
              <th>{t('tower.admins.col.email')}</th>
              <th>{t('tower.admins.col.lastSeen')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.adminId}>
                <td class="ctbl__strong">{a.name}</td>
                <td class="ctbl__mono"><span class="ctbl__lbl">{t('tower.admins.col.email')}</span>{a.email}</td>
                <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.admins.col.lastSeen')}</span>{a.lastSeenAt ? new Date(a.lastSeenAt).toLocaleString() : t('tower.admins.never')}</td>
                <td>
                  <button
                    type="button"
                    class="cbtn cbtn--ghost cbtn--sm"
                    disabled={state.busyId === a.adminId}
                    onClick={() => void actions.revokeAdmin(pricing.entityId, a.adminId)}
                  >
                    {t('tower.admins.revoke')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** A number, and whether it was decided here or fell through from somewhere wider. */
function Cell({ value, origin, lane, t }: { value: string; origin: string; lane?: string; t: Translate }) {
  const owned = isOwnedHere(origin, lane);
  return (
    <td class="ctbl__num">
      <div class={owned ? 'ctbl__strong' : undefined}>{value}</div>
      {/* Said in words, never by colour alone: "inherited from the sister" is the whole difference
          between a number somebody chose and the absence of a choice. */}
      <div class="ctbl__sub">{owned ? t('tower.origin.here') : originLabel(origin, t)}</div>
    </td>
  );
}

/**
 * The editor: three panels, three saves, because they are three different acts against three endpoints.
 *
 * One combined Save would be a lie about what happens — a rate that is refused for busting the ceiling
 * would leave a tax change applied, or not, depending on the order they went out in.
 */
function LaneEditor({ row, pricing, state, actions }: { row: LanePricing; pricing: EntityPricing; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [rates, setRates] = useState<RateForm>(() => rateFormOf(row));
  const [tax, setTax] = useState<TaxForm>(() => taxFormOf(row, pricing.taxRegistration));
  const [cover, setCover] = useState<CoverForm>(() => coverFormOf(row));
  const [shown, setShown] = useState<string | null>(null);

  // A fresh read replaces the row underneath this form (a save re-reads), so the boxes follow it. Without
  // this, saving a rate would leave the OTHER two panels holding values from before the save.
  useEffect(() => {
    setRates(rateFormOf(row));
    setTax(taxFormOf(row, pricing.taxRegistration));
    setCover(coverFormOf(row));
  }, [row, pricing.taxRegistration]);

  const busy = state.busyId === (row.lane ?? 'default');
  const rateErr = shown === 'rates' ? rateFormError(rates, pricing.bounds, t) : null;
  const taxErr = shown === 'tax' ? taxFormError(tax, pricing.bounds, t) : null;
  const coverErr = shown === 'cover' ? coverFormError(cover, pricing.bounds, t) : null;

  const save = (which: 'rates' | 'tax' | 'cover') => {
    setShown(which);
    const err =
      which === 'rates'
        ? rateFormError(rates, pricing.bounds, t)
        : which === 'tax'
          ? taxFormError(tax, pricing.bounds, t)
          : coverFormError(cover, pricing.bounds, t);
    if (err) return;
    const lane = row.lane;
    if (which === 'rates') void actions.saveRates(ratesPayload(rates, lane), lane);
    if (which === 'tax') void actions.saveTax(taxPayload(tax, lane), lane);
    if (which === 'cover') void actions.saveCover(coverPayload(cover, lane), lane);
  };

  return (
    <div class="twr-knobs">
      <p class="twr-clear__b">{t('tower.rates.emptyInherits')}</p>

      <div class="twr-knobs__row">
        <section class="twr-knob">
          <p class="twr-clear__t">{t('tower.rates.stackTitle')}</p>
          <p class="chint">{t('tower.rates.stackHint')}</p>
          <Pct label={t('tower.rates.costOfRisk')} value={rates.costOfRisk} placeholder={pctText(row.rates.costOfRiskPct)} onInput={(v) => setRates({ ...rates, costOfRisk: v })} />
          <Pct label={t('tower.rates.profitOnRisk')} value={rates.profitOnRisk} placeholder={pctText(row.rates.profitOnRiskPct)} onInput={(v) => setRates({ ...rates, profitOnRisk: v })} />
          <Pct label={t('tower.rates.margin')} value={rates.margin} placeholder={pctText(row.rates.marginPct)} onInput={(v) => setRates({ ...rates, margin: v })} />
          {rateErr ? <p class="cerr">{rateErr}</p> : null}
          <button type="button" class="cbtn cbtn--primary" disabled={busy} onClick={() => save('rates')}>
            {t('tower.rates.save')}
          </button>
        </section>

        <section class="twr-knob">
          <p class="twr-clear__t">{t('tower.tax.title')}</p>
          <p class="chint">{t('tower.tax.hint')}</p>
          <Pct label={t('tower.tax.rate')} value={tax.rate} placeholder={pctText(row.tax.ratePct)} onInput={(v) => setTax({ ...tax, rate: v })} />
          <Text label={t('tower.tax.label')} value={tax.label} placeholder={row.tax.label} onInput={(v) => setTax({ ...tax, label: v })} />
          <Text label={t('tower.tax.registration')} value={tax.registration} hint={t('tower.tax.registrationHint')} onInput={(v) => setTax({ ...tax, registration: v })} />
          {taxErr ? <p class="cerr">{taxErr}</p> : null}
          <button type="button" class="cbtn cbtn--primary" disabled={busy} onClick={() => save('tax')}>
            {t('tower.rates.save')}
          </button>
        </section>

        <section class="twr-knob">
          <p class="twr-clear__t">{t('tower.cover.title')}</p>
          <p class="chint">{t('tower.cover.hint')}</p>
          <Text
            label={t('tower.cover.freeLimitIn', { currency: pricing.currency ?? '' })}
            value={cover.freeLimit}
            placeholder={String(row.insurance.freeLimit)}
            onInput={(v) => setCover({ ...cover, freeLimit: v })}
          />
          <Pct label={t('tower.cover.premium')} value={cover.premium} placeholder={pctText(row.insurance.premiumPct)} onInput={(v) => setCover({ ...cover, premium: v })} />
          {coverErr ? <p class="cerr">{coverErr}</p> : null}
          <button type="button" class="cbtn cbtn--primary" disabled={busy} onClick={() => save('cover')}>
            {t('tower.rates.save')}
          </button>
        </section>
      </div>

      {state.saveError ? (
        <p class="cerr">
          <b>{t('tower.rates.refused')}</b> — {state.saveError.detail || state.saveError.title}
        </p>
      ) : null}
    </div>
  );
}

/** A percentage box. The suffix is part of the control: these are the boxes where a unit mistake is money. */
function Pct({ label, value, placeholder, onInput }: { label: string; value: string; placeholder: string; onInput: (v: string) => void }) {
  return (
    <label class="cfield">
      <span class="cfield__label">{label}</span>
      <span class="twr-pct">
        <input class="cinput" inputMode="decimal" value={value} placeholder={placeholder} onInput={(e) => onInput((e.target as HTMLInputElement).value)} />
        <span class="twr-pct__u">%</span>
      </span>
    </label>
  );
}

function Text({ label, value, placeholder, hint, onInput }: { label: string; value: string; placeholder?: string; hint?: string; onInput: (v: string) => void }) {
  return (
    <label class="cfield">
      <span class="cfield__label">{label}</span>
      <input class="cinput" value={value} placeholder={placeholder} onInput={(e) => onInput((e.target as HTMLInputElement).value)} />
      {hint ? <span class="chint">{hint}</span> : null}
    </label>
  );
}

/**
 * What each rate actually DID — the half of the question that is not arithmetic.
 *
 * What a rate earned per shipment anybody can work out in their head. What it did to the NUMBER of
 * shipments can only be observed, and it is the part that decides whether a change was worth making. Read
 * as spells so a rate raised and then lowered again shows as two periods to compare rather than one total.
 */
function RateImpact({ state }: { state: TowerState }) {
  const t = useT();
  const impact = state.rateImpact;
  if (!impact) return null;

  return (
    <section class="cons__panel" style="margin-top:18px">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.impact.title')}</span>
        <span class="ctbl__sub">{t('tower.impact.hint')}</span>
      </div>
      {impact.spells.length === 0 ? (
        <div class="cons__empty">
          <p class="cons__emptyt">{t('tower.impact.emptyTitle')}</p>
          <p>{t('tower.impact.emptyBody')}</p>
        </div>
      ) : (
        <table class="ctbl ctbl--stack">
          <thead>
            <tr>
              <th>{t('tower.impact.col.rate')}</th>
              <th>{t('tower.impact.col.period')}</th>
              <th class="ctbl__num">{t('tower.impact.col.shipments')}</th>
              <th class="ctbl__num">{t('tower.impact.col.gross')}</th>
              <th class="ctbl__num">{t('tower.impact.col.margin')}</th>
              <th class="ctbl__num">{t('tower.impact.col.avg')}</th>
            </tr>
          </thead>
          <tbody>
            {impact.spells.map((s, i) => (
              <tr key={`${s.from}-${i}`}>
                <td class="ctbl__strong">{pctLabel(s.feePct)}</td>
                <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.impact.col.period')}</span>
                  {new Date(s.from).toLocaleDateString()} → {new Date(s.to).toLocaleDateString()}
                </td>
                <td class="ctbl__num"><span class="ctbl__lbl">{t('tower.impact.col.shipments')}</span>{s.shipments}</td>
                <td class="ctbl__num"><span class="ctbl__lbl">{t('tower.impact.col.gross')}</span>{s.gross.toLocaleString()}</td>
                <td class="ctbl__num"><span class="ctbl__lbl">{t('tower.impact.col.margin')}</span>{s.margin.toLocaleString()}</td>
                <td class="ctbl__num"><span class="ctbl__lbl">{t('tower.impact.col.avg')}</span>{s.avgMargin.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {impact.unpriced ? <p class="chint" style="padding:8px 0 12px">{t('tower.impact.unpriced', { n: impact.unpriced })}</p> : null}
    </section>
  );
}

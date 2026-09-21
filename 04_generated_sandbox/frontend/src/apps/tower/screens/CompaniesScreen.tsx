import { useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { laneLabel, pctLabel } from '../money';
import { companyCreateBlocker, expiryTone, INSURANCE_LABEL, LICENCE_LABEL } from '../company';
import { CAPABILITY_LABEL } from '../presence';
import type { CompanyRow, TowerActions, TowerState } from '../useTowerApp';

/**
 * The companies, side by side — what each one charges, and what its books say.
 *
 * The view the mother company could not have: every sister is a separate legal entity with its own
 * currency, its own tax registration and its own books, so "how are we doing" is a question that can
 * only be asked by putting them next to each other. It exists for whoever reaches more than one company,
 * which today means the group's administrator and network staff.
 *
 * TWO HONESTY RULES it is built around:
 *
 *  - **Money is never summed across companies.** Two sisters settle in different currencies, and adding
 *    shillings to birr produces a number that is wrong in a way nobody can see. Each column stays in its
 *    own money, and there is no total row.
 *  - **A missing read is shown as missing.** A column whose books could not be read says so rather than
 *    rendering zeros, because a zero balance and an unanswered question look identical and mean opposite
 *    things.
 *
 * CA3–CA7: network staff also create a company of ours or a partner here — as a DRAFT that can do nothing — and
 * see every licence and policy about to lapse across all of them.
 */
export function CompaniesScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.companies;
  const isOperator = state.who?.mode === 'operator';

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.companies.title')}</h1>
        <p class="cons__lede">{t('tower.companies.lede')}</p>
      </header>

      <p class="cons__caveat">
        <Icon name="info" size={18} />
        <span>
          <b>{t('tower.companies.caveatLead')}</b> {t('tower.companies.caveat')}
        </span>
      </p>

      {state.done ? (
        <p class="twr-done">
          <Icon name="check" size={16} />
          {state.done}
        </p>
      ) : null}
      {state.queueError ? <p class="cerr">{state.queueError}</p> : null}

      {isOperator ? <Expiring state={state} actions={actions} /> : null}

      {rows === null ? (
        <p class="cons__empty">{t('tower.companies.loading')}</p>
      ) : (
        <div class="twr-cards">
          {rows.map((row) => (
            <CompanyCard key={row.entity.entityId} row={row} state={state} actions={actions} />
          ))}
        </div>
      )}

      {isOperator ? <CreateCompany state={state} actions={actions} /> : null}
    </>
  );
}

/** CA5 — every licence and policy lapsing in the next sixty days, soonest first, and what each will switch off. */
function Expiring({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const items = state.expiring;
  if (items === null) return null;
  const kindLabel = (source: string, kind: string) =>
    source === 'licence' ? t(LICENCE_LABEL[kind as keyof typeof LICENCE_LABEL] ?? 'tower.company.licence.other') : t(INSURANCE_LABEL[kind as keyof typeof INSURANCE_LABEL] ?? 'tower.company.insurance.other');

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.companies.expiringTitle')}</span>
      </div>
      {items.length === 0 ? (
        <p class="cons__empty">{t('tower.companies.expiringNone')}</p>
      ) : (
        <table class="ctbl">
          <tbody>
            {items.map((item) => {
              const tone = expiryTone(item);
              const caps = item.supports.map((c) => t(CAPABILITY_LABEL[c])).join(', ');
              return (
                <tr key={`${item.entityId}:${item.reference}`}>
                  <td>
                    <div class="ctbl__strong">{item.name}</div>
                    <div class="ctbl__sub">
                      {kindLabel(item.source, item.kind)} · {item.reference}
                    </div>
                  </td>
                  <td>
                    <span class={`ctag ${tone === 'bad' ? 'ctag--warn' : tone === 'warn' ? 'ctag--info' : 'ctag--quiet'}`}>
                      {item.lapsed
                        ? t('tower.companies.expiring.lapsed', { date: item.expiresAt, caps: caps || '—' })
                        : caps
                          ? t('tower.companies.expiring.left', { date: item.expiresAt, days: item.daysLeft, caps })
                          : t('tower.companies.expiring.leftNone', { date: item.expiresAt, days: item.daysLeft })}
                    </span>
                  </td>
                  <td class="ctbl__num">
                    <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => actions.openCompany(item.entityId)}>
                      {t('tower.companies.openRecord')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** CA3/CA7 — a company of ours, or a local partner, created as a draft from the catalogue. */
function CreateCompany({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [form, setForm] = useState<{ kind: 'sister' | 'partner'; jurisdiction: string; name: string }>({ kind: 'sister', jurisdiction: '', name: '' });
  const catalogue = state.catalogue ?? [];
  const blocker = companyCreateBlocker(form, catalogue, state.entities ?? []);

  return (
    <section class="cons__panel twr-corridornew">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.companies.createTitle')}</span>
      </div>
      <p class="chint" style="margin:8px 0">
        {t('tower.companies.createLede')}
      </p>
      <div class="twr-corridorform">
        <label class="cfield">
          <span class="cfield__label">{t('tower.companies.f.kind')}</span>
          <select class="cinput" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.currentTarget.value as 'sister' | 'partner' })}>
            <option value="sister">{t('tower.companies.kind.sister')}</option>
            <option value="partner">{t('tower.companies.kind.partner')}</option>
          </select>
        </label>
        <label class="cfield">
          <span class="cfield__label">{t('tower.companies.f.country')}</span>
          <select class="cinput" value={form.jurisdiction} onChange={(e) => setForm({ ...form, jurisdiction: e.currentTarget.value })}>
            <option value="">{t('tower.companies.f.countryChoose')}</option>
            {catalogue.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </label>
        <label class="cfield">
          <span class="cfield__label">{t('tower.companies.f.name')}</span>
          <input class="cinput" value={form.name} onInput={(e) => setForm({ ...form, name: e.currentTarget.value })} />
        </label>
      </div>
      <div class="twr-corridorsave">
        <button
          type="button"
          class="cbtn cbtn--primary"
          disabled={blocker !== null || state.busyId === 'company'}
          onClick={async () => {
            const ok = await actions.createCompany(form.kind, form.jurisdiction, form.name.trim());
            if (ok) setForm({ kind: 'sister', jurisdiction: '', name: '' });
          }}
        >
          {t('tower.companies.create')}
        </button>
        {blocker ? <span class="chint">{t(blocker)}</span> : null}
      </div>
    </section>
  );
}

function CompanyCard({ row, state, actions }: { row: CompanyRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const { entity, pricing, books } = row;
  const money = (n: number, ccy?: string) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${ccy ?? ''}`.trim();
  const isGroup = entity.kind === 'group';
  const isDraft = entity.status === 'draft';

  return (
    <section class="cons__panel twr-card">
      <div class="cons__panelhead">
        <span class="cons__panelt">{entity.name}</span>
        <span class="ctbl__sub">{isGroup ? t('tower.rates.group') : `${entity.jurisdiction ?? '—'} · ${entity.currency ?? '—'}`}</span>
      </div>

      <div class="twr-card__body">
        {entity.kind === 'partner' || isDraft ? (
          <p class="twr-caps">
            {entity.kind === 'partner' ? <span class="ctag ctag--info">{t('tower.companies.partner')}</span> : null}
            {isDraft ? <span class="ctag ctag--warn">{t('tower.companies.draft')}</span> : null}
          </p>
        ) : null}

        {/* WHAT IT CHARGES. The group has no rates, and says so rather than showing the fallbacks it
            would resolve to if it could transact. */}
        {isGroup ? (
          <p class="chint">{t('tower.companies.groupCharges')}</p>
        ) : pricing ? (
          <table class="ctbl ctbl--stack">
            <thead>
              <tr>
                <th>{t('tower.rates.col.lane')}</th>
                <th class="ctbl__num">{t('tower.rates.col.total')}</th>
                <th class="ctbl__num">{t('tower.tax.rate')}</th>
                <th class="ctbl__num">{t('tower.cover.freeLimit')}</th>
              </tr>
            </thead>
            <tbody>
              {pricing.lanes.map((lane) => (
                <tr key={lane.lane ?? 'default'}>
                  <td>{laneLabel(lane.lane, t)}</td>
                  <td class="ctbl__num ctbl__strong"><span class="ctbl__lbl">{t('tower.rates.col.total')}</span>{pctLabel(lane.rates.totalPct)}</td>
                  <td class="ctbl__num"><span class="ctbl__lbl">{t('tower.tax.rate')}</span>{lane.tax.ratePct ? pctLabel(lane.tax.ratePct) : '—'}</td>
                  <td class="ctbl__num"><span class="ctbl__lbl">{t('tower.cover.freeLimit')}</span>{lane.insurance.freeLimit ? money(lane.insurance.freeLimit, entity.currency) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p class="chint">{t('tower.companies.noPricing')}</p>
        )}

        {/* WHAT THE BOOKS SAY. Coverage is money HELD against money OWED — the closest thing the network
            has to an answer for "could this company meet its obligations today". */}
        {books && !entity.currency ? (
          /* A company that settles in NO currency cannot be asked what it holds against what it owes:
             coverage is computed in one money, and this one has none. Four zeros would read as "we
             checked and it is zero", which is a different answer from "this question does not apply". */
          <div class="twr-card__books">
            <p class="chint">{t('tower.companies.groupBooks')}</p>
            <div class="twr-fig">
              <span class="twr-fig__l">{t('tower.companies.integrity')}</span>
              <span class={books.integrity.balanced ? 'ctag ctag--ok' : 'ctag ctag--warn'}>
                {books.integrity.balanced ? t('tower.companies.balanced') : t('tower.companies.drift', { drift: books.integrity.drift })}
              </span>
            </div>
          </div>
        ) : books ? (
          <div class="twr-card__books">
            <Figure label={t('tower.companies.held')} value={money(books.coverage.held, books.coverage.currency)} />
            <Figure label={t('tower.companies.owed')} value={money(books.coverage.owed, books.coverage.currency)} />
            <Figure
              label={t('tower.companies.cover')}
              value={money(books.coverage.cover, books.coverage.currency)}
              tone={books.coverage.cover < 0 ? 'bad' : 'ok'}
            />
            <Figure label={t('tower.companies.lent')} value={money(books.coverage.lent, books.coverage.currency)} />
            <div class="twr-fig">
              <span class="twr-fig__l">{t('tower.companies.integrity')}</span>
              <span class={`ctag ${books.integrity.balanced ? 'ctag--ok' : 'ctag--warn'}`}>
                {books.integrity.balanced ? t('tower.companies.balanced') : t('tower.companies.drift', { drift: books.integrity.drift })}
              </span>
            </div>
          </div>
        ) : (
          <p class="chint">{t('tower.companies.noBooks')}</p>
        )}

        <span class="twr-panelend">
          {entity.kind === 'sister' && !isDraft ? (
            <button
              type="button"
              class="cbtn cbtn--ghost cbtn--sm"
              onClick={() => {
                void actions.chooseEntity(entity.entityId);
                actions.go('rates');
              }}
              disabled={state.loading}
            >
              {t('tower.companies.openTerms', { name: entity.name })}
            </button>
          ) : null}
          {!isGroup && state.who?.mode === 'operator' ? (
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => actions.openCompany(entity.entityId)}>
              {t('tower.companies.openRecord')}
            </button>
          ) : null}
        </span>
      </div>
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  return (
    <div class="twr-fig">
      <span class="twr-fig__l">{label}</span>
      <span class={`twr-fig__v${tone === 'bad' ? ' twr-fig__v--bad' : ''}`}>{value}</span>
    </div>
  );
}

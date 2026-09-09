import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { laneLabel, pctLabel } from '../money';
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
 */
export function CompaniesScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.companies;

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

      {rows === null ? (
        <p class="cons__empty">{t('tower.companies.loading')}</p>
      ) : (
        <div class="twr-cards">
          {rows.map((row) => (
            <CompanyCard key={row.entity.entityId} row={row} state={state} actions={actions} />
          ))}
        </div>
      )}
    </>
  );
}

function CompanyCard({ row, state, actions }: { row: CompanyRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const { entity, pricing, books } = row;
  const money = (n: number, ccy?: string) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${ccy ?? ''}`.trim();
  const isGroup = entity.kind === 'group';

  return (
    <section class="cons__panel twr-card">
      <div class="cons__panelhead">
        <span class="cons__panelt">{entity.name}</span>
        <span class="ctbl__sub">{isGroup ? t('tower.rates.group') : `${entity.jurisdiction ?? '—'} · ${entity.currency ?? '—'}`}</span>
      </div>

      <div class="twr-card__body">
        {/* WHAT IT CHARGES. The group has no rates, and says so rather than showing the fallbacks it
            would resolve to if it could transact. */}
        {isGroup ? (
          <p class="chint">{t('tower.companies.groupCharges')}</p>
        ) : pricing ? (
          <table class="ctbl">
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
                  <td class="ctbl__num ctbl__strong">{pctLabel(lane.rates.totalPct)}</td>
                  <td class="ctbl__num">{lane.tax.ratePct ? pctLabel(lane.tax.ratePct) : '—'}</td>
                  <td class="ctbl__num">{lane.insurance.freeLimit ? money(lane.insurance.freeLimit, entity.currency) : '—'}</td>
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

import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { ConsolePick } from '../ConsolePick';
import { useT } from '../../../shared/i18n';
import {
  CAPABILITY_LABEL,
  LEVEL_LABEL,
  PRESENCE_LEVELS,
  PROMISE_LABEL,
  alreadyListed,
  approvalBlocker,
  capabilityStates,
  countryNameOf,
  impactIsEmpty,
  type CountryImpactView,
  INCOTERMS,
  termsOf,
  toggleTerm,
  levelBlocker,
  levelEffect,
  needsSecondPerson,
  newCountryBlocker,
  pendingFor,
  presenceRows,
  takeInPromise,
  type PresenceLevel,
  type PresenceProposalRow,
  type PresenceRow,
} from '../presence';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * HOW ESTABLISHED WE ARE, COUNTRY BY COUNTRY.
 *
 * The network can match, carry and prove where it cannot spend a shilling — that is what makes it an
 * operating system rather than one company's software — and this is the screen that decides which is
 * which. Everything here is built so the difference cannot be misread: a country shows what it may do
 * AND what somebody deliberately switched off, a level change shows what it would cost before it is
 * pressed, and "established" cannot be typed at all where no company transacts.
 *
 * CA1 + CA2: a country is chosen from the catalogue, never typed, and a change that gives a country anything it
 * cannot do now is only a PROPOSAL until a different named person approves it.
 */
/**
 * WHO IS WAITING FOR A COUNTRY WE HAVE NOT REACHED — the evidence this screen's decision never had.
 *
 * Every country is on the join form, and most of them answer "we do not reach here yet". Somebody who
 * says they would carry freight there, and why, is the only real input to "which country next" — and
 * until this panel the decision was made on nothing but instinct and a map.
 *
 * ONE ROW PER COUNTRY, not per message. The question is "should we switch on the Netherlands", never
 * "should I reply to this person", so the row arrives already counted: how many are waiting, what they
 * would be, what the country SPEAKS — which is the translation this would imply, and is otherwise worked
 * out by hand — and what it settles in. The messages sit underneath because the motivation is the
 * evidence; a count alone says only that ten people tapped a button.
 *
 * It sits directly above the map it informs, so the country you have just read about is the country you
 * then switch on.
 */
function WhoIsWaiting({ state }: { state: TowerState }) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const rows = state.interest;
  // Nothing waiting is not a failure and gets no empty panel: this screen has a job without it.
  if (!rows || rows.length === 0) return null;

  return (
    <section class="cons__panel" style="margin-bottom:18px">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.interest.title')}</span>
        <span class="ctbl__sub">{t('tower.interest.hint')}</span>
      </div>
      <table class="ctbl ctbl--stack">
        <thead>
          <tr>
            <th>{t('tower.interest.col.country')}</th>
            <th class="ctbl__num">{t('tower.interest.col.waiting')}</th>
            <th>{t('tower.interest.col.who')}</th>
            <th>{t('tower.interest.col.implies')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const showing = open === row.country;
            return (
              <>
                <tr key={row.country} class={showing ? 'is-open' : undefined}>
                  <td class="ctbl__strong">
                    {row.name} <span class="ctbl__sub">({row.country})</span>
                  </td>
                  <td class="ctbl__num ctbl__strong">
                    <span class="ctbl__lbl">{t('tower.interest.col.waiting')}</span>
                    {row.waiting}
                    {row.waiting !== row.notes.length ? <span class="ctbl__sub"> {t('tower.interest.ofTotal', { n: row.notes.length })}</span> : null}
                  </td>
                  <td class="ctbl__sub">
                    <span class="ctbl__lbl">{t('tower.interest.col.who')}</span>
                    {Object.entries(row.kinds)
                      .map(([kind, n]) => `${n} × ${t(`tower.interest.kind.${kind}` as 'tower.interest.kind.carrier')}`)
                      .join(' · ')}
                  </td>
                  {/* What switching this country on would actually cost us, said rather than looked up. */}
                  <td class="ctbl__sub">
                    <span class="ctbl__lbl">{t('tower.interest.col.implies')}</span>
                    {t('tower.interest.speaks', { languages: row.languages.join(', ').toUpperCase() || '—', currency: row.currency || '—' })}
                  </td>
                  <td class="ctbl__num">
                    <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-expanded={showing} onClick={() => setOpen(showing ? null : row.country)}>
                      {showing ? t('common.close') : t('tower.interest.read', { n: row.notes.length })}
                    </button>
                  </td>
                </tr>
                {showing ? (
                  <tr class="is-open ctbl__editor">
                    <td colSpan={5}>
                      <div class="twr-knobs">
                        {row.notes.map((n) => (
                          <p key={n.noteId} class="twr-clear__b" style="margin:0 0 10px">
                            <b>{t(`tower.interest.kind.${n.kind}` as 'tower.interest.kind.carrier')}</b>
                            <span class="ctbl__sub">
                              {' '}
                              · {n.email} · {new Date(n.at).toLocaleDateString()}
                              {n.toldAt ? ` · ${t('tower.interest.told', { level: n.toldLevel ?? '' })}` : ''}
                            </span>
                            <br />
                            {n.message}
                          </p>
                        ))}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </>
            );
          })}
        </tbody>
      </table>
      <p class="chint" style="padding:8px 0 12px">{t('tower.interest.promise')}</p>
    </section>
  );
}

export function PresenceScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.presence ? presenceRows(state.presence) : null;
  const decided = (state.proposals ?? []).filter((p) => p.status !== 'pending').slice(0, 5);

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.presence.title')}</h1>
        <p class="cons__lede">{t('tower.presence.lede')}</p>
      </header>

      <p class="cons__caveat">
        <Icon name="info" size={16} />
        <span>
          <b>{t('tower.presence.caveatT')}</b> {t('tower.presence.caveat')}
        </span>
      </p>

      {state.done ? (
        <p class="twr-done">
          <Icon name="check" size={16} />
          {state.done}
        </p>
      ) : null}

      {state.queueError ? (
        <p class="cerr" style="margin:12px 0">
          {state.queueError}
        </p>
      ) : null}

      <Waiting state={state} actions={actions} />
      <WhoIsWaiting state={state} />

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{rows === null ? t('tower.queues.loading') : t('tower.presence.count', { n: rows.length })}</span>
          <span class="twr-panelend">
            {state.readAt ? <span class="ctbl__sub">{t('tower.hazards.updatedAt', { time: new Date(state.readAt).toLocaleTimeString() })}</span> : null}
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void actions.refresh()} disabled={state.loading}>
              <Icon name="refresh" size={16} />
              {t('tower.hazards.refresh')}
            </button>
          </span>
        </div>

        {rows === null ? (
          <p class="cons__empty">{t('tower.queues.loading')}</p>
        ) : (
          <table class="ctbl ctbl--stack">
            <thead>
              <tr>
                <th>{t('tower.presence.col.country')}</th>
                <th>{t('tower.presence.col.standing')}</th>
                <th>{t('tower.presence.col.promise')}</th>
                <th>{t('tower.presence.col.may')}</th>
                <th>{t('tower.presence.col.decided')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <PresenceRowView key={row.jurisdiction} row={row} state={state} actions={actions} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <RecordCountry state={state} actions={actions} />

      {decided.length ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.presence.decidedTitle')}</span>
          </div>
          <table class="ctbl">
            <tbody>
              {decided.map((p) => (
                <tr key={p.proposalId}>
                  <td>
                    <div class="ctbl__strong">{countryNameOf(p.jurisdiction, state.catalogue)}</div>
                    <div class="ctbl__sub">{t(LEVEL_LABEL[p.level])}</div>
                  </td>
                  <td class="ctbl__sub">{t('tower.presence.proposal.by', { who: p.proposedBy, when: when(p.proposedAt), expires: when(p.expiresAt) })}</td>
                  <td class="ctbl__sub">
                    {p.status === 'approved'
                      ? t('tower.presence.status.approved', { who: p.decidedBy ?? '' })
                      : p.status === 'declined'
                        ? t('tower.presence.status.declined', { who: p.decidedBy ?? '', reason: p.reason ?? '' })
                        : t('tower.presence.status.expired')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * CA2 — the changes a second person has to decide.
 *
 * Shown above the map, not beside it: a change nobody seconds expires, and a country an operator believes they
 * switched on is not switched on until somebody else has pressed Approve.
 */
function Waiting({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const pending = (state.proposals ?? []).filter((p) => p.status === 'pending');

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.presence.waitingTitle')}</span>
        {pending.length ? <span class="ctag ctag--warn">{t('tower.presence.waitingCount', { n: pending.length })}</span> : null}
      </div>
      {pending.length === 0 ? (
        <p class="cons__empty">{t('tower.presence.waitingNone')}</p>
      ) : (
        <table class="ctbl">
          <tbody>
            {pending.map((p) => (
              <ProposalView key={p.proposalId} proposal={p} state={state} actions={actions} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ProposalView({ proposal, state, actions }: { proposal: PresenceProposalRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const blocker = approvalBlocker(proposal, state.who?.name, Boolean(state.who?.named));
  const busy = state.busyId === proposal.proposalId;

  return (
    <tr>
      <td>
        <div class="ctbl__strong">{countryNameOf(proposal.jurisdiction, state.catalogue)}</div>
        <div class="ctbl__sub">{proposal.jurisdiction}</div>
      </td>
      <td>
        <div>{t('tower.presence.proposal.line', { level: t(LEVEL_LABEL[proposal.level]), gains: proposal.gains.map((c) => t(CAPABILITY_LABEL[c])).join(', ') })}</div>
        <div class="ctbl__sub">{t('tower.presence.proposal.by', { who: proposal.proposedBy, when: when(proposal.proposedAt), expires: when(proposal.expiresAt) })}</div>
        {proposal.note ? <div class="ctbl__sub">{proposal.note}</div> : null}
      </td>
      <td class="ctbl__num">
        {declining ? (
          <span class="twr-panelend">
            <input class="cinput" value={reason} placeholder={t('tower.presence.declineReason')} aria-label={t('tower.presence.declineReason')} onInput={(e) => setReason(e.currentTarget.value)} />
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy || !reason.trim()} onClick={() => void actions.declineProposal(proposal.proposalId, reason.trim())}>
              {t('tower.presence.decline')}
            </button>
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setDeclining(false)}>
              {t('tower.presence.cancel')}
            </button>
          </span>
        ) : (
          <span class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy || blocker !== null} onClick={() => void actions.approveProposal(proposal.proposalId)}>
              {t('tower.presence.approve')}
            </button>
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => setDeclining(true)}>
              {t('tower.presence.decline')}
            </button>
          </span>
        )}
        {blocker && !declining ? <div class="chint">{t(blocker)}</div> : null}
      </td>
    </tr>
  );
}

/**
 * Switch a country on — chosen from the catalogue.
 *
 * The table can only show countries that already have a company or a standing, which would make the FIRST country
 * we are not established in impossible to record. CA1: it is picked from every country that exists, with its money
 * and whether the rate book can price in it, so nothing here can be a typo.
 */
function RecordCountry({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const form = state.countryForm;
  const rows = state.presence ?? [];
  const catalogue = state.catalogue ?? [];
  const blocker = newCountryBlocker(form, rows, catalogue);
  const listed = alreadyListed(form, rows);
  const chosen = catalogue.find((c) => c.code === form.jurisdiction);
  const listedRow = rows.find((r) => r.jurisdiction === form.jurisdiction);
  const secondPerson = chosen && form.level !== 'observed' && (!listedRow || needsSecondPerson(listedRow, form.level));

  return (
    <section class="cons__panel twr-corridornew">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.presence.newTitle')}</span>
      </div>

      <div class="twr-corridorform">
        <ConsolePick
          label={t('tower.presence.f.country')}
          value={form.jurisdiction}
          onChange={(v) => actions.setCountryForm({ jurisdiction: v })}
          placeholder={t('tower.presence.f.countryPlaceholder')}
          options={catalogue.map((c) => ({ value: c.code, label: c.name, tag: c.code, ...(c.priceable ? {} : { sub: t('tower.presence.noRate') }) }))}
          hint={
            chosen
              ? t('tower.presence.countryFacts', { currency: chosen.currency, dial: chosen.dialCode, side: t(chosen.drivingSide === 'left' ? 'tower.presence.side.left' : 'tower.presence.side.right') })
              : undefined
          }
        />
        <ConsolePick
          label={t('tower.presence.f.level')}
          value={form.level}
          onChange={(v) => actions.setCountryForm({ level: v as PresenceLevel })}
          options={PRESENCE_LEVELS.map((option) => ({ value: option, label: t(LEVEL_LABEL[option]) }))}
        />
        <label class="cfield">
          <span class="cfield__label">{t('tower.presence.f.note')}</span>
          <input class="cinput" value={form.note} onInput={(e) => actions.setCountryForm({ note: e.currentTarget.value })} />
        </label>
      </div>

      <div class="twr-corridorsave">
        <button type="button" class="cbtn cbtn--primary" disabled={blocker !== null || state.busyId === 'country'} onClick={() => void actions.recordCountry()}>
          {t(secondPerson ? 'tower.presence.propose' : 'tower.presence.record')}
        </button>
        {blocker ? <span class="chint">{t(blocker)}</span> : null}
        {!blocker && secondPerson ? <span class="chint">{t('tower.presence.needsSecond')}</span> : null}
        {/* Choosing a country already on the map is an EDIT, and saying so is cheaper than undoing one. */}
        {!blocker && !secondPerson && listed ? <span class="chint">{t('tower.presence.wouldChange')}</span> : null}
      </div>
    </section>
  );
}

function PresenceRowView({ row, state, actions }: { row: PresenceRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const open = state.openId === row.jurisdiction;
  const promise = takeInPromise(row);
  const granted = capabilityStates(row).filter((s) => s.on);
  const switchedOff = capabilityStates(row).filter((s) => !s.on && s.overridden);
  const waiting = pendingFor(state.proposals, row.jurisdiction);

  return (
    <>
      <tr class={open ? 'is-open' : undefined}>
        <td>
          <div class="ctbl__strong">{countryNameOf(row.jurisdiction, state.catalogue)}</div>
          <div class="ctbl__sub">{row.jurisdiction}</div>
          {/* A country listed only because it has a company has had nothing DECIDED about it. */}
          {row.recorded ? null : <div class="ctbl__sub">{t('tower.presence.derived')}</div>}
        </td>
        <td><span class="ctbl__lbl">{t('tower.presence.col.standing')}</span>
          <span class={`ctag ${row.level === 'established' ? 'ctag--ok' : row.level === 'observed' ? 'ctag--quiet' : 'ctag--info'}`}>{t(LEVEL_LABEL[row.level])}</span>
          {waiting ? <div class="ctag ctag--warn" style="margin-top:4px">{t('tower.presence.pendingTag')}</div> : null}
        </td>
        <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.presence.col.promise')}</span>{t(PROMISE_LABEL[promise])}</td>
        <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.presence.col.may')}</span>
          {granted.length === 0 ? (
            t('tower.presence.nothing')
          ) : (
            <span class="twr-caps">
              {granted.map((s) => (
                <span key={s.capability} class={`ctag ${s.overridden ? 'ctag--warn' : 'ctag--quiet'}`}>
                  {t(CAPABILITY_LABEL[s.capability])}
                </span>
              ))}
            </span>
          )}
          {/* The ones somebody turned OFF against their level — the only absences worth a word. */}
          {switchedOff.length ? (
            <div class="chint">{t('tower.presence.switchedOff', { list: switchedOff.map((s) => t(CAPABILITY_LABEL[s.capability])).join(', ') })}</div>
          ) : null}
        </td>
        <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.presence.col.decided')}</span>
          {row.setBy ? t('tower.presence.by', { who: row.setBy }) : '—'}
          {row.approvedBy ? <div class="ctbl__sub">{t('tower.presence.approvedBy', { who: row.approvedBy })}</div> : null}
          {row.note ? <div class="ctbl__sub">{row.note}</div> : null}
        </td>
        <td>
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => actions.open(open ? null : row.jurisdiction)}>
            {t(open ? 'tower.presence.close' : 'tower.presence.change')}
          </button>
        </td>
      </tr>

      {open ? (
        <tr class="is-open ctbl__editor">
          <td colSpan={6}>
            <PresenceEditor row={row} state={state} actions={actions} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * Moving a country up or down the ladder.
 *
 * The level picker shows what each move would COST — a level is a word, and the word is not the
 * consequence — and `established` is not offered at all where no company transacts, because a flag must
 * never be the thing that conjures a Merchant of Record, a float and a claims provision. A move that GIVES the
 * country something is proposed for a second person; a move that takes something away is applied now.
 */
function PresenceEditor({ row, state, actions }: { row: PresenceRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const form = state.presenceForm;
  const level = (form.level || row.level) as PresenceLevel;
  const blocker = levelBlocker(row, level);
  const { gained, lost } = levelEffect(row, level);
  const busy = state.busyId === row.jurisdiction;
  const second = needsSecondPerson(row, level);

  return (
    <div class="twr-presedit">
      {/* A level this country cannot take stays on the list, greyed, with the reason under it. */}
      <ConsolePick
        label={t('tower.presence.f.level')}
        value={level}
        onChange={(v) => actions.setPresenceForm({ level: v as PresenceLevel })}
        options={PRESENCE_LEVELS.map((option) => {
          const why = levelBlocker(row, option);
          return { value: option, label: t(LEVEL_LABEL[option]), ...(why ? { disabled: true, sub: t(why) } : {}) };
        })}
        hint={blocker ? t(blocker) : undefined}
      />

      <label class="cfield twr-presedit__note">
        <span class="cfield__label">{t('tower.presence.f.note')}</span>
        <input class="cinput" value={form.note} placeholder={t('tower.presence.f.notePlaceholder')} onInput={(e) => actions.setPresenceForm({ note: e.currentTarget.value })} />
      </label>

      <div class="twr-presedit__effect">
        {level === row.level ? (
          <p class="chint">{t('tower.presence.noChange')}</p>
        ) : (
          <>
            {lost.length ? (
              <p class="chint">
                <b>{t('tower.presence.wouldLose')}</b> {lost.map((c) => t(CAPABILITY_LABEL[c])).join(', ')}
              </p>
            ) : null}
            {gained.length ? (
              <p class="chint">
                <b>{t('tower.presence.wouldGain')}</b> {gained.map((c) => t(CAPABILITY_LABEL[c])).join(', ')}
              </p>
            ) : null}
            {!lost.length && !gained.length ? <p class="chint">{t('tower.presence.sameCapabilities')}</p> : null}
            {second ? <p class="chint">{t('tower.presence.needsSecond')}</p> : null}
          </>
        )}
      </div>

      {/* CA9 — a move that takes something away shows what it leaves behind, before it is pressed. */}
      {level !== row.level && lost.length ? <Impact jurisdiction={row.jurisdiction} level={level} actions={actions} /> : null}

      {/* CL1 — which trade terms this country allows, as two sets, because the terms are not symmetric
          about a border: EXW burdens the buyer where the goods START, DDP burdens the seller where they END.
          Everything is off until somebody ticks it, and switching one ON needs a second person exactly as
          raising a capability does — the server holds that rule, and the line above says so. */}
      <div class="twr-presedit__terms">
        <span class="cfield__label">{t('tower.presence.f.terms')}</span>
        <p class="chint">{t('tower.presence.f.termsHint')}</p>
        {(['origin', 'destination'] as const).map((direction) => {
          const chosen = (state.presenceForm.incoterms ?? termsOf(row))[direction];
          return (
            <div key={direction} class="twr-presedit__termrow">
              <span class="ctbl__sub">{t(direction === 'origin' ? 'tower.presence.f.asOrigin' : 'tower.presence.f.asDest')}</span>
              <span class="twr-caps">
                {INCOTERMS.map((term) => {
                  const on = chosen.includes(term.code);
                  return (
                    <button
                      key={term.code}
                      type="button"
                      class={'ctag ' + (on ? 'ctag--quiet' : '')}
                      title={term.name}
                      onClick={() => {
                        const base = state.presenceForm.incoterms ?? termsOf(row);
                        actions.setPresenceForm({ incoterms: { ...base, [direction]: toggleTerm(base[direction], term.code) } });
                      }}
                    >
                      {on ? '\u2713 ' : ''}
                      {term.code}
                      {term.care ? ' !' : ''}
                    </button>
                  );
                })}
              </span>
            </div>
          );
        })}
        <p class="chint">{t('tower.presence.f.termsCare')}</p>
      </div>

      <div class="twr-presedit__act">
        <button type="button" class="cbtn cbtn--primary" disabled={busy || blocker !== null || level === row.level} onClick={() => void actions.savePresence(row.jurisdiction)}>
          {t(second ? 'tower.presence.propose' : 'tower.presence.save')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" onClick={() => actions.open(null)}>
          {t('tower.presence.cancel')}
        </button>
      </div>
    </div>
  );
}

/**
 * CA9 — WHAT THIS LEAVES BEHIND.
 *
 * Lowering a country takes one person and one click, because refusing is the safe direction. That is exactly why
 * the cost is read first: what is on shelves there and whose promise it was taken in under, the loads that start or
 * end there, what our companies still owe there, and everybody registered there who will meet the change.
 */
function Impact({ jurisdiction, level, actions }: { jurisdiction: string; level: PresenceLevel; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [impact, setImpact] = useState<CountryImpactView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setImpact(null);
    setFailed(false);
    if (!client) return undefined;
    void client.api.presenceImpact(jurisdiction, level).then((r) => {
      if (!live) return;
      if (r.error) setFailed(true);
      else setImpact(r.data as unknown as CountryImpactView);
    });
    return () => {
      live = false;
    };
  }, [client, jurisdiction, level]);

  if (failed) return <p class="chint twr-presedit__effect">{t('tower.presence.impact.failed')}</p>;

  return (
    <div class="twr-presedit__effect">
      <p class="chint">
        <b>{t('tower.presence.impact.title')}</b>
      </p>
      {!impact ? (
        <p class="chint">{t('tower.presence.impact.loading')}</p>
      ) : impactIsEmpty(impact) ? (
        <p class="chint">{t('tower.presence.impact.none')}</p>
      ) : (
        <ul class="twr-checklist">
          {impact.closing ? (
            <li class="is-missing">
              <Icon name="warning" size={14} /> {t('tower.presence.impact.closing')}
            </li>
          ) : null}
          {impact.shelves.total ? (
            <li class={impact.shelves.ours ? 'is-missing' : undefined}>
              <Icon name="box" size={14} /> {t('tower.presence.impact.shelves', { total: impact.shelves.total, ours: impact.shelves.ours, theirs: impact.shelves.theirs })}
            </li>
          ) : null}
          {impact.inTransit ? (
            <li>
              <Icon name="route" size={14} /> {t('tower.presence.impact.transit', { n: impact.inTransit })}
            </li>
          ) : null}
          {impact.freight.open || impact.freight.claimed ? (
            <li>
              <Icon name="route" size={14} /> {t('tower.presence.impact.freight', { open: impact.freight.open, claimed: impact.freight.claimed })}
            </li>
          ) : null}
          {impact.owed.map((o) => (
            <li key={o.entityId} class="is-missing">
              <Icon name="wallet" size={14} /> {t('tower.presence.impact.owed', { amount: o.amount.toLocaleString(), currency: o.currency, company: o.name, n: o.suppliers })}
            </li>
          ))}
          {Object.values(impact.registered).some((n) => n > 0) ? (
            <li>
              <Icon name="badge" size={14} /> {t('tower.presence.impact.registered', { ...impact.registered })}
            </li>
          ) : null}
          {/* Said before it is pressed: the people it is pressed on hear about it, so whoever presses knows it. */}
          {impact.lost.length && Object.values(impact.registered).some((n) => n > 0) ? (
            <li>
              <Icon name="bell" size={14} /> {t('tower.presence.impact.told')}
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

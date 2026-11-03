import { useEffect, useRef, useState } from 'preact/hooks';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { BackStep } from '../../../shared/ui/BackStep';
import { Button, Card, Chip, Icon, OptionPicker, PhoneField, ReadAloud, StepList } from '../../../shared/ui';
import { agentConfig } from '../api';
import { useT, type MessageKey } from '../../../shared/i18n';
import { BODY_HINTS, EXCLUDABLE_BODIES, FREIGHT_STEPS, PACKAGING_HELP, chooseBodyHint, dangerousGoodsValue, freightStepMissing, isDangerousNature, money, natureLabel, parseBudget, parseDims, plannedPickupIso, toggleExcludedBody, type BodyHint, type FreightStep, type PackagingChoice } from '../logic';
import type { AgentActions, AgentState } from '../useAgentApp';

const INCOTERM_OPTIONS = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'];

const STEP_NAME: Record<FreightStep, MessageKey> = {
  price: 'agent.freightSteps.step.price',
  load: 'agent.freightSteps.step.load',
  people: 'agent.freightSteps.step.people',
  day: 'agent.freightSteps.step.day',
  check: 'agent.freightSteps.step.check',
};
const STEP_TITLE: Record<FreightStep, MessageKey> = {
  price: 'agent.freightSteps.t.price',
  load: 'agent.freightSteps.t.load',
  people: 'agent.freightSteps.t.people',
  day: 'agent.freightSteps.t.day',
  check: 'agent.freightSteps.t.check',
};

/**
 * 2026-11-03 — BOOKING A WALK-UP AS FREIGHT, ONE PART PER SCREEN (the owner, of the Business app's "post a new load":
 * "chunk it up similar to the sign up process. And an indicator shows how far we are before a load goes public"). The
 * counter's freight card was as long: thirteen questions under the take-in's own. Now, once the take-in has measured it
 * and chosen the shop it goes to, the booking is the whole screen, one part at a time — the step bar pinned under the
 * top bar, Back on every step and the phone's Back with it, each step's own needs said under its button — and the
 * check, with Change to each part and who will see it, before the one button that books it.
 *
 * The answers are the take-in's own (state.accept, set by the same actions), and the booking is sent by the same
 * submitBookFreight: what is sent for the same answers is what the card sent.
 */
export function FreightBooking({ state, actions, onTakeIn, start, now }: { state: AgentState; actions: AgentActions; onTakeIn: () => void; start?: FreightStep; now?: number }) {
  const t = useT();
  const f = state.accept;
  const [step, setStep] = useState<FreightStep>(start ?? 'price');
  const titleRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const at = FREIGHT_STEPS.indexOf(step);
  const back = at > 0 ? FREIGHT_STEPS[at - 1] : null;
  const missing = freightStepMissing(step, f, now ?? Date.now(), t);

  // A new step is a new screen: read from its top, its title the first thing a screen reader says.
  useEffect(() => {
    if (!moved.current) return;
    if (typeof window !== 'undefined') window.scrollTo?.(0, 0);
    titleRef.current?.focus();
  }, [step]);

  const go = (to: FreightStep) => {
    moved.current = true;
    setStep(to);
  };

  return (
    <>
      {/* The phone's Back steps back through the booking; from its first step it goes back to the take-in. */}
      <BackStep key={step} back={() => (back ? go(back) : onTakeIn())} />
      <StepList pinned title={t('agent.freightSteps.bar')} steps={FREIGHT_STEPS.map((s) => t(STEP_NAME[s]))} at={at} />
      <h1 class="scr__title" ref={titleRef} tabIndex={-1}>
        {t(STEP_TITLE[step])}
      </h1>

      {step === 'price' ? (
        <>
          <Card label={t(STEP_NAME.price)}>
            <div class="field">
              <label class="field__label" for="freight-budget">
                {t('agent.accept.budgetLabel')}
              </label>
              <input id="freight-budget" class="input" type="number" inputMode="decimal" min="0" step="0.5" value={f.budgetCap} onInput={(e) => actions.setAccept({ budgetCap: e.currentTarget.value })} placeholder={t('agent.accept.budgetPh')} />
            </div>
            <p class="card__note">{t('agent.accept.budgetNote')}</p>
            {/* FB2b — how the load is TAKEN, as against when it is picked up. An awkward walk-up is exactly the
                case where the formula's price is worst and a driver's own number is best. */}
            <label class="checkline" style="margin-top:12px">
              <input type="checkbox" checked={f.negotiate} onChange={(e) => actions.setAccept({ negotiate: e.currentTarget.checked })} />
              <span>{t('agent.accept.negotiate')}</span>
            </label>
            <p class="card__note">{t('agent.accept.negotiateNote')}</p>
          </Card>
          <Card label={t('agent.accept.whenAria')}>
            <div class="seg" role="group" aria-label={t('agent.accept.whenAria')}>
              <button type="button" class={`seg__btn${f.freightWhen === 'now' ? ' seg__btn--on' : ''}`} aria-pressed={f.freightWhen === 'now'} onClick={() => actions.setAccept({ freightWhen: 'now' })}>
                <Icon name="truck" size={18} /> {t('agent.accept.shipNow')}
              </button>
              <button type="button" class={`seg__btn${f.freightWhen === 'planned' ? ' seg__btn--on' : ''}`} aria-pressed={f.freightWhen === 'planned'} onClick={() => actions.setAccept({ freightWhen: 'planned' })}>
                <Icon name="clock" size={18} /> {t('agent.accept.planned')}
              </button>
            </div>
            {f.freightWhen === 'planned' ? (
              <>
                <div class="field" style="margin-top:12px">
                  <label class="field__label" for="freight-date">
                    {t('agent.accept.pickupWhen')}
                  </label>
                  <input id="freight-date" class="input" type="datetime-local" value={f.freightDate} onInput={(e) => actions.setAccept({ freightDate: e.currentTarget.value })} />
                </div>
                <label class="checkline" style="margin-top:12px">
                  <input type="checkbox" checked={f.allowEarlyClaim} onChange={(e) => actions.setAccept({ allowEarlyClaim: e.currentTarget.checked })} />
                  <span>{t('agent.accept.earlyClaim')}</span>
                </label>
              </>
            ) : null}
          </Card>
        </>
      ) : null}

      {step === 'load' ? (
        <>
          {/* FB5 — how it is PACKED, asked FIRST because it is the only one of these the clerk can simply see,
              and because the two questions below read differently once it is answered. */}
          <Card label={t('agent.accept.packaging')}>
            <div class="field">
              <span class="field__label" id="freight-packaging-label">
                {t('agent.accept.packaging')}
              </span>
              {/* Chosen by LOOKING: the sheet shows all seven with their pictures, the chosen one ticked. */}
              <OptionPicker
                id="freight-packaging"
                labelledBy="freight-packaging-label"
                topic="packaging"
                title={t('agent.accept.packaging')}
                options={PACKAGING_HELP.map((p) => ({ key: p.value, label: t(p.labelKey as 'agent.accept.packBagged'), detail: t(p.detailKey as 'agent.accept.packBaggedWhy') }))}
                value={f.packaging}
                onChange={(key) => actions.setAccept({ packaging: key as PackagingChoice })}
                placeholder={t('agent.accept.packagingChoose')}
                config={agentConfig()}
              />
            </div>
            <p class="card__note">{t('agent.accept.packagingNote')}</p>
          </Card>

          {/* CMR box 9: dangerous goods by their UN number, name and class — asked only of goods declared dangerous,
              beside the rest of what the load is. */}
          {isDangerousNature(f.natureCode) ? (
            <Card label={t('agent.accept.dangerousTitle')}>
              <p class="field__label">{t('agent.accept.dangerousTitle')}</p>
              <p class="card__note">{t('agent.accept.dangerousNote')}</p>
              <div class="grid2">
                <div class="field">
                  <label class="field__label" for="freight-un">{t('agent.accept.dgUn')}</label>
                  <input id="freight-un" class="input" maxLength={8} inputMode="numeric" value={f.dgUn} onInput={(e) => actions.setAccept({ dgUn: e.currentTarget.value })} placeholder="1075" autocomplete="off" />
                </div>
                <div class="field">
                  <label class="field__label" for="freight-class">{t('agent.accept.dgClass')}</label>
                  <input id="freight-class" class="input" maxLength={8} value={f.dgClass} onInput={(e) => actions.setAccept({ dgClass: e.currentTarget.value })} placeholder="2.1" autocomplete="off" />
                </div>
              </div>
              <div class="field">
                <label class="field__label" for="freight-psn">{t('agent.accept.dgName')}</label>
                <input id="freight-psn" class="input" maxLength={200} value={f.dgName} onInput={(e) => actions.setAccept({ dgName: e.currentTarget.value })} autocomplete="off" />
              </div>
              <div class="field">
                <label class="field__label" for="freight-pg">{t('agent.accept.dgGroup')}</label>
                <select id="freight-pg" class="input" value={f.dgGroup} onChange={(e) => actions.setAccept({ dgGroup: e.currentTarget.value as never })}>
                  <option value="">{t('agent.accept.dgGroupNone')}</option>
                  <option value="I">I</option>
                  <option value="II">II</option>
                  <option value="III">III</option>
                </select>
              </div>
            </Card>
          ) : null}

          {/* FB2c — the two facts a tape measure cannot supply, asked of the one person standing at the load. */}
          <Card label={t('agent.accept.bodyHint')}>
            <label class="checkline">
              <input type="checkbox" checked={f.indivisible} onChange={(e) => actions.setAccept({ indivisible: e.currentTarget.checked })} />
              <span>{t('agent.accept.indivisible')}</span>
            </label>
            <p class="card__note">{t('agent.accept.indivisibleNote')}</p>

            <div class="field" style="margin-top:12px">
              <span class="field__label" id="freight-body-label">
                {t('agent.accept.bodyHint')}
              </span>
              {/* "I don't know" is a ROW here, not the placeholder: an honest, often correct answer. */}
              <OptionPicker
                id="freight-body"
                labelledBy="freight-body-label"
                topic="body"
                title={t('agent.accept.bodyHint')}
                options={BODY_HINTS.map((b) => ({ key: b.value, label: t(b.labelKey as 'agent.accept.bodyAny'), detail: t(b.detailKey as 'agent.accept.bodyFlatbedWhy') }))}
                value={f.bodyHint}
                onChange={(key) => actions.setAccept(chooseBodyHint(f, key as BodyHint))}
                placeholder={t('agent.accept.bodyAny')}
                config={agentConfig()}
              />
            </div>
            <p class="card__note">{t('agent.accept.bodyHintNote')}</p>

            {/* FB2d — the shipper's own refusals: the clerk GUESSES what would work, the customer DECIDES what they
                will not have. This one binds a claim, so it is worth the row of chips. */}
            <div class="field" style="margin-top:12px">
              <span class="field__label" id="freight-exclude">
                {t('agent.accept.excludedBodies')}
              </span>
              <div class="chiprow" role="group" aria-labelledby="freight-exclude">
                {EXCLUDABLE_BODIES.map((b) => (
                  <Chip key={b.value} label={t(b.labelKey as 'agent.accept.bodyAny')} active={f.excludedBodies.includes(b.value)} onClick={() => actions.setAccept(toggleExcludedBody(f, b.value))} />
                ))}
              </div>
            </div>
            <p class="card__note">{t('agent.accept.excludedBodiesNote')}</p>
          </Card>
        </>
      ) : null}

      {step === 'people' ? (
        <>
          <Card label={t('agent.accept.customerPhone')}>
            <div class="field">
              <label class="field__label" for="freight-phone">
                {t('agent.accept.customerPhone')}
              </label>
              <PhoneField id="freight-phone" value={f.customerMobile} onInput={(v) => actions.setAccept({ customerMobile: v })} autoComplete="off" />
            </div>
            <p class="card__note">{t('agent.accept.customerPhoneNote')}</p>
          </Card>
          {/* CMR box 2 (the gaps check, 2026-10-29): who receives it at the other shop, printed on the note as the consignee. */}
          <Card label={t('agent.accept.consignee')}>
            <div class="field">
              <label class="field__label" for="freight-consignee">
                {t('agent.accept.consignee')}
              </label>
              <input id="freight-consignee" class="input" maxLength={120} value={f.consigneeName} onInput={(e) => actions.setAccept({ consigneeName: e.currentTarget.value })} autocomplete="off" />
            </div>
            <p class="card__note">{t('agent.accept.consigneeNote')}</p>
          </Card>
          {/* FP7 — CMR box 13, taken down at the counter. The contact is a FIELD, not a line in the note: the driver
              dials it, and the public tracking page must be able to leave it out. */}
          <Card label={t('agent.accept.contactName')}>
            <div class="grid2">
              <div class="field">
                <label class="field__label" for="freight-contact">
                  {t('agent.accept.contactName')}
                </label>
                <input id="freight-contact" class="input" value={f.contactName} onInput={(e) => actions.setAccept({ contactName: e.currentTarget.value })} autocomplete="off" />
              </div>
              <div class="field">
                <label class="field__label" for="freight-contact-phone">
                  {t('agent.accept.contactPhone')}
                </label>
                <PhoneField id="freight-contact-phone" value={f.contactPhone} onInput={(v) => actions.setAccept({ contactPhone: v })} autoComplete="off" />
              </div>
            </div>
          </Card>
        </>
      ) : null}

      {step === 'day' ? (
        <Card label={t(STEP_NAME.day)}>
          <div class="field">
            <label class="field__label" for="freight-window">
              {t('agent.accept.deliveryWindow')}
            </label>
            <input id="freight-window" class="input" value={f.deliveryWindow} onInput={(e) => actions.setAccept({ deliveryWindow: e.currentTarget.value })} placeholder={t('agent.accept.deliveryWindowPh')} autocomplete="off" />
          </div>
          {/* CL1 — the trade term, if the customer agreed one with their buyer. Optional on purpose: most walk-ups
              have not, and a load with no term behaves exactly as it always has. */}
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="freight-term">
              {t('agent.accept.incoterm')}
            </label>
            <select id="freight-term" class="input" value={f.incoterm} onChange={(e) => actions.setAccept({ incoterm: e.currentTarget.value as never })}>
              <option value="">{t('agent.accept.incotermNone')}</option>
              {INCOTERM_OPTIONS.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <p class="hint">{t('agent.accept.incotermHint')}</p>
          </div>
          {f.incoterm ? (
            <div class="field">
              <label class="field__label" for="freight-place">
                {t('agent.accept.namedPlace')}
              </label>
              <input id="freight-place" class="input" value={f.namedPlace} onInput={(e) => actions.setAccept({ namedPlace: e.currentTarget.value })} placeholder={t('agent.accept.namedPlacePh')} autocomplete="off" />
            </div>
          ) : null}
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="freight-instructions">
              {t('agent.accept.instructions')}
            </label>
            <textarea id="freight-instructions" class="input" rows={2} maxLength={500} value={f.instructions} onInput={(e) => actions.setAccept({ instructions: e.currentTarget.value })} placeholder={t('agent.accept.instructionsPh')} />
          </div>
          <p class="card__note">{t('agent.accept.instructionsNote')}</p>
        </Card>
      ) : null}

      {step === 'check' ? <FreightCheck state={state} onChange={(s) => (s === 'goods' ? onTakeIn() : go(s))} /> : null}

      <div class="scr__cta">
        {step === 'check' ? (
          <Button onClick={() => void actions.submitBookFreight()} disabled={Boolean(missing)} busy={state.busy === 'book-freight'}>
            {t('agent.accept.bookFreight')}
          </Button>
        ) : (
          <Button onClick={() => go(FREIGHT_STEPS[at + 1])} disabled={Boolean(missing)}>
            {t('common.next')}
          </Button>
        )}
        {missing ? (
          <p class="hint" style="margin-top:8px">
            <Abbreviated text={missing} />
          </p>
        ) : null}
        <Button variant="outline" chevron={false} onClick={() => (back ? go(back) : onTakeIn())}>
          {t(back ? 'common.back' : 'agent.freightSteps.toTakeIn')}
        </Button>
      </div>
      <div class="scr__foot">
        <ReadAloud text={() => missing ?? (step === 'check' ? t('agent.accept.freightReady') : t('agent.freightSteps.stepReady'))} label={t('agent.accept.whatMissing')} />
      </div>
    </>
  );
}

/** Check and book: every part, read back with Change to it; then who will see it, before the one button that books it. */
function FreightCheck({ state, onChange }: { state: AgentState; onChange: (step: FreightStep | 'goods') => void }) {
  const t = useT();
  const f = state.accept;
  const dims = parseDims(f.dims);
  const budget = parseBudget(f.budgetCap);
  const planned = plannedPickupIso(f);
  const dg = dangerousGoodsValue(f);
  const label = <T extends { value: string; labelKey: string }>(list: readonly T[], v: string) => {
    const k = list.find((x) => x.value === v)?.labelKey;
    return k ? t(k as MessageKey) : '';
  };
  const part = (key: FreightStep | 'goods', title: string, rows: Array<[string, string | false | null | undefined]>) => {
    const shown = rows.filter((r): r is [string, string] => Boolean(r[1]));
    return (
      <Card
        title={title}
        aside={
          <button type="button" class="linkbtn" aria-label={t('agent.freightSteps.changeAria', { part: title })} onClick={() => onChange(key)}>
            {t('agent.freightSteps.change')}
          </button>
        }
      >
        {shown.length ? (
          shown.map(([k, v]) => (
            <div class="kv" key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))
        ) : (
          <p class="card__note">{t('agent.freightSteps.nothingGiven')}</p>
        )}
      </Card>
    );
  };
  const who = planned
    ? `${t('agent.freightSteps.seePlanned', { when: new Date(planned).toLocaleString() })} ${t(f.allowEarlyClaim ? 'agent.freightSteps.seeEarly' : 'agent.freightSteps.seeNotEarly')}`
    : t(f.negotiate ? 'agent.freightSteps.seeNowNegotiate' : 'agent.freightSteps.seeNowInstant');

  return (
    <>
      <p class="t-body">{t('agent.freightSteps.checkLede')}</p>
      {part('goods', t('agent.freightSteps.goods'), [
        [t('agent.accept.dimensions'), dims ? `${dims.l} × ${dims.w} × ${dims.h} cm · ${dims.kg} kg` : ''],
        [t('agent.accept.whatsInside'), natureLabel(f.natureCode, t)],
        [t('agent.freightSteps.k.to'), f.destShopName],
      ])}
      {part('price', t(STEP_NAME.price), [
        [t('agent.freightSteps.k.budget'), budget != null ? money(budget, state.agent?.currency) : ''],
        [t('agent.freightSteps.k.taken'), t(f.negotiate ? 'agent.accept.negotiate' : 'agent.freightSteps.v.instant')],
        [t('agent.freightSteps.k.when'), planned ? new Date(planned).toLocaleString() : t('agent.accept.shipNow')],
      ])}
      {part('load', t(STEP_NAME.load), [
        [t('agent.freightSteps.k.packed'), label(PACKAGING_HELP, f.packaging)],
        [t('agent.accept.dangerousTitle'), isDangerousNature(f.natureCode) && dg ? [dg.unNumber, dg.properShippingName, dg.hazardClass, dg.packingGroup].filter(Boolean).join(' · ') : ''],
        [t('agent.freightSteps.k.split'), f.indivisible ? t('agent.accept.indivisible') : ''],
        [t('agent.freightSteps.k.truck'), f.bodyHint ? label(BODY_HINTS, f.bodyHint) : ''],
        [t('agent.freightSteps.k.notTruck'), f.excludedBodies.map((b) => label(EXCLUDABLE_BODIES, b)).join(', ')],
      ])}
      {part('people', t(STEP_NAME.people), [
        [t('agent.freightSteps.k.customer'), f.customerMobile.trim()],
        [t('agent.freightSteps.k.consignee'), f.consigneeName.trim()],
        [t('agent.freightSteps.k.contact'), [f.contactName.trim(), f.contactPhone.trim()].filter(Boolean).join(' · ')],
      ])}
      {part('day', t(STEP_NAME.day), [
        [t('agent.freightSteps.k.window'), f.deliveryWindow.trim()],
        [t('agent.freightSteps.k.term'), f.incoterm ? [f.incoterm, f.namedPlace.trim()].filter(Boolean).join(' · ') : ''],
        [t('agent.freightSteps.k.instructions'), f.instructions.trim()],
      ])}
      <Card title={t('agent.freightSteps.whoTitle')}>
        <p class="t-body">{who}</p>
      </Card>
    </>
  );
}

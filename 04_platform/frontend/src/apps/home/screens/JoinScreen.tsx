import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Checklist, CodeBoxes, ErrorNote, Icon, Note, PhotoField, PlaceMap, ReadAloud, Sheet, ShopDetailSheet, PhoneField } from '../../../shared/ui';
import { EmailStep } from '../../../shared/account/EmailStep';
import { AgreementBlock, AgreementCheck } from '../../../shared/documents/Agreement';
import { countryOfNumber } from '../../../shared/phone/dial';
import { toPlaceWords } from '../../../shared/placewords';
import { useT, type MessageKey } from '../../../shared/i18n';
import { duplicateField, isIdentityDocument, type DuplicateField } from '../../../shared/duplicate';
import { IdDisputeOpen } from '../../../shared/account/IdDisputeOpen';
import { recoveryApi } from '../../../shared/account/recovery';
import { geocode, homeConfig, myAgreement } from '../api';
import { countryNameIn } from '../../../shared/documents/documents';

import { ANDROID_CHOICES, DRIVER_CLASSES, FLEET_PAPERS, fleetSignupWords, joinSpoken, joiningCountry, needsLicence, pickedClasses, pickedVehicle, roleMeta, stepBlocker, stepsFor, vehicleClassFor, type FleetPaper } from '../logic';
import { INTEREST_KINDS, MAX_INTEREST_MESSAGE, leaveInterest, type OperatingCountry } from '../api';
import type { HomeActions, HomeState } from '../useHomeApp';

export interface JoinScreenProps {
  state: HomeState;
  actions: HomeActions;
}

/**
 * The join wizard — one decision per screen, the only place in the product where an
 * account is BORN. Roles the backend can self-serve (shop, driver, hub) run the full
 * phone-verified signup; a store registers itself; a fleet office is invite-only and says
 * so instead of dead-ending.
 */
export function JoinScreen({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role;
  if (!role) return null;

  const steps = stepsFor(role.kind);
  const fleet = role.kind === 'fleet';
  // Somebody coming back to a fleet they signed up is shown it, not an empty form for a second one.
  const showSignups = fleet && state.step === 'about' && Boolean(state.fleetSignups?.length) && !state.fleetAnother;
  const at = steps.indexOf(state.step) + 1;
  const blocker = stepBlocker(role, state.step, state.form, t, notJoinable(state));

  return (
    <div class="scr">
      {state.step !== 'done' ? (
        <div class="dots" role="img" aria-label={t('home.join.step', { at, total: steps.length - 1 })}>
          {steps.slice(0, -1).map((s, i) => (
            <span key={s} class={`dots__dot${i === at - 1 ? ' dots__dot--on' : i < at - 1 ? ' dots__dot--done' : ''}`} />
          ))}
        </div>
      ) : null}

      {state.error ? duplicateField(state.error) ? <AlreadyRegistered state={state} actions={actions} /> : <ErrorNote error={state.error} /> : null}

      {state.step === 'phone' ? <PhoneStep state={state} actions={actions} /> : null}
      {state.step === 'code' ? <CodeStep state={state} actions={actions} /> : null}
      {state.step === 'pin' ? <PinStep state={state} actions={actions} /> : null}
      {state.step === 'about' ? showSignups ? <FleetSignups state={state} actions={actions} /> : fleet ? <FleetAboutStep state={state} actions={actions} /> : <AboutStep state={state} actions={actions} /> : null}
      {state.step === 'where' ? <WhereStep state={state} actions={actions} /> : null}
      {state.step === 'papers' ? <PapersStep state={state} actions={actions} /> : null}
      {state.step === 'login' ? <LoginStep state={state} actions={actions} /> : null}
      {state.step === 'done' ? fleet ? <FleetDone state={state} actions={actions} /> : <DoneStep state={state} actions={actions} /> : null}

      {state.step !== 'done' ? (
        <div class="scr__foot">
          <Button variant="link" full={false} onClick={actions.back}>
            {t('home.goBack')}
          </Button>
          <ReadAloud text={() => `${joinSpoken(role, state.step, t)} ${blocker ?? ''}`} label={t('home.readAloud')} />
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------- already registered -- */

/** What the heading says, per detail that matched. */
const DUP_TITLE: Record<DuplicateField, MessageKey> = {
  phone: 'home.dup.title.phone',
  nationalId: 'home.dup.title.nationalId',
  licence: 'home.dup.title.licence',
  device: 'home.dup.title.device',
  email: 'home.dup.title.email',
};

/** What is expected next — which depends on who is joining and which of their details matched. */
function dupDetail(role: string, field: DuplicateField): MessageKey {
  if (field === 'email') return 'home.dup.email';
  if (role === 'driver') return field === 'phone' ? 'home.dup.driver.phone' : 'home.dup.driver.identity';
  if (role === 'pudo') return field === 'phone' ? 'home.dup.shop.phone' : field === 'device' ? 'home.dup.shop.device' : 'home.dup.shop.identity';
  return 'home.dup.other';
}

/**
 * ALREADY REGISTERED — and what we expect next, which is never "try again". The same details are refused again,
 * and other details would make a second identity. So: sign in with the account that exists; put right a number
 * that was mistyped; or, where neither is possible, be told honestly that the app cannot fix it yet.
 */
const recovery = recoveryApi(homeConfig());

function AlreadyRegistered({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role!;
  const field = duplicateField(state.error)!;
  const signsIn = role.id === 'driver' || role.id === 'pudo';
  // The ID is theirs and somebody else holds it: the dispute is opened here, where they were refused, with what they typed.
  const [disputing, setDisputing] = useState(false);
  const disputable = field === 'nationalId' && signsIn;
  return (
    <div class="dup">
      <Note tone="warn" icon="lock" title={t(DUP_TITLE[field])} detail={t(dupDetail(role.id, field))} />
      <div class="crow" style="margin-top:10px">
        {signsIn ? (
          <Button full={false} chevron={false} onClick={() => window.location.assign(role.app)}>
            {t(role.id === 'driver' ? 'home.dup.openDriver' : 'home.dup.openShop')}
          </Button>
        ) : null}
        {isIdentityDocument(field) || field === 'email' ? (
          <Button variant="link" full={false} onClick={() => actions.revisit(field === 'email' ? 'login' : 'about')}>
            {t('home.dup.checkTyped')}
          </Button>
        ) : null}
        {disputable ? (
          <Button variant="link" full={false} onClick={() => setDisputing(true)}>
            {t('home.dup.dispute')}
          </Button>
        ) : null}
      </div>
      {disputable ? (
        <Sheet open={disputing} onClose={() => setDisputing(false)} title={t('home.dup.disputeTitle')}>
          {disputing ? <IdDisputeOpen api={recovery} preset={{ register: role.id === 'driver' ? 'driver' : 'shop', nationalId: state.form.nationalId, phone: state.form.phone }} /> : null}
        </Sheet>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ phone -- */

function PhoneStep({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role!;
  const blocker = stepBlocker(role, 'phone', state.form, t);
  return (
    <>
      <h1 class="scr__title">{t('home.join.joinAs', { role: roleMeta(role, t).labelLower })}</h1>
      <p class="scr__lede">{t(role.kind === 'vendor' ? 'home.join.phone.ledeStore' : role.kind === 'fleet' ? 'home.join.phone.ledeFleet' : 'home.join.phone.lede')}</p>

      <Card>
        <div class="field">
          <label class="field__label" for="phone">
            {t('home.join.phone.label')}
          </label>
          <PhoneField id="phone" value={state.form.phone} onInput={(v) => actions.setForm({ phone: v })} enterKeyHint="send" />
        </div>
      </Card>

      <div class="scr__cta">
        <Button onClick={() => void actions.sendCode()} disabled={Boolean(blocker)} busy={state.busy === 'code'}>
          {t('home.join.phone.cta')}
        </Button>
        {blocker ? <p class="hint" style="margin-top:8px">{blocker}</p> : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- code -- */

function CodeStep({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role!;
  const blocker = stepBlocker(role, 'code', state.form, t);
  return (
    <>
      <h1 class="scr__title">{t('home.join.code.title')}</h1>
      <p class="scr__lede">{t('home.join.code.lede', { phone: state.form.phone })}</p>

      <Card>
        <div class="field">
          <span class="field__label">{t('home.join.code.label')}</span>
          <CodeBoxes
            id="otp"
            label={t('home.join.code.boxLabel')}
            // Six, as every code to a phone is (2026-10-30: four boxes, widening only past four digits, let nobody type one).
            length={6}
            value={state.form.code}
            onInput={(code) => actions.setForm({ code })}
          />
        </div>
        {state.issuedCode ? <p class="hint" style="margin-top:10px">{t('home.join.code.sandbox', { code: state.issuedCode })}</p> : null}
      </Card>

      <div class="scr__cta">
        <Button onClick={() => void actions.confirmCode()} disabled={Boolean(blocker)} busy={state.busy === 'verify'}>
          {t('home.join.code.cta')}
        </Button>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- country -- */

/**
 * Which country somebody is joining in — and nothing to choose when there is only one.
 *
 * A pick list rather than a free-text code, because this decides which company contracts them and the
 * backend refuses a country with no company behind it. Typing "TZ" and being told at the end of a wizard
 * that nobody there can invoice you is the worst possible moment to find out; the list only ever offers
 * countries the network can actually take somebody on in.
 *
 * With one country the control is not rendered at all — a select with a single option is a decision nobody
 * is making. The hook has already put that country on the form, so the sign-up still names it.
 */
/** The countries nobody may register in — read off the same presence the server enforces. */
function notJoinable(state: HomeState): string[] {
  return state.countries.filter((c) => c.joinable === false).map((c) => c.country);
}

function CountryField({ id, state, actions }: JoinScreenProps & { id: string }) {
  const t = useT();
  const { countries, countriesState, form } = state;
  if (countriesState === 'error') return <Note tone="warn" icon="warning" title={t('home.join.country.unavailable')} />;
  if (countries.length < 2) return null;
  const chosenCountry = countries.find((c) => c.country === form.country);
  return (
    <div class="field" style="margin-top:12px">
      <label class="field__label" for={id}>
        {t('home.join.country.label')}
      </label>
      <select id={id} class="input" value={form.country} onChange={(e) => actions.setForm({ country: e.currentTarget.value, zone: '' })}>
        <option value="">{t('home.join.country.choose')}</option>
        {countries.map((c) => (
          <option key={c.country} value={c.country}>
            {c.name} ({c.country})
            {c.joinable === false ? ` · ${t('home.join.country.notHere')}` : c.coming ? ` · ${t('home.join.country.comingTag')}` : c.settles === false ? ` · ${t('home.join.country.noMoney')}` : ''}
          </option>
        ))}
      </select>
      {/*
       * A COUNTRY WE MATCH IN BUT DO NOT STAND IN.
       *
       * The list said "· not active yet" after the name and the note underneath promised "the company you
       * will be paid by" — which for a matched country is a company that does not exist. Money and
       * responsibility are the whole difference between the two rungs, so where there is no company the
       * page says so in full, before anybody joins, rather than leaving it to be discovered on the first
       * load delivered. Chosen deliberately as a Note and not a parenthesis: it is the most consequential
       * sentence on this screen for anybody outside the two countries with a company behind them.
       */}
      {/*
       * THREE STATES, because there are three, and collapsing them is what sent a driver away believing
       * the product was broken. A country with a company behind it; one we match in but do not stand in,
       * where the money is theirs to settle and ours to stay out of; and the rest of the world, which we
       * have not reached and should say so rather than quietly omit.
       */}
      {!chosenCountry ? (
        <p class="card__note">{t('home.join.country.activeNote')}</p>
      ) : chosenCountry.joinable === false ? (
        <>
          <Note
            tone="warn"
            icon="info"
            title={t('home.join.country.notHereTitle', { name: chosenCountry.name })}
            detail={t('home.join.country.notHereBody', { name: chosenCountry.name })}
          />
          <InterestForm country={chosenCountry} />
        </>
      ) : chosenCountry.coming ? (
        <Note tone="info" icon="clock" title={t('home.join.country.comingTitle', { name: chosenCountry.name })} detail={t('home.join.country.comingBody')} />
      ) : chosenCountry.settles === false ? (
        <Note
          tone="warn"
          icon="info"
          title={t('home.join.country.notActiveTitle', { name: chosenCountry.name })}
          detail={t('home.join.country.notActiveBody', { name: chosenCountry.name })}
        />
      ) : (
        <p class="card__note">{t('home.join.country.activeNote')}</p>
      )}
    </div>
  );
}

/**
 * ASKING TO BE TOLD WHEN THE NETWORK REACHES YOU — the way out of the only dead end on this form.
 *
 * Every country is on the list now, and most of them answer "we do not reach here yet". That is honest
 * and it is still a dead end, and the dead end is the part worth fixing: somebody who would carry freight
 * in a country we have never been to is EVIDENCE, and switching a country on is a decision that had none.
 *
 * WHAT IT ASKS FOR IS THE SHORTEST THING THAT IS ACTUALLY USEFUL. An address to write to, what they would
 * be, and WHY — the reason is the half a count cannot give, and the half a decision is made on. No name,
 * no phone, no identity: this is somebody with no account in a country we do not operate in.
 *
 * WHAT IT PROMISES IS ONLY WHAT THE SYSTEM CAN KEEP. Not "we will get back to you" — the first country
 * with three interested people and no plan is where that breaks, leaving a broken promise where an honest
 * "not yet" used to be. It promises the switch-on itself, which is sent by the approval and by nothing
 * else, and it says which of the two the country became.
 */
function InterestForm({ country }: { country: OperatingCountry }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>('carrier');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Asking again about the same country replaces the earlier note rather than adding one, so there is no
  // harm in a second go — but the thank-you stands until they change country, because it is the answer.
  if (sent) return <Note tone="ok" icon="check" title={t('home.join.interest.thanksTitle')} detail={t('home.join.interest.thanksBody', { name: country.name })} />;

  if (!open) {
    return (
      <Button variant="outline" full={false} onClick={() => setOpen(true)}>
        {t('home.join.interest.open')}
      </Button>
    );
  }

  const ready = email.includes('@') && message.trim().length > 0 && !busy;
  const send = async () => {
    setBusy(true);
    setFailed(null);
    const r = await leaveInterest(country.country, { kind, email: email.trim(), message: message.trim() });
    setBusy(false);
    if (r.error) return setFailed(r.error.detail || r.error.title);
    setSent(true);
  };

  return (
    <Card title={t('home.join.interest.title', { name: country.name })}>
      <p class="card__note">{t('home.join.interest.lede')}</p>
      <div class="chips">
        {INTEREST_KINDS.map((k) => (
          <button key={k} type="button" class={`chip chip--tap${kind === k ? ' chip--on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {t(`home.join.interest.kind.${k}` as 'home.join.interest.kind.carrier')}
          </button>
        ))}
      </div>
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="int-email">
          {t('home.join.interest.email')}
        </label>
        <input id="int-email" class="input" type="email" inputMode="email" autocomplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
      </div>
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="int-msg">
          {t('home.join.interest.message')}
        </label>
        <textarea id="int-msg" class="input" rows={4} maxLength={MAX_INTEREST_MESSAGE} value={message} onInput={(e) => setMessage(e.currentTarget.value)} />
        <p class="card__note">{t('home.join.interest.messageHint')}</p>
      </div>
      {failed ? <p class="hint">{failed}</p> : null}
      <Button chevron={false} disabled={!ready} busy={busy} onClick={() => void send()}>
        {t('home.join.interest.send')}
      </Button>
      <Button variant="link" full={false} onClick={() => setOpen(false)}>
        {t('home.goBack')}
      </Button>
    </Card>
  );
}

/* -------------------------------------------------------------- fleet: PIN -- */

/**
 * A FLEET'S PERSON CHOOSES THEIR PIN — the one the Fleet app opens with, the same PIN in every SeeBuyGet app. Asked here,
 * straight after the code, because the papers are uploaded as this person; and the first time a PIN is chosen, the
 * server asks for a recovery email behind it, confirmed by its own code, as every other door does.
 */
function PinStep({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role!;
  const f = state.form;
  const driver = role.kind === 'driver';
  const blocker = stepBlocker(role, 'pin', f, t) ?? (state.pinEmail && (!f.recoveryEmail.includes('@') || !/^\d{6}$/.test(f.recoveryCode)) ? t('home.block.recoveryEmail') : null);
  return (
    <>
      <h1 class="scr__title">{t(state.pinEmail === 'reset' ? 'account.safety.resetTitle' : state.pinEmail ? 'home.join.pin.emailTitle' : driver ? 'home.join.pin.titleDriver' : 'home.join.pin.title')}</h1>
      <p class="scr__lede">{state.pinEmail === 'reset' ? t('account.safety.resetLede') : state.pinEmail ? t('home.join.pin.emailLede') : t('home.join.pin.lede', { app: driver ? 'Driver' : 'Fleet' })}</p>

      <Card>
        <div class="field">
          <span class="field__label">{t('home.join.pin.label')}</span>
          <CodeBoxes id="fleet-pin" label={t('home.join.pin.label')} length={5} value={f.pin} onInput={(pin) => actions.setForm({ pin })} mask disabled={Boolean(state.pinEmail)} />
        </div>
        {!state.pinEmail ? <p class="card__note">{t('home.join.pin.note')}</p> : null}
        {state.pinEmail ? (
          <div class="field" style="margin-top:12px">
            <EmailStep
              id="fleet-recovery"
              email={f.recoveryEmail}
              code={f.recoveryCode}
              onEmail={(recoveryEmail) => actions.setForm({ recoveryEmail, ...(f.contactEmail ? {} : { contactEmail: recoveryEmail }) })}
              onCode={(recoveryCode) => actions.setForm({ recoveryCode })}
              send={recovery.emailCode}
              disabled={state.busy === 'pin'}
            />
          </div>
        ) : null}
        {/* Where the person's account is made: everybody signing up agrees here (2026-10-25) — to the general documents,
            their phone's country's own, and (a driver, who chose it already) the own of the country they drive in. */}
        <AgreementBlock agreed={f.agreement} onChange={(agreement) => actions.setForm({ agreement })} countries={[countryOfNumber(f.phone), driver ? f.country : undefined]} />
      </Card>

      <div class="scr__cta">
        <Button onClick={() => void actions.choosePin()} disabled={Boolean(blocker)} busy={state.busy === 'pin'}>
          {/* A driver's last step makes the driver; a fleet's person goes on to the company. */}
          {driver ? t('home.join.joinAs', { role: roleMeta(role, t).labelLower }) : t('home.join.pin.cta')}
        </Button>
        {blocker ? <p class="hint" style="margin-top:8px">{blocker}</p> : null}
      </div>
    </>
  );
}

/* ------------------------------------------------- fleet: what was signed up -- */

/**
 * SOMEBODY COMING BACK: the fleets this person signed up, where each stands, and — papers sent back — the reason and the
 * way to send them again. Without it, a refused fleet could not be put right: the same company cannot sign up twice.
 */
function FleetSignups({ state, actions }: JoinScreenProps) {
  const t = useT();
  const items = state.fleetSignups ?? [];
  return (
    <>
      <h1 class="scr__title">{t('home.fleet.mine.title')}</h1>
      <p class="scr__lede">{t('home.fleet.mine.lede')}</p>
      {items.map((s) => (
        <Card key={s.did} title={s.companyName}>
          <p class="card__note">{t(fleetSignupWords(s.status, Boolean(s.refused)))}</p>
          {s.refused ? <Note tone="warn" icon="warning" title={t('home.fleet.mine.whyTitle')} detail={s.refused.reason} /> : null}
          {s.status === 'DRAFT' ? (
            <div class="crow" style="margin-top:10px">
              <Button full={false} onClick={() => actions.resendPapers(s.did)}>
                {t('home.fleet.mine.sendAgain')}
              </Button>
            </div>
          ) : s.status === 'ACTIVE' ? (
            <div class="crow" style="margin-top:10px">
              <a class="btn btn--primary" href="/fleet/">
                {t('home.fleet.mine.open')}
              </a>
            </div>
          ) : null}
        </Card>
      ))}
      <Button variant="link" onClick={actions.signUpAnother}>
        {t('home.fleet.mine.another')}
      </Button>
    </>
  );
}

/* ------------------------------------------------------------ fleet: about -- */

/** What a member of staff would type into the console for a fleet they register — asked of the fleet itself. */
function FleetAboutStep({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role!;
  const f = state.form;
  const blocker = stepBlocker(role, 'about', f, t);
  const field = (id: string, label: string, key: 'displayName' | 'tradingName' | 'fullName' | 'nationalId' | 'businessRegistrationNo' | 'operatorLicence' | 'taxId' | 'contactEmail', more: Record<string, unknown> = {}) => (
    <div class="field" style="margin-top:12px">
      <label class="field__label" for={id}>
        {label}
      </label>
      <input id={id} class="input" value={f[key]} onInput={(e) => actions.setForm({ [key]: e.currentTarget.value } as Partial<typeof f>)} {...more} />
    </div>
  );
  return (
    <>
      <h1 class="scr__title">{t('home.fleet.about.title')}</h1>
      <p class="scr__lede">{t('home.fleet.about.lede')}</p>

      <Card title={t('home.fleet.about.company')}>
        {field('fleet-name', t('home.fleet.about.companyName'), 'displayName', { placeholder: t('home.fleet.about.companyNamePh') })}
        {field('fleet-trading', t('home.fleet.about.tradingName'), 'tradingName')}
        {field('fleet-email', t('home.fleet.about.contactEmail'), 'contactEmail', { type: 'email', autocomplete: 'email', autocapitalize: 'none', spellcheck: false, placeholder: 'office@example.com' })}
        <p class="card__note">{t('home.fleet.about.contactEmailNote')}</p>
      </Card>

      <Card title={t('home.fleet.about.numbers')}>
        {field('fleet-reg', t('home.fleet.about.businessRegistrationNo'), 'businessRegistrationNo', { spellcheck: false })}
        {field('fleet-licence', t('home.fleet.about.operatorLicence'), 'operatorLicence', { spellcheck: false })}
        {field('fleet-tax', t('home.fleet.about.taxId'), 'taxId', { spellcheck: false })}
        <p class="card__note">{t('home.fleet.about.numbersNote')}</p>
      </Card>

      <Card title={t('home.fleet.about.owner')}>
        {field('fleet-owner', t('home.join.about.fullName'), 'fullName', { placeholder: t('home.join.about.fullNamePh') })}
        {field('fleet-owner-id', t('home.join.about.idNumber'), 'nationalId', { spellcheck: false })}
        <p class="card__note">{t('home.join.about.privacyNote')}</p>
      </Card>

      <div class="scr__cta">
        <Button onClick={actions.advance} disabled={Boolean(blocker)}>
          {t('home.continue')}
        </Button>
        {blocker ? <p class="hint" style="margin-top:8px">{blocker}</p> : null}
      </div>
    </>
  );
}

/* ----------------------------------------------------------- fleet: papers -- */

const PAPER_LABEL: Record<FleetPaper, MessageKey> = {
  businessRegCertRef: 'home.fleet.papers.registration',
  operatorLicenceRef: 'home.fleet.papers.licence',
  ownerIdRef: 'home.fleet.papers.ownerId',
  proofOfAddressRef: 'home.fleet.papers.address',
};

/** The four papers, each a photograph taken now. What SeeBuyGet staff look at before the fleet is approved. */
function PapersStep({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role!;
  const f = state.form;
  // A new fleet waits for what its country asks to be settled (AgreementCheck below); papers sent again carry none.
  const blocker = stepBlocker(role, 'papers', f, t) ?? (!state.resendFor && !f.agreementHere ? t('agreement.needed') : null);
  const again = state.resendFor ? state.fleetSignups?.find((s) => s.did === state.resendFor) : undefined;
  return (
    <>
      <h1 class="scr__title">{t(again ? 'home.fleet.papers.againTitle' : 'home.fleet.papers.title')}</h1>
      <p class="scr__lede">{again ? t('home.fleet.papers.againLede', { name: again.companyName }) : t('home.fleet.papers.lede')}</p>
      {again?.refused ? <Note tone="warn" icon="warning" title={t('home.fleet.mine.whyTitle')} detail={again.refused.reason} /> : null}

      {FLEET_PAPERS.map(([key, kind]) => (
        <Card key={key} label={t(PAPER_LABEL[key])}>
          <p class="t-label">{t(PAPER_LABEL[key])}</p>
          <PhotoField
            id={`paper-${key}`}
            value={f.papers[key]}
            label={t('home.fleet.papers.take')}
            upload={(file) => actions.uploadFleetPaper(kind, file)}
            onCapture={(mediaId) => actions.setForm({ papers: { ...state.form.papers, [key]: mediaId } })}
          />
        </Card>
      ))}

      {/* The person agreed at their PIN, for their phone's country: the fleet's may ask more (2026-10-25). */}
      {!state.resendFor && state.person ? (
        <AgreementCheck read={(country) => myAgreement(state.person!, country)} country={f.country} value={f.agreementHere} onChange={(agreementHere) => actions.setForm({ agreementHere })} />
      ) : null}

      <div class="scr__cta">
        <Button onClick={() => void actions.submitFleet()} disabled={Boolean(blocker)} busy={state.busy === 'submit'}>
          {t(again ? 'home.fleet.papers.sendAgain' : 'home.fleet.papers.send')}
        </Button>
        {blocker ? <p class="hint" style="margin-top:8px">{blocker}</p> : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------- fleet: done -- */

function FleetDone({ state, actions }: JoinScreenProps) {
  const t = useT();
  const done = state.fleetSignup;
  return (
    <>
      <h1 class="scr__title">{t(state.resendFor ? 'home.fleet.done.againTitle' : 'home.fleet.done.title')}</h1>
      <p class="scr__lede">{t('home.fleet.done.lede', { name: done?.companyName ?? state.form.displayName })}</p>
      <Card title={t('home.join.done.whatNext')} tone="soft">
        <Checklist
          items={[
            state.form.contactEmail ? t('home.fleet.done.next1', { email: state.form.contactEmail }) : t('home.fleet.done.next1Plain'),
            t('home.fleet.done.next2'),
            t('home.fleet.done.next3'),
          ]}
        />
      </Card>
      <p class="card__note">{t('home.fleet.done.comeBack')}</p>
      <Button variant="link" onClick={actions.restart}>
        {t('home.join.done.restart')}
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------ about -- */

function AboutStep({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role!;
  const f = state.form;
  const blocker = stepBlocker(role, 'about', f, t);
  // Derived once, so the card and the blocker can never disagree about which vehicle is chosen.
  const chosen = vehicleClassFor(f);
  const nameLabel =
    role.id === 'pudo' ? t('home.join.about.nameShop') : role.id === 'mdp' ? t('home.join.about.nameHub') : role.id === 'vendor' ? t('home.join.about.nameStore') : t('home.join.about.nameDriver');

  return (
    <>
      <h1 class="scr__title">{role.id === 'driver' ? t('home.join.about.titleDriver') : t('home.join.about.titlePlace')}</h1>
      <p class="scr__lede">{roleMeta(role, t).promise}</p>

      <Card>
        <div class="field">
          <label class="field__label" for="dname">
            {nameLabel}
          </label>
          <input
            id="dname"
            class="input"
            value={f.displayName}
            onInput={(e) => actions.setForm({ displayName: e.currentTarget.value })}
            placeholder={role.id === 'pudo' ? t('home.join.about.phShop') : role.id === 'driver' ? t('home.join.about.phDriver') : role.id === 'mdp' ? t('home.join.about.phHub') : t('home.join.about.phStore')}
          />
        </div>

        {role.id === 'vendor' ? <CountryField id="country" state={state} actions={actions} /> : null}
        {role.id === 'vendor' ? (
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="store-address">
              {t('home.join.about.storeAddress')}
            </label>
            <input id="store-address" class="input" value={f.storeAddress} onInput={(e) => actions.setForm({ storeAddress: e.currentTarget.value })} placeholder="Biashara St 12" />
          </div>
        ) : null}

        {role.id !== 'mdp' && role.id !== 'vendor' ? (
          <>
            <div class="field" style="margin-top:12px">
              <label class="field__label" for="fname">
                {t('home.join.about.fullName')}
              </label>
              <input id="fname" class="input" value={f.fullName} onInput={(e) => actions.setForm({ fullName: e.currentTarget.value })} placeholder={t('home.join.about.fullNamePh')} />
            </div>
            <div class="field" style="margin-top:12px">
              <label class="field__label" for="nid">
                {t('home.join.about.idNumber')}
              </label>
              <input id="nid" class="input" value={f.nationalId} onInput={(e) => actions.setForm({ nationalId: e.currentTarget.value })} spellcheck={false} />
            </div>
            <p class="card__note">{t('home.join.about.privacyNote')}</p>
          </>
        ) : null}
      </Card>

      {/* A SHOP'S ANSWERS to the franchise requirements: the applicant's own, never filled in for them. */}
      {role.id === 'pudo' ? (
        <Card title={t('home.join.shop.title')}>
          <p class="card__note">{t('home.join.shop.lede')}</p>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="shop-android">
              {t('home.join.shop.android')}
            </label>
            <select id="shop-android" class="input" value={f.androidVersion} onChange={(e) => actions.setForm({ androidVersion: e.currentTarget.value })}>
              <option value="">{t('home.join.shop.androidChoose')}</option>
              {ANDROID_CHOICES.map((v) => (
                <option key={v} value={v}>
                  {v === 'older' ? t('home.join.shop.androidOlder') : v === 'none' ? t('home.join.shop.androidNone') : t('home.join.shop.androidVersion', { version: v })}
                </option>
              ))}
            </select>
            <p class="card__note">{t('home.join.shop.androidHint')}</p>
          </div>
          <div class="field" style="margin-top:12px">
            <span class="field__label" id="shop-power-label">
              {t('home.join.shop.power')}
            </span>
            <div class="chips" role="group" aria-labelledby="shop-power-label">
              {(['yes', 'no'] as const).map((v) => (
                <button key={v} type="button" id={`shop-power-${v}`} class={`chip chip--tap${f.reliablePower === v ? ' chip--on' : ''}`} aria-pressed={f.reliablePower === v} onClick={() => actions.setForm({ reliablePower: v })}>
                  {t(v === 'yes' ? 'home.join.shop.powerYes' : 'home.join.shop.powerNo')}
                </button>
              ))}
            </div>
          </div>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="shop-licence">
              {t('home.join.shop.licence')}
            </label>
            <input id="shop-licence" class="input" value={f.tradingLicence} onInput={(e) => actions.setForm({ tradingLicence: e.currentTarget.value })} spellcheck={false} />
            <p class="card__note">{t('home.join.shop.licenceHint')}</p>
          </div>
          <div class="field" style="margin-top:12px">
            <span class="field__label">{t('home.join.shop.hours')}</span>
            <div style="display:flex;gap:12px">
              <div class="field" style="flex:1">
                <label class="field__label" for="shop-opens">
                  {t('home.join.shop.opens')}
                </label>
                <input id="shop-opens" class="input" type="time" value={f.openFrom} onInput={(e) => actions.setForm({ openFrom: e.currentTarget.value })} />
              </div>
              <div class="field" style="flex:1">
                <label class="field__label" for="shop-closes">
                  {t('home.join.shop.closes')}
                </label>
                <input id="shop-closes" class="input" type="time" value={f.openTo} onInput={(e) => actions.setForm({ openTo: e.currentTarget.value })} />
              </div>
            </div>
            <p class="card__note">{t('home.join.shop.hoursHint')}</p>
          </div>
          <label class="checkline" style="margin-top:12px">
            <input id="shop-record" type="checkbox" checked={f.recordClear} onChange={(e) => actions.setForm({ recordClear: e.currentTarget.checked })} />
            <span>{t('home.join.shop.record')}</span>
          </label>
        </Card>
      ) : null}

      {/* `title`, not `label`: "What do you drive?" was the section's aria-label and rendered nothing, so
          the form showed a row of bare chips and never asked the question out loud. */}
      {role.id === 'driver' ? (
        <Card title={t('home.join.about.driveTitle')}>
          <div class="chips">
            {DRIVER_CLASSES.map((c) => {
              const on = f.licenceClasses.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  class={`chip chip--tap${on ? ' chip--on' : ''}`}
                  aria-pressed={on}
                  onClick={() => actions.setForm(pickedClasses(f, c))}
                >
                  {c}
                </button>
              );
            })}
          </div>
          <p class="card__note">{t('home.join.about.driveNote')}</p>

          {/* THE LICENCE, asked for only where the network actually requires one. Without these two
              fields anything above a motorcycle was refused outright, which is why joining independently
              looked impossible. Shown the moment a heavy class is picked, so the reason is visible. */}
          {needsLicence(f.licenceClasses) ? (
            <>
              <div class="field" style="margin-top:12px">
                <label class="field__label" for="licno">
                  {t('home.join.about.licenceNumber')}
                </label>
                <input id="licno" class="input" value={f.licenceNumber} onInput={(e) => actions.setForm({ licenceNumber: e.currentTarget.value })} spellcheck={false} />
              </div>
              <div class="field" style="margin-top:12px">
                <label class="field__label" for="licexp">
                  {t('home.join.about.licenceExpiry')}
                </label>
                <input id="licexp" class="input" type="date" value={f.licenceExpiresAt} onInput={(e) => actions.setForm({ licenceExpiresAt: e.currentTarget.value })} />
              </div>
              <p class="card__note">{t('home.join.about.licenceNote')}</p>
            </>
          ) : null}
        </Card>
      ) : null}

      {/* THE VEHICLE THEY ARRIVE WITH.
          This door makes self-employed couriers — there is no fleet code on it — and one without a
          vehicle is an account that cannot take a load: the driver app opens on "scan the sticker on the
          dashboard", and the only stickers in the network belong to vehicles a fleet registered. So it is
          asked here, and the class offered is only what they have just said they can drive. */}
      {role.id === 'driver' ? (
        <Card title={t('home.join.about.vehicleTitle')}>
          {/* THE WHOLE CATALOGUE, not the classes ticked above. Offering only those read as "these are
              the only vehicles you may have" — a driver with a truck saw a bike and a van and reasonably
              concluded the network did not carry trucks. Saying you own one also clears you to drive it. */}
          <div class="chips">
            {DRIVER_CLASSES.map((c) => (
              <button
                key={c}
                type="button"
                class={`chip chip--tap${chosen === c ? ' chip--on' : ''}`}
                aria-pressed={chosen === c}
                onClick={() => actions.setForm(pickedVehicle(f, c))}
              >
                {c}
              </button>
            ))}
          </div>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="plate">
              {t('home.join.about.vehiclePlate')}
            </label>
            <input id="plate" class="input" value={f.vehiclePlate} onInput={(e) => actions.setForm({ vehiclePlate: e.currentTarget.value })} spellcheck={false} />
          </div>
          {chosen === 'truck' ? (
            <div class="field" style="margin-top:12px">
              <span class="field__label">{t('home.join.about.truckSubtype')}</span>
              {/* Read from the network, never restated here: the catalogue runs to twenty-odd bodies and
                  combinations, and a hand-typed list in a client is wrong the day after it is written. */}
              {state.truckSubtypes.length === 0 ? (
                <p class="card__note">{t('home.join.about.truckSubtypeLoading')}</p>
              ) : (
                <div class="chips">
                  {state.truckSubtypes.map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      class={`chip chip--tap${f.truckSubtype === sub.id ? ' chip--on' : ''}`}
                      aria-pressed={f.truckSubtype === sub.id}
                      onClick={() => actions.setForm({ truckSubtype: sub.id })}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          <p class="card__note">{t('home.join.about.vehicleNote')}</p>
        </Card>
      ) : null}

      <div class="scr__cta">
        <Button
          onClick={() => actions.advance()}
          disabled={Boolean(blocker)}
        >
          {t('home.continue')}
        </Button>
        {blocker ? <p class="hint" style="margin-top:8px">{blocker}</p> : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ where -- */

/** The whole world, where nothing better is known — never one country's city for everybody. */
const WORLD = { point: { lat: 15, lng: 15 }, zoom: 2 };

/** Where the join map starts: the country's middle, looked up by its name once it is known; the world until then. */
function useCountryStart(country: string): { point: { lat: number; lng: number }; zoom: number } {
  const [start, setStart] = useState(WORLD);
  useEffect(() => {
    if (!country) return setStart(WORLD);
    let live = true;
    void geocode(countryNameIn(country, 'en'), [country]).then((r) => {
      if (live) setStart(r.data?.location ? { point: r.data.location, zoom: 6 } : WORLD);
    });
    return () => {
      live = false;
    };
  }, [country]);
  return start;
}

function WhereStep({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role!;
  const f = state.form;
  const blocker = stepBlocker(role, 'where', f, t, notJoinable(state));
  // Suggest the areas of the country being joined, not every area on the network — a Kenyan zone code is
  // no help to somebody opening in Addis, and offering it invites picking one.
  const zones = [...new Set(state.points.filter((p) => !f.country || !p.country || p.country === f.country).map((p) => p.zone).filter(Boolean))].sort();
  // The map opens on the country being joined — the one chosen, else the phone's — and shows that country's shops only.
  const country = joiningCountry(f);
  const start = useCountryStart(country);
  const [openShop, setOpenShop] = useState<string | null>(null);
  const preview = openShop ? state.points.find((p) => p.did === openShop) ?? null : null;

  return (
    <>
      <h1 class="scr__title">{role.id === 'driver' ? t('home.join.where.titleDriver') : t('home.join.where.title')}</h1>
      <p class="scr__lede">{t('home.join.where.lede')}</p>

      <PlaceMap
        label={t('home.join.where.mapLabel')}
        pins={state.points.filter((p) => p.location && (!country || !p.country || p.country === country)).map((p) => ({ id: p.did, label: p.shopName, point: p.location! }))}
        selectedId={openShop}
        onPick={setOpenShop}
        onDrop={(location) => actions.setForm({ location })}
        dropped={f.location}
        start={start}
      />

      {f.location ? (
        <Card label={t('home.join.where.wordsTitle')}>
          <p class="words">{toPlaceWords(f.location)}</p>
          <p class="card__note">{t('home.join.where.wordsNote')}</p>
          <ReadAloud text={() => t('home.join.where.wordsAloud', { words: toPlaceWords(f.location!).split(' ').join(', ') })} label={t('home.join.where.wordsAloudLabel')} />
        </Card>
      ) : (
        <Note tone="info" icon="pin" title={t('home.join.where.noPin')} />
      )}

      <Card label={t('home.join.where.areaTitle')}>
        {/* Which country first: it narrows the areas below, and it is what decides who contracts them. */}
        <CountryField id="join-country" state={state} actions={actions} />
        {/* A fleet's depot: the pin above, and the address its letters go to. No delivery area — that is a shop's. */}
        {role.kind === 'fleet' ? (
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="depot">
              {t('home.fleet.where.depotLabel')}
            </label>
            <input id="depot" class="input" value={f.landmark} onInput={(e) => actions.setForm({ landmark: e.currentTarget.value })} placeholder={t('home.fleet.where.depotPh')} />
          </div>
        ) : null}
        {/* Type-or-pick: existing network zones are SUGGESTIONS (datalist), but a shop opening in a brand-new
            area must be able to type it — a plain dropdown of existing zones would trap them (they cannot add
            an area that isn't already on the map). */}
        {role.kind !== 'fleet' ? (
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="join-zone">
            {t('home.join.where.areaLabel')}
          </label>
          <input
            id="join-zone"
            class="input"
            list="join-zones"
            value={f.zone}
            onInput={(e) => actions.setForm({ zone: e.currentTarget.value })}
            placeholder="Z-A"
            autocapitalize="characters"
          />
        </div>
        ) : null}
        {zones.length && role.kind !== 'fleet' ? (
          <datalist id="join-zones">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        ) : null}
        {role.kind !== 'fleet' ? <p class="card__note">{t('home.join.where.areaHint')}</p> : null}
        {role.id !== 'driver' && role.kind !== 'fleet' ? (
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="landmark">
              {t('home.join.where.landmarkLabel')}
            </label>
            <input id="landmark" class="input" value={f.landmark} onInput={(e) => actions.setForm({ landmark: e.currentTarget.value })} placeholder={t('home.join.where.landmarkPh')} />
          </div>
        ) : null}
      </Card>

      <div class="scr__cta">
        <Button onClick={actions.advance} disabled={Boolean(blocker)}>
          {t('home.continue')}
        </Button>
        {blocker ? <p class="hint" style="margin-top:8px">{blocker}</p> : null}
      </div>

      {/* G4b — the bearings pins are tappable: an info-only preview, so no pin is a dead tap. */}
      <ShopDetailSheet
        open={!!preview}
        title={preview?.shopName ?? t('home.join.where.shopFallback')}
        subtitle={preview ? t('home.zone', { zone: preview.zone }) : undefined}
        lines={preview ? [preview.openState === 'open' ? t('home.openNow') : t('home.closedNow')] : []}
        location={preview?.location ?? null}
        onClose={() => setOpenShop(null)}
      />
    </>
  );
}

/* ------------------------------------------------------------------ login -- */

function LoginStep({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role!;
  const f = state.form;
  const blocker = stepBlocker(role, 'login', f, t);
  return (
    <>
      <h1 class="scr__title">{t('home.join.login.title')}</h1>
      <p class="scr__lede">{t('home.join.login.lede')}</p>

      <Card>
        <div class="field">
          <label class="field__label" for="email">
            {t('home.join.login.email')}
          </label>
          <input
            id="email"
            class="input"
            type="email"
            value={f.email}
            onInput={(e) => actions.setForm({ email: e.currentTarget.value })}
            placeholder="you@example.com"
            autocomplete="username"
            autocapitalize="none"
            spellcheck={false}
          />
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="pass">
            {t('home.join.login.password')}
          </label>
          <input
            id="pass"
            class="input"
            type="password"
            value={f.password}
            onInput={(e) => actions.setForm({ password: e.currentTarget.value })}
            autocomplete="new-password"
            placeholder={t('home.join.login.passwordPh')}
          />
        </div>
        {/* Where the account is made: everybody signing up agrees here (2026-10-25) — with its country's own documents. */}
        <AgreementBlock agreed={f.agreement} onChange={(agreement) => actions.setForm({ agreement })} countries={[f.country]} />
      </Card>

      <div class="scr__cta">
        <Button onClick={() => void actions.submit()} disabled={Boolean(blocker)} busy={state.busy === 'submit'}>
          {role.kind === 'vendor' ? t('home.join.about.ctaVendor') : t('home.join.joinAs', { role: roleMeta(role, t).labelLower })}
        </Button>
        {blocker ? <p class="hint" style="margin-top:8px">{blocker}</p> : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- done -- */

function DoneStep({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role!;
  const acc = state.account;
  const store = state.store;

  return (
    <>
      <h1 class="scr__title">{t('home.join.done.title')}</h1>
      <p class="scr__lede">{role.id === 'vendor' ? t('home.join.done.ledeVendor', { email: store?.email ?? state.form.email }) : t('home.join.done.ledeWelcome', { name: state.form.displayName })}</p>

      {store ? (
        <>
          {/* Each said by name, in words on the page: a card's `label` is only read by a screen reader. */}
          <Card label={t('home.join.done.storeId')}>
            <p class="t-label">{t('home.join.done.storeId')}</p>
            <p class="cred">{store.vendorId}</p>
          </Card>
          <Card label={t('home.join.done.storeSecret')}>
            <p class="t-label">{t('home.join.done.storeSecret')}</p>
            <p class="cred">{store.secret}</p>
          </Card>
          <Card title={t('home.join.done.writeDown')} tone="soft">
            <Checklist items={[t('home.join.done.secret1'), t('home.join.done.secret2'), t('home.join.done.secret3')]} />
          </Card>
        </>
      ) : null}

      {acc ? (
        <Card title={t('home.join.done.whatNext')} tone="soft">
          <Checklist
            items={
              acc.entityStatus === 'ACTIVE'
                ? [t('home.join.done.active1'), t(role.kind === 'driver' ? 'home.join.done.active2Pin' : 'home.join.done.active2'), t('home.join.done.active3')]
                : role.id === 'mdp'
                  ? // A hub sends its papers from the Hub app first: nobody checks what has not been sent.
                    [t('home.join.done.hubPapers'), t('home.join.done.pending1'), t('home.join.done.pending3')]
                  : role.id === 'pudo'
                    ? // …and so does a shop, from the Shop app: this list said "we check your details" and never what to send.
                      [t('home.join.done.shopPapers'), t('home.join.done.pending1'), t('home.join.done.pending3')]
                    : [t('home.join.done.pending1'), t('home.join.done.pending2'), t('home.join.done.pending3')]
            }
          />
        </Card>
      ) : null}

      <div class="scr__cta">
        <a class="btn btn--primary btn--full" href={role.app}>
          {t('home.join.done.openApp', { name: roleMeta(role, t).appNoun })}
          <Icon name="chevronRight" size={20} class="btn__chev" />
        </a>
      </div>

      <Button variant="link" onClick={actions.restart}>
        {t('home.join.done.restart')}
      </Button>
    </>
  );
}

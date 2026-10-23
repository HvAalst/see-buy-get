import { useMemo, useState } from 'preact/hooks';
import { Button, Card, CodeBoxes, ErrorNote, Icon, NeedsSignalNote, Note } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import type { SbgConfig, SbgError } from '../../../lib/sbg';
import { EmailStep } from '../../../shared/account/EmailStep';
import { NewDeviceSheet } from '../../../shared/account/NewDeviceSheet';
import { SignInHelp } from '../../../shared/account/TroubleSheet';
import { AllAppsLink } from '../../../shared/ui/AllAppsLink';
import { PIN_LENGTH, isNewDevice, pinReady } from '../../../shared/account/pin';
import { asksForEmail, isPinReset, recoveryApi } from '../../../shared/account/recovery';
import { agentConfig } from '../api';
import { counterPlaces, placesInOrder, staffDoors, type CounterPlace, type CounterPlacesApi, type PersonSignIn, type StaffSession } from '../staff';

type Step = 'login' | 'phone' | 'code' | 'pin' | 'email' | 'places';

const TITLE: Record<Step, MessageKey> = {
  login: 'agent.staff.loginTitle',
  phone: 'agent.staff.phoneTitle',
  code: 'agent.staff.codeTitle',
  pin: 'agent.staff.pinTitle',
  email: 'agent.staff.emailTitle',
  places: 'agent.staff.placesTitle',
};

// Built once per app: the doors a person uses before they are signed in.
const shopDoors = staffDoors(agentConfig());
const shopRecovery = recoveryApi(agentConfig());

/**
 * ONE OF THE SHOP'S PEOPLE, SIGNING IN AT ITS COUNTER (the user, 2026-10-18: "own phone + PIN"). Their number and their
 * PIN — the same as in any SeeBuyGet app — and, the first time on this phone, a code to their number. Somebody new to
 * SeeBuyGet chooses a PIN here, with a recovery email behind it. Then the shops that added them: say yes, and work one.
 */
export function StaffSignIn({
  onBack,
  onSession,
  config,
  place = 'shop',
  words,
}: {
  onBack: () => void;
  onSession: (s: StaffSession) => Promise<void>;
  /** A hub's floor (the ISO 28000 check: "a hub's own people by name"): the hub app's config and its words. */
  config?: SbgConfig;
  place?: 'shop' | 'hub';
  words?: Partial<Record<MessageKey, MessageKey>>;
}) {
  const tt = useT();
  const t = ((key: MessageKey, params?: Record<string, string | number>) => tt(words?.[key] ?? key, params)) as typeof tt;
  const cfg = config ?? agentConfig();
  const doors = useMemo(() => (config ? staffDoors(config) : shopDoors), [config]);
  const recovery = useMemo(() => (config ? recoveryApi(config) : shopRecovery), [config]);
  /** Only the places of this app's kind: a shop's phone opens counters, a hub's opens floors. */
  const mine = (all: CounterPlace[]) => placesInOrder(all.filter((p) => (place === 'hub' ? p.kind === 'hub' : p.kind !== 'hub')));
  const [step, setStep] = useState<Step>('login');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [testCode, setTestCode] = useState('');
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailReset, setEmailReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const [places, setPlaces] = useState<CounterPlace[] | null>(null);
  const [api, setApi] = useState<CounterPlacesApi | null>(null);
  // A PIN typed on a phone no code was ever typed on: not an error, a step — the code, once.
  const [closedFor, setClosedFor] = useState<unknown>(null);
  const confirming = step === 'login' && isNewDevice(error) && closedFor !== error;

  const go = (next: Step) => {
    setStep(next);
    setError(null);
    setPin('');
    setCode('');
  };

  /** Signed in as themselves: the shops that added them. */
  const signedIn = async (who: PersonSignIn) => {
    const places = counterPlaces(cfg, who);
    const r = await places.list();
    setBusy(false);
    if (r.error) return setError(r.error);
    setApi(places);
    setPlaces(mine(r.data ?? []));
    setPin('');
    setStep('places');
  };

  const login = async () => {
    setBusy(true);
    setError(null);
    const r = await doors.login(phone, pin);
    if (r.error || !r.data) {
      setBusy(false);
      // A device that is new is not a wrong PIN: the PIN stays typed, for when the code has confirmed the device.
      if (!isNewDevice(r.error)) setPin('');
      return setError(r.error);
    }
    await signedIn(r.data);
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    const r = await doors.codeTo(phone);
    setBusy(false);
    if (r.error) return setError(r.error);
    setTestCode(r.data?.code ?? '');
    go('code');
  };

  const checkCode = async () => {
    setBusy(true);
    setError(null);
    const r = await doors.checkCode(phone, code);
    setBusy(false);
    if (r.error) {
      setCode('');
      return setError(r.error);
    }
    go('pin');
  };

  /** Choose the PIN. The first time, the server says a recovery email has to stand behind it, and asks for one. */
  const choosePin = async () => {
    setBusy(true);
    setError(null);
    const r = await doors.choosePin(phone, pin, step === 'email' ? { email, code: emailCode } : undefined);
    if (r.error || !r.data) {
      setBusy(false);
      if (step === 'pin' && asksForEmail(r.error)) {
        setEmailReset(isPinReset(r.error));
        setStep('email');
        return;
      }
      return setError(r.error);
    }
    await signedIn(r.data);
  };

  const answer = async (place: CounterPlace, yes: boolean) => {
    if (!api) return;
    setBusy(true);
    setError(null);
    const r = yes ? await api.accept(place.memberId) : await api.decline(place.memberId);
    if (r.error) {
      setBusy(false);
      return setError(r.error);
    }
    const again = await api.list();
    setBusy(false);
    if (again.error) return setError(again.error);
    setPlaces(mine(again.data ?? []));
  };

  const work = async (place: CounterPlace) => {
    if (!api) return;
    setBusy(true);
    setError(null);
    const r = await api.open(place.shopDid, place.kind);
    if (r.error || !r.data) {
      setBusy(false);
      return setError(r.error);
    }
    await onSession(r.data);
  };

  const leave = () => {
    api?.forget();
    setApi(null);
    setPlaces(null);
    go('login');
  };

  const submit = (e: Event) => {
    e.preventDefault();
    if (busy) return;
    if (step === 'login' && phone.trim() && pinReady(pin)) void login();
    else if (step === 'phone' && phone.trim()) void sendCode();
    else if (step === 'code' && code.length === 6) void checkCode();
    else if ((step === 'pin' && pinReady(pin)) || (step === 'email' && email.trim() && emailCode.length === 6)) void choosePin();
  };

  const ready =
    step === 'login' ? Boolean(phone.trim()) && pinReady(pin) : step === 'phone' ? Boolean(phone.trim()) : step === 'code' ? code.length === 6 : step === 'pin' ? pinReady(pin) : step === 'email' ? Boolean(email.trim()) && emailCode.length === 6 : false;
  const cta: MessageKey = step === 'login' ? 'agent.staff.loginCta' : step === 'phone' ? 'agent.staff.phoneCta' : step === 'code' ? 'agent.staff.codeCta' : step === 'pin' ? 'agent.staff.pinCta' : 'agent.staff.emailCta';

  if (step === 'places') {
    const list = places ?? [];
    return (
      <div class="scr">
        <h1 class="scr__title">{t('agent.staff.placesTitle')}</h1>
        <p class="scr__lede">{t('agent.staff.placesLede')}</p>
        {error ? <ErrorNote error={error} /> : null}
        {list.length === 0 ? (
          <Note tone="info" icon="info" title={t('agent.staff.noPlaces')} detail={t('agent.staff.noPlacesDetail', { phone: phone.trim() })} />
        ) : (
          <div class="rows" role="list">
            {list.map((p) => (
              <div class="row row--static" role="listitem" key={p.memberId}>
                <span class="row__ic">
                  <Icon name="home" size={24} />
                </span>
                <span class="row__body">
                  <span class="row__t">{p.shopName}</span>
                  <span class="row__s">{t(p.state === 'working' ? 'agent.staff.placeWorking' : 'agent.staff.placeInvited', { name: p.name })}</span>
                </span>
                <span class="row__end">
                  {p.state === 'working' ? (
                    <Button full={false} chevron={false} busy={busy} disabled={busy} onClick={() => void work(p)}>
                      {t('agent.staff.work')}
                    </Button>
                  ) : (
                    <>
                      <Button full={false} chevron={false} disabled={busy} onClick={() => void answer(p, true)}>
                        {t('agent.staff.yes')}
                      </Button>
                      <Button variant="link" full={false} disabled={busy} onClick={() => void answer(p, false)}>
                        {t('agent.staff.no')}
                      </Button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        <Button variant="link" onClick={leave}>
          {t('agent.staff.notMe')}
        </Button>
      </div>
    );
  }

  return (
    <form class="scr" onSubmit={submit}>
      <h1 class="scr__title">{t(step === 'email' && emailReset ? 'account.safety.resetTitle' : TITLE[step])}</h1>
      <p class="scr__lede">
        {step === 'code' ? t('agent.staff.codeLede', { phone: phone.trim() }) : step === 'email' && emailReset ? t('account.safety.resetLede') : t(`agent.staff.${step}Lede` as MessageKey)}
      </p>
      <NeedsSignalNote title={t('common.needsSignal.signInTitle')} detail={t('common.needsSignal.signInDetail')} />
      {error && !confirming ? <ErrorNote error={error} /> : null}

      <Card>
        {step === 'login' || step === 'phone' ? (
          <div class="field">
            <label class="field__label" for="staff-signin-phone">
              {t('agent.staff.phone')}
            </label>
            <input id="staff-signin-phone" class="input" type="tel" inputMode="tel" autocomplete="tel" placeholder="07XX XXX XXX" value={phone} disabled={busy} onInput={(e) => setPhone(e.currentTarget.value)} />
          </div>
        ) : null}
        {step === 'login' || step === 'pin' ? (
          <div class="field" style="margin-top:12px">
            <span class="field__label">{t(step === 'pin' ? 'agent.staff.newPin' : 'agent.staff.pin')}</span>
            <CodeBoxes id="staff-pin" label={t('agent.staff.pin')} length={PIN_LENGTH} value={pin} onInput={setPin} disabled={busy} mask={step === 'login'} />
          </div>
        ) : null}
        {step === 'code' ? (
          <div class="field">
            <span class="field__label">{t('agent.staff.code')}</span>
            <CodeBoxes id="staff-phone-code" label={t('agent.staff.code')} length={6} value={code} onInput={setCode} disabled={busy} />
            {testCode ? <p class="hint">{t('account.safety.testCode', { code: testCode })}</p> : null}
          </div>
        ) : null}
        {step === 'email' ? <EmailStep id="staff" email={email} code={emailCode} onEmail={setEmail} onCode={setEmailCode} send={recovery.emailCode} disabled={busy} /> : null}
      </Card>

      <div class="scr__cta">
        <Button type="submit" chevron={false} busy={busy} disabled={busy || !ready}>
          {t(cta)}
        </Button>
      </div>
      {/* The other door, with the form it stands in for: the shop's (or the hub's) own sign-in. */}
      <Button variant="link" onClick={onBack}>
        {t('agent.staff.ownerInstead')}
      </Button>

      {/* The same foot as every sign-in screen: the PIN's own way back, "Trouble signing in?", the other apps. */}
      <div class="scr__foot">
        {step === 'login' ? (
          <Button variant="link" full={false} onClick={() => go('phone')}>
            {t('agent.staff.firstTime')}
          </Button>
        ) : step === 'code' ? (
          <Button variant="link" full={false} onClick={() => void sendCode()}>
            {t('agent.staff.newCode')}
          </Button>
        ) : (
          <Button variant="link" full={false} onClick={() => go(step === 'email' ? 'pin' : 'login')}>
            {t('common.back')}
          </Button>
        )}
        <SignInHelp app={place === 'hub' ? 'mdp' : 'agent'} api={recovery} />
        <AllAppsLink />
      </div>

      <NewDeviceSheet
        open={confirming}
        onClose={() => setClosedFor(error)}
        api={recovery}
        phone={phone}
        onConfirmed={() => {
          setClosedFor(error);
          void login();
        }}
      />
    </form>
  );
}

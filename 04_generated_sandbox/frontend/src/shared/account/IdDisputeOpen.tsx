import { useState } from 'preact/hooks';
import { Button, CodeBoxes, RefusalNote } from '../ui';
import { useT } from '../i18n';
import type { SbgError } from '../../lib/sbg';
import { IdDisputeCase } from './IdDisputeCase';
import type { IdRegister } from './idDispute';
import type { RecoveryApi } from './recovery';

/**
 * "SOMEBODY ELSE REGISTERED WITH MY NATIONAL ID." Whoever was refused at registration opens a dispute here: what
 * they were registering as, the number on their own card, and their phone confirmed by a code — the phone is what
 * the ID is kept for if it is decided to be theirs. Then the same sheet becomes their side of it: the reference and
 * the three photographs.
 *
 * Reached from "Trouble signing in?" in every app, and from the refusal itself where somebody registers — which is
 * where they are standing when they need it. What they had typed there comes along.
 */
export function IdDisputeOpen({ api, preset }: { api: RecoveryApi; preset?: { register?: IdRegister; nationalId?: string; phone?: string } }) {
  const t = useT();
  const [register, setRegister] = useState<IdRegister>(preset?.register ?? 'driver');
  const [nationalId, setNationalId] = useState(preset?.nationalId ?? '');
  const [phone, setPhone] = useState(preset?.phone ?? '');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [testCode, setTestCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  if (reference) return <IdDisputeCase api={api.idDispute} reference={reference} />;

  const sendCode = async () => {
    setBusy(true);
    const r = await api.phoneCode(phone.trim());
    setBusy(false);
    setError(r.error ?? null);
    if (r.error) return;
    setSent(true);
    setVerified(false);
    setCode('');
    setTestCode(r.data?.code ?? '');
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    if (!verified) {
      const v = await api.verifyPhone(phone.trim(), code);
      if (v.error) {
        setBusy(false);
        return setError(v.error);
      }
      setVerified(true);
    }
    const r = await api.openIdDispute({ register, nationalId: nationalId.trim(), phone: phone.trim() });
    setBusy(false);
    if (r.error || !r.data) return setError(r.error ?? null);
    setReference(r.data.reference);
  };

  const ready = nationalId.trim().length >= 3 && phone.trim() && (verified || code.length === 6);
  return (
    <>
      <p class="t-body">{t('account.id.open.lede')}</p>
      <div class="field">
        <span class="field__label">{t('account.id.open.as')}</span>
        <div class="chips" role="group">
          {(['driver', 'shop'] as const).map((r) => (
            <button type="button" key={r} class={`chip chip--tap${register === r ? ' chip--on' : ''}`} aria-pressed={register === r} onClick={() => setRegister(r)} disabled={busy}>
              {t(r === 'driver' ? 'account.id.open.driver' : 'account.id.open.shop')}
            </button>
          ))}
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="idd-number">
          {t('account.id.open.number')}
        </label>
        <input id="idd-number" class="input input--mono" value={nationalId} onInput={(e) => setNationalId(e.currentTarget.value)} spellcheck={false} disabled={busy} />
        <p class="hint">{t('account.id.open.numberHint')}</p>
      </div>
      <div class="field">
        <label class="field__label" for="idd-phone">
          {t('account.id.open.phone')}
        </label>
        <input
          id="idd-phone"
          class="input"
          type="tel"
          inputMode="tel"
          value={phone}
          disabled={busy}
          onInput={(e) => {
            setPhone(e.currentTarget.value);
            setSent(false);
            setVerified(false);
          }}
          placeholder="+2547…"
        />
        <p class="hint">{t('account.id.open.phoneHint')}</p>
      </div>
      <Button variant="outline" chevron={false} disabled={busy || !phone.trim()} onClick={() => void sendCode()}>
        {t(sent ? 'account.safety.sendAgain' : 'account.safety.sendPhoneCode')}
      </Button>
      {sent ? (
        <div class="field">
          <span class="field__label">{t('account.safety.phoneCodeLabel')}</span>
          <CodeBoxes id="idd-phone-code" label={t('account.safety.phoneCodeLabel')} length={6} value={code} onInput={setCode} disabled={busy || verified} />
          {testCode ? <p class="hint">{t('account.safety.testCode', { code: testCode })}</p> : null}
        </div>
      ) : null}
      {error ? <RefusalNote error={error} /> : null}
      <Button chevron={false} disabled={!ready} busy={busy} onClick={() => void submit()}>
        {t('account.id.open.cta')}
      </Button>
    </>
  );
}

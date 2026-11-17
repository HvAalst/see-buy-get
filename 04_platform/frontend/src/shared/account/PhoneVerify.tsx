import { useState } from 'preact/hooks';
import { Button, ErrorNote, PhoneField } from '../ui';
import { useT } from '../i18n';
import { publicRequest, type SbgConfig, type SbgError } from '../../lib/sbg';
import { CodeWayChoice, OtherWays, rememberWay, rememberedWay, type CodeWay } from './CodeWays';
import { TruecallerOffer } from './Truecaller';

/**
 * Round 40 — A NUMBER, VERIFIED BY ITS CODE, inside a form (a store signing up: the user, "Hubs and stores now"). The number,
 * a code sent to it, the code typed — and the form is told the number once it is proven. In a sandbox the code is shown.
 */
export function PhoneVerify({ config, verified, onVerified, label }: { config: SbgConfig; verified: string; onVerified: (phone: string) => void; label: string }) {
  const t = useT();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<{ phone: string; code?: string; at?: number; via?: CodeWay } | null>(null);
  // 2026-11-16 — how the code comes: by text, or an app offered for this number (the plan's D2 to D4).
  const [way, setWay] = useState<CodeWay>(rememberedWay());
  const ask = async (via: CodeWay) => {
    setBusy(true);
    setError(null);
    const r = await publicRequest<{ code?: string; otp?: string }>(config, '/v1/sbg/auth/phone/request', { body: { phone: clean, ...(via !== 'sms' ? { via } : {}) } });
    setBusy(false);
    if (r.error) return setError(r.error);
    rememberWay(via);
    setSent({ phone: clean, at: Date.now(), via, ...(r.data?.code ?? r.data?.otp ? { code: r.data?.code ?? r.data?.otp } : {}) });
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const clean = phone.replace(/[\s()-]/g, '');
  const plausible = /^\+?\d{7,15}$/.test(clean);

  if (verified) {
    return (
      <div class="field" style="margin-top:12px">
        <span class="field__label">{label}</span>
        <p class="t-body">{t('account.phoneVerify.done', { phone: verified })}</p>
      </div>
    );
  }
  return (
    <div class="field" style="margin-top:12px">
      <label class="field__label" for="verify-phone">
        {label}
      </label>
      {error ? <ErrorNote error={error} /> : null}
      <PhoneField id="verify-phone" value={phone} onInput={(v) => setPhone(v)} disabled={busy || Boolean(sent)} />
      {sent ? (
        <>
          <input id="verify-code" class="input" style="margin-top:8px" inputMode="numeric" autocomplete="one-time-code" maxLength={6} value={code} disabled={busy} onInput={(e) => setCode(e.currentTarget.value)} placeholder={t('account.phoneVerify.codePlaceholder')} />
          {sent.code ? <p class="hint">{t('account.safety.testCode', { code: sent.code })}</p> : null}
          <OtherWays config={config} phone={sent.phone} sentAt={sent.at ?? 0} sentVia={sent.via ?? 'sms'} busy={busy} onSend={(w) => void ask(w)} />
          <Button
            variant="outline"
            busy={busy}
            disabled={busy || !/^\d{4,6}$/.test(code.trim())}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const r = await publicRequest(config, '/v1/sbg/auth/phone/verify', { body: { phone: sent.phone, code: code.trim() } });
              setBusy(false);
              if (r.error) return setError(r.error);
              onVerified(sent.phone);
            }}
          >
            {t('account.phoneVerify.check')}
          </Button>
          {/* A number typed wrong is changed here, not by closing the form. */}
          <Button variant="link" full={false} disabled={busy} onClick={() => { setSent(null); setCode(''); setError(null); }}>
            {t('account.phoneVerify.another')}
          </Button>
        </>
      ) : (
        <>
          <CodeWayChoice config={config} phone={clean} value={way} onChange={setWay} />
          <Button variant="outline" busy={busy} disabled={busy || !plausible} onClick={() => void ask(way)}>
            {t('account.phoneVerify.send')}
          </Button>
          {/* 2026-11-17 — or confirmed by Truecaller, no code: the form is told the number at once. */}
          <TruecallerOffer config={config} phone={clean} disabled={busy || !plausible} onConfirmed={() => onVerified(clean)} onFallback={() => ask('sms')} />
        </>
      )}
      <p class="hint">{t('account.phoneVerify.why')}</p>
    </div>
  );
}

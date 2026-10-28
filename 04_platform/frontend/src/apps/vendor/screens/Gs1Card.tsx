import { useCallback, useEffect, useState } from 'preact/hooks';
import { Abbreviated } from '../../../shared/ui/Abbr';
import type { SbgError } from '../../../lib/sbg';
import { formatDate, useT } from '../../../shared/i18n';
import { PREFIX_TAKEN, cleanPrefix, maySendLicence, mayTakeBack, stillWorthShowing, type Gs1DisputeView } from '../../../shared/gs1';
import { Button, Card, Choice, Note, Pill, RefusalNote, Sheet } from '../../../shared/ui';
import { storeDisputeLine, storeGs1Line, type StoreGs1Api } from '../gs1';
import type { VendorState } from '../useVendorApp';

/**
 * Round 29 — THE STORE'S GS1 COMPANY PREFIX ("A store's labels carry a GS1 code"; "In the Store app, as a business does").
 *
 * The store's own, as everything on this screen is: staff never set it. With one, each parcel gets an SSCC once it is
 * paid — a GS1-128 barcode on its label beside our QR, what a receiving warehouse scans into its own system. Refused the
 * digit another prints under, the store may say the prefix is its own with its GS1 licence; using a prefix somebody
 * disputes, it is told at its bell and sends its own licence here. Two members of SeeBuyGet staff decide.
 */
export function Gs1Card({ state, api }: { state: VendorState; api: StoreGs1Api | null }) {
  const t = useT();
  const gs1 = state.vendor?.gs1;
  const [open, setOpen] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [digit, setDigit] = useState('0');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<SbgError | null>(null);
  const [bad, setBad] = useState(false);
  /** Refused because another prints under it: what was asked, to say it is ours. */
  const [taken, setTaken] = useState<{ prefix: string; digit: number } | null>(null);
  const [disputes, setDisputes] = useState<Gs1DisputeView[]>([]);

  const load = useCallback(async () => {
    if (!api) return;
    const items = await api.disputes();
    if (items) setDisputes(items.filter((d) => stillWorthShowing(d, Date.now())));
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  const start = () => {
    setPrefix(gs1?.companyPrefix ?? '');
    setDigit(String(gs1?.extensionDigit ?? 0));
    setRefused(null);
    setBad(false);
    setTaken(null);
    setOpen(true);
  };
  /** A prefix or digit changed: what was refused was another one, so its refusal and its claim go. */
  const edited = (change: () => void) => {
    change();
    setRefused(null);
    setTaken(null);
  };
  const save = async () => {
    const clean = cleanPrefix(prefix);
    setBad(!clean);
    if (!clean || !api) return;
    setBusy(true);
    setRefused(null);
    setTaken(null);
    const { error } = await api.set(clean, Number(digit));
    setBusy(false);
    if (error?.code === PREFIX_TAKEN) setTaken({ prefix: clean, digit: Number(digit) });
    if (error) return setRefused(error);
    setOpen(false);
  };
  const giveUp = async () => {
    if (!api) return;
    setBusy(true);
    const { error } = await api.clear();
    setBusy(false);
    setRefused(error);
  };

  return (
    <>
      <Card
        title={t('vendor.gs1.title')}
        aside={
          api ? (
            <Button variant="link" full={false} onClick={start}>
              {t(gs1 ? 'vendor.gs1.change' : 'vendor.gs1.set')}
            </Button>
          ) : undefined
        }
      >
        <p class="card__note"><Abbreviated text={t('vendor.gs1.lede')} /></p>
        <p class="t-body" style="margin-top:8px">
          <Abbreviated text={gs1 ? storeGs1Line(gs1, t) : t('vendor.gs1.none')} />
        </p>
        {gs1 ? (
          <Button variant="link" full={false} busy={busy && !open} onClick={() => void giveUp()}>
            {t('vendor.gs1.remove')}
          </Button>
        ) : null}
        {refused && !open ? <RefusalNote error={refused} /> : null}
        {disputes.map((d) => (
          <DisputeLine key={d.disputeId} d={d} api={api} onChanged={() => void load()} />
        ))}
      </Card>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('vendor.gs1.sheetTitle')}>
        <div class="field">
          <label class="field__label" for="gs1-prefix">
            {t('vendor.gs1.prefix')}
          </label>
          <input id="gs1-prefix" class="input input--mono" inputMode="numeric" maxLength={24} value={prefix} onInput={(e) => edited(() => setPrefix(e.currentTarget.value))} />
          <p class="hint"><Abbreviated text={bad ? t('vendor.gs1.badPrefix') : t('vendor.gs1.prefixHint')} /></p>
        </div>
        <div class="field" style="margin-top:12px">
          <Choice
            id="gs1-digit"
            as="chips"
            label={t('vendor.gs1.digit')}
            value={digit}
            options={Array.from({ length: 10 }, (_, d) => ({ value: String(d), label: String(d) }))}
            onChange={(v) => edited(() => setDigit(v))}
          />
          <p class="hint">{t('vendor.gs1.digitHint')}</p>
        </div>
        {refused ? <RefusalNote error={refused} /> : null}
        {/* Refused another's digit, the store may still choose another and save — the claim is the other way out. */}
        <Button chevron={false} busy={busy} onClick={() => void save()}>
          {t('vendor.gs1.save')}
        </Button>
        <Button variant="link" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
        {taken && api ? (
          <ClaimPrefix
            api={api}
            prefix={taken.prefix}
            digit={taken.digit}
            onOpened={() => {
              setTaken(null);
              setRefused(null);
              setOpen(false);
              void load();
            }}
          />
        ) : null}
      </Sheet>
    </>
  );
}

/** "This prefix is ours": a photograph or a screenshot of the store's GS1 licence, and a word for staff. */
function ClaimPrefix({ api, prefix, digit, onOpened }: { api: StoreGs1Api; prefix: string; digit: number; onOpened: () => void }) {
  const t = useT();
  const [licence, setLicence] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refused, setRefused] = useState<SbgError | null>(null);
  const photo = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setFailed(false);
    const id = await api.licencePhoto(file);
    setBusy(false);
    if (!id) return setFailed(true);
    setLicence(id);
  };
  const send = async () => {
    if (!licence) return;
    setBusy(true);
    setRefused(null);
    const { error } = await api.open({ companyPrefix: prefix, extensionDigit: digit, licenceRef: licence, ...(note.trim() ? { note: note.trim() } : {}) });
    setBusy(false);
    if (error) return setRefused(error);
    onOpened();
  };
  return (
    <div style="margin-top:12px">
      <p class="t-body"><Abbreviated text={t('vendor.gs1.claimLede', { prefix })} /></p>
      <div class="field" style="margin-top:10px">
        <label class="field__label" for="gs1-licence">
          {t('vendor.gs1.licence')}
        </label>
        <input id="gs1-licence" class="input" type="file" accept="image/*" disabled={busy} onChange={(e) => void photo(e.currentTarget.files?.[0])} />
        <p class="hint">{failed ? t('vendor.gs1.photoFailed') : licence ? t('vendor.gs1.licenceReady') : t('vendor.gs1.licenceHint')}</p>
      </div>
      <div class="field" style="margin-top:10px">
        <label class="field__label" for="gs1-note">
          {t('vendor.gs1.noteLabel')}
        </label>
        <textarea id="gs1-note" class="input" rows={2} maxLength={500} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      </div>
      {refused ? <RefusalNote error={refused} /> : null}
      <Button chevron={false} busy={busy} disabled={!licence} onClick={() => void send()}>
        {t('vendor.gs1.claimSend')}
      </Button>
    </div>
  );
}

/** One dispute the store is in: where it stands, and what it can do about it. */
function DisputeLine({ d, api, onChanged }: { d: Gs1DisputeView; api: StoreGs1Api | null; onChanged: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refused, setRefused] = useState<SbgError | null>(null);
  const line = storeDisputeLine(d, t, (iso) => formatDate(iso, { day: 'numeric', month: 'long' }));
  const after = async (r: Promise<{ error: SbgError | null }>) => {
    setBusy(true);
    setRefused(null);
    const { error } = await r;
    setBusy(false);
    if (error) return setRefused(error);
    onChanged();
  };
  const answer = async (file: File | undefined) => {
    if (!file || !api) return;
    setBusy(true);
    setFailed(false);
    const id = await api.licencePhoto(file);
    setBusy(false);
    if (!id) return setFailed(true);
    await after(api.sendLicence(d.disputeId, id));
  };
  return (
    <div style="margin-top:14px">
      <Pill tone={line.tone}>{t('vendor.gs1.d.tag', { prefix: d.companyPrefix })}</Pill>
      {line.tone === 'idle' ? <p class="hint">{line.text}</p> : <Note tone={line.tone} title={line.text} />}
      {api && maySendLicence(d) ? (
        <div class="field" style="margin-top:8px">
          <label class="field__label" for={`gs1-answer-${d.disputeId}`}>
            {t(d.licenceSent ? 'vendor.gs1.answerAgain' : 'vendor.gs1.answer')}
          </label>
          <input id={`gs1-answer-${d.disputeId}`} class="input" type="file" accept="image/*" disabled={busy} onChange={(e) => void answer(e.currentTarget.files?.[0])} />
          {failed ? <p class="hint">{t('vendor.gs1.photoFailed')}</p> : null}
        </div>
      ) : null}
      {api && mayTakeBack(d) ? (
        <Button variant="link" full={false} busy={busy} onClick={() => void after(api.withdraw(d.disputeId))}>
          {t('vendor.gs1.takeBack')}
        </Button>
      ) : null}
      {refused ? <RefusalNote error={refused} /> : null}
    </div>
  );
}

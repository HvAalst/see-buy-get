import { useCallback, useEffect, useState } from 'preact/hooks';
import { formatDate, useT } from '../../../shared/i18n';
import type { BusinessClient, BusinessView } from '../api';
import { PREFIX_TAKEN, disputeLine, maySendLicence, mayTakeBack, stillWorthShowing, type Gs1DisputeView } from '../gs1Dispute';
import { cleanPrefix, gs1Line } from '../papers';
import type { BusinessActions } from '../useBusinessApp';

/**
 * THE BUSINESS'S GS1 COMPANY PREFIX — what puts the global barcode on its packages beside our code.
 *
 * Its own, like everything else on this screen: an owner sets it, everybody in the business reads it, staff never
 * change it. The prefix is the one GS1 licensed to the business; the extension digit is the one it sets aside for
 * labels printed here, so its own systems never give the same code.
 *
 * Round 18 — a prefix is shared only under different extension digits. Refused the digit another business prints under,
 * an owner may say the prefix is its own with its GS1 licence; a business using a prefix somebody disputes is asked for
 * its own here. Two members of SeeBuyGet staff decide, and the reason is read here too.
 */
export function Gs1Panel({ business, actions, client, owner }: { business: BusinessView; actions: BusinessActions; client: BusinessClient | null; owner: boolean }) {
  const t = useT();
  const gs1 = business.gs1;
  const [editing, setEditing] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [digit, setDigit] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Refused because another business uses the prefix: what was asked, to say it is ours. */
  const [taken, setTaken] = useState<{ prefix: string; digit: number } | null>(null);
  const [disputes, setDisputes] = useState<Gs1DisputeView[]>([]);

  const loadDisputes = useCallback(async () => {
    if (!client) return;
    const r = await client.gs1Disputes();
    if (r.data) setDisputes(r.data.items.filter((d) => stillWorthShowing(d, Date.now())));
  }, [client]);
  useEffect(() => {
    void loadDisputes();
  }, [loadDisputes]);

  const start = () => {
    setPrefix(gs1?.companyPrefix ?? '');
    setDigit(String(gs1?.extensionDigit ?? 0));
    setError(null);
    setTaken(null);
    setEditing(true);
  };
  const save = async (e: Event) => {
    e.preventDefault();
    const clean = cleanPrefix(prefix);
    if (!clean) return setError(t('business.gs1.badPrefix'));
    if (!client) return;
    setBusy(true);
    setError(null);
    const r = await client.setGs1(clean, Number(digit));
    setBusy(false);
    if (r.error?.code === PREFIX_TAKEN) setTaken({ prefix: clean, digit: Number(digit) });
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    actions.setBusiness(r.data);
    setEditing(false);
    actions.say(t('business.gs1.saved'));
  };
  const remove = async () => {
    if (!client) return;
    setBusy(true);
    const r = await client.clearGs1();
    setBusy(false);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    actions.setBusiness(r.data);
    actions.say(t('business.gs1.removed'));
  };

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.gs1.title')}</span>
      </div>
      <p class="cons__lede">{t('business.gs1.lede')}</p>
      {editing ? (
        <form onSubmit={(e) => void save(e)}>
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.gs1.prefix')}</span>
              <input id="gs1-prefix" class="cinput" inputMode="numeric" maxLength={24} value={prefix} onInput={(e) => setPrefix((e.target as HTMLInputElement).value)} />
              <span class="chint">{t('business.gs1.prefixHint')}</span>
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('business.gs1.digit')}</span>
              <select id="gs1-digit" class="cinput" value={digit} onChange={(e) => setDigit((e.target as HTMLSelectElement).value)}>
                {Array.from({ length: 10 }, (_, d) => (
                  <option key={d} value={String(d)}>
                    {d}
                  </option>
                ))}
              </select>
              <span class="chint">{t('business.gs1.digitHint')}</span>
            </label>
          </div>
          {error ? <p class="cerr">{error}</p> : null}
          {taken && client ? (
            <ClaimPrefix
              client={client}
              prefix={taken.prefix}
              digit={taken.digit}
              onOpened={() => {
                setTaken(null);
                setError(null);
                setEditing(false);
                actions.say(t('business.gs1.claimSent'));
                void loadDisputes();
              }}
            />
          ) : null}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => setEditing(false)}>
              {t('business.gs1.cancel')}
            </button>
            <button type="submit" class="cbtn cbtn--primary" disabled={busy}>
              {t('business.gs1.save')}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p class="crow__sub">{gs1 ? gs1Line(gs1, t) : t('business.gs1.none')}</p>
          {owner ? (
            <div class="twr-panelend">
              {gs1 ? (
                <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => void remove()}>
                  {t('business.gs1.remove')}
                </button>
              ) : null}
              <button type="button" class={`cbtn ${gs1 ? 'cbtn--ghost' : 'cbtn--primary'}`} disabled={busy} onClick={start}>
                {t(gs1 ? 'business.gs1.change' : 'business.gs1.set')}
              </button>
            </div>
          ) : (
            <p class="chint">{t('business.gs1.ownerOnly')}</p>
          )}
          {error ? <p class="cerr">{error}</p> : null}
        </>
      )}
      {disputes.map((d) => (
        <DisputeLine key={d.disputeId} d={d} client={client} owner={owner} onChanged={() => void loadDisputes()} />
      ))}
    </section>
  );
}

/** "This prefix is ours": a photograph or screenshot of the GS1 licence, and a word for staff. */
function ClaimPrefix({ client, prefix, digit, onOpened }: { client: BusinessClient; prefix: string; digit: number; onOpened: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [licence, setLicence] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <div class="twr-panelend">
        <button type="button" class="cbtn cbtn--ghost" onClick={() => setOpen(true)}>
          {t('business.gs1.claim')}
        </button>
      </div>
    );
  }
  const photo = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const id = await client.licencePhoto(file);
    setBusy(false);
    if (!id) return setError(t('business.gs1.photoFailed'));
    setLicence(id);
  };
  const send = async () => {
    if (!licence) return;
    setBusy(true);
    setError(null);
    const r = await client.openGs1Dispute({ companyPrefix: prefix, extensionDigit: digit, licenceRef: licence, ...(note.trim() ? { note: note.trim() } : {}) });
    setBusy(false);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    onOpened();
  };
  return (
    <div class="cnote">
      <p class="chint">{t('business.gs1.claimLede', { prefix })}</p>
      <label class="cfield">
        <span class="cfield__label">{t('business.gs1.licence')}</span>
        <input id="gs1-licence" class="cinput" type="file" accept="image/*" disabled={busy} onChange={(e) => void photo((e.currentTarget as HTMLInputElement).files?.[0])} />
        <span class="chint">{licence ? t('business.gs1.licenceReady') : t('business.gs1.licenceHint')}</span>
      </label>
      <label class="cfield">
        <span class="cfield__label">{t('business.gs1.noteLabel')}</span>
        <textarea id="gs1-note" class="cinput" rows={2} maxLength={500} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
      </label>
      {error ? <p class="cerr">{error}</p> : null}
      <div class="twr-panelend">
        <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => setOpen(false)}>
          {t('business.gs1.cancel')}
        </button>
        <button type="button" class="cbtn cbtn--primary" disabled={busy || !licence} onClick={() => void send()}>
          {t('business.gs1.claimSend')}
        </button>
      </div>
    </div>
  );
}

/** One dispute this business is in: where it stands, and what it can do about it. */
function DisputeLine({ d, client, owner, onChanged }: { d: Gs1DisputeView; client: BusinessClient | null; owner: boolean; onChanged: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const day = (iso: string) => formatDate(iso, { day: 'numeric', month: 'long' });
  const line = disputeLine(d, t, day);
  const run = async (fn: () => Promise<{ error?: { detail?: string; title?: string } | null }>) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.error) return setError(r.error.detail || r.error.title || null);
    onChanged();
  };
  const answer = async (file: File | undefined) => {
    if (!file || !client) return;
    setBusy(true);
    const id = await client.licencePhoto(file);
    setBusy(false);
    if (!id) return setError(t('business.gs1.photoFailed'));
    await run(() => client.sendGs1Licence(d.disputeId, id));
  };
  return (
    <div class="cnote" style="margin-top:10px">
      <span class={`ctag ctag--${line.tone === 'idle' ? 'quiet' : line.tone}`}>{t('business.gs1.d.tag', { prefix: d.companyPrefix })}</span>
      <p class="crow__sub">{line.text}</p>
      {owner && client && maySendLicence(d) ? (
        <label class="cfield">
          <span class="cfield__label">{t(d.licenceSent ? 'business.gs1.answerAgain' : 'business.gs1.answer')}</span>
          <input id={`gs1-answer-${d.disputeId}`} class="cinput" type="file" accept="image/*" disabled={busy} onChange={(e) => void answer((e.currentTarget as HTMLInputElement).files?.[0])} />
        </label>
      ) : null}
      {owner && client && mayTakeBack(d) ? (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => void run(() => client.withdrawGs1Dispute(d.disputeId))}>
            {t('business.gs1.takeBack')}
          </button>
        </div>
      ) : null}
      {error ? <p class="cerr">{error}</p> : null}
    </div>
  );
}


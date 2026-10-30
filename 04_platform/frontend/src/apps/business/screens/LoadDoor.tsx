import { Abbreviated } from '../../../shared/ui/Abbr';
import { useState } from 'preact/hooks';
import { useT, type Translate } from '../../../shared/i18n';
import { InstructionsBlock } from '../../../shared/InstructionsBlock';
import { hasInstructions } from '../../../shared/instructions';
import { utcMoment } from '../../../shared/refusal';
import type { BusinessClient, PostedLoad } from '../api';

type Attempt = NonNullable<PostedLoad['attempts']>[number];

/** "27 Oct at 08:00 UTC — nobody was there to receive it: “Gate locked”". */
export function attemptWords(a: Attempt, t: Translate): string {
  const why = t(`business.door.why.${a.outcome}` as never);
  return t('business.door.attempt', { when: utcMoment(a.at), why: a.note ? `${why}: “${a.note}”` : why });
}

/**
 * AT THE DOOR (the user, 2026-10-27: "Business sees attempts"): every door the driver stood at and could not hand over at —
 * as the Shop app has always shown its counter bookings — and what the driver is told: the instructions, which the business
 * rewrites until the goods are taken over and adds a note to once they are on the road. The driver holding it is told at once.
 */
export function LoadDoor({ row, client, act, onChanged }: { row: PostedLoad; client: BusinessClient | null; act: boolean; onChanged: (message?: string) => void | Promise<void> }) {
  const t = useT();
  const amend = row.instructionsMode === 'amend';
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ text: '', contactName: '', contactPhone: '', deliveryWindow: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempts = row.attempts ?? [];
  const mayWrite = act && Boolean(client) && (row.instructionsMode === 'edit' || amend);
  if (!attempts.length && !hasInstructions(row.instructions) && !mayWrite) return null;

  const start = () => {
    setForm(amend ? { text: '', contactName: '', contactPhone: '', deliveryWindow: '' } : { text: row.instructions?.text ?? '', contactName: row.instructions?.contactName ?? '', contactPhone: row.instructions?.contactPhone ?? '', deliveryWindow: row.instructions?.deliveryWindow ?? '' });
    setError(null);
    setOpen(true);
  };
  const save = async () => {
    if (!client) return;
    if (amend && form.text.trim().length < 2) return setError(t('business.door.err.note'));
    setBusy(true);
    setError(null);
    const body = amend ? { text: form.text.trim() } : { text: form.text.trim() || undefined, contactName: form.contactName.trim() || undefined, contactPhone: form.contactPhone.trim() || undefined, deliveryWindow: form.deliveryWindow.trim() || undefined };
    const r = await client.shipping.setFreightInstructions(row.freightId, body);
    setBusy(false);
    if (r.error) return setError((r.error as { detail?: string; title?: string }).detail || (r.error as { title?: string }).title || '');
    setOpen(false);
    await onChanged(t(amend ? 'business.door.sent' : 'business.door.saved'));
  };
  const field = (key: 'text' | 'contactName' | 'contactPhone' | 'deliveryWindow', label: string, multi = false) => (
    <label class="cfield">
      <span class="cfield__label">{label}</span>
      {multi ? (
        <textarea class="cinput" rows={3} maxLength={500} value={form[key]} onInput={(e) => setForm((f) => ({ ...f, [key]: (e.target as HTMLTextAreaElement).value }))} />
      ) : (
        <input class="cinput" maxLength={key === 'contactPhone' ? 32 : 80} value={form[key]} onInput={(e) => setForm((f) => ({ ...f, [key]: (e.target as HTMLInputElement).value }))} />
      )}
    </label>
  );

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.door.title')}</span>
        {attempts.length ? <span class="ctag ctag--warn">{t('business.door.attempts', { n: attempts.length })}</span> : null}
      </div>
      {attempts.map((a) => (
        <p class="cons__lede" key={a.at}>
          {attemptWords(a, t)}
        </p>
      ))}
      <p class="cons__lede">
        <b>{t('business.door.forDriver')}</b>
      </p>
      {hasInstructions(row.instructions) ? <InstructionsBlock view={row.instructions} /> : <p class="cons__lede">{t('business.door.nothingSaid')}</p>}
      {!mayWrite ? null : !open ? (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={start}>
            {t(amend ? 'business.door.add' : 'business.door.change')}
          </button>
        </div>
      ) : (
        <>
          <p class="cons__lede">{t(amend ? 'business.door.addBody' : 'business.door.changeBody')}</p>
          {amend ? null : (
            <div class="biz-two">
              {field('contactName', t('business.loads.f.contactName'))}
              {field('contactPhone', t('business.loads.f.contactPhone'))}
            </div>
          )}
          {amend ? null : field('deliveryWindow', t('business.door.windowLabel'))}
          {field('text', t(amend ? 'business.door.noteLabel' : 'business.door.textLabel'), true)}
          {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary" disabled={busy} onClick={() => void save()}>
              {t(amend ? 'business.door.send' : 'business.door.save')}
            </button>
            <button type="button" class="cbtn cbtn--ghost" onClick={() => setOpen(false)}>
              {t('business.door.cancel')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

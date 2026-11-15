import { useState } from 'preact/hooks';
import type { SbgClient, SbgError } from '../../../lib/sbg';
import type { Uploaded } from '../../../shared/upload';
import { Button, Choice, ErrorNote, Note, Sheet } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { frontDoorUrl } from '../../../shared/frontDoor';
import { PhotoField } from './PhotoField';

/** What the person who paid sees of the hold on the driver's pay (2026-11-15, H1–H3). */
export interface HoldView {
  heldUntil?: string;
  canReport?: boolean;
  reported?: boolean;
  holdWords?: string;
}

const KINDS = ['damaged', 'short', 'not_received', 'wrong'] as const;
type Kind = (typeof KINDS)[number];
const KIND_WORDS: Record<Kind, MessageKey> = {
  damaged: 'send.hold.kindDamaged',
  short: 'send.hold.kindShort',
  not_received: 'send.hold.kindNotReceived',
  wrong: 'send.hold.kindWrong',
};

/** The page that explains the protocol to everybody — the same one every decision notice links to. */
export const holdHelpUrl = () => `${frontDoorUrl()}help/when-something-goes-wrong/`;

/**
 * 2026-11-15 — THE HOLD, AS THE PERSON WHO PAID SEES IT (the owner: "very simple … a protocol can be explained to all
 * parties"). Delivered: the driver's pay waits 24 hours; within them they report a problem — what kind, in their words, with
 * a photo of what they can see. Then SeeBuyGet applies the protocol and both sides read the step that decided.
 */
export function HoldBlock({ freightId, hold, client, upload, onChanged }: { freightId: string; hold: HoldView; client: SbgClient | null; upload: (file: File) => Promise<Uploaded>; onChanged?: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind | ''>('');
  const [words, setWords] = useState('');
  const [photo, setPhoto] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const [sent, setSent] = useState(false);
  if (!hold.heldUntil && !hold.holdWords && !hold.reported) return null;
  const reported = Boolean(hold.reported) || sent;
  const needsPhoto = kind !== 'not_received';
  const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const send = async () => {
    if (!client || !kind) return;
    setBusy(true);
    setError(null);
    const r = await client.request((c) =>
      c.POST('/v1/sbg/dispatch/freight/{id}/claim', { params: { path: { id: freightId } }, body: { kind, description: words.trim(), ...(needsPhoto && photo ? { photoRef: photo } : {}) } as never }),
    );
    setBusy(false);
    if (r.error) {
      setError(r.error as SbgError);
      return;
    }
    setSent(true);
    setOpen(false);
    onChanged?.();
  };
  return (
    <>
      {hold.holdWords ? (
        <Note tone="info" icon="check" title={t('send.hold.decided')} detail={hold.holdWords} />
      ) : reported ? (
        <Note tone="info" icon="clock" title={t('send.hold.reported')} detail={t('send.hold.reportedDetail')} />
      ) : hold.heldUntil ? (
        <p class="hint">{t('send.hold.until', { time: when(hold.heldUntil) })}</p>
      ) : null}
      {hold.canReport && !reported ? (
        <Button variant="outline" chevron={false} onClick={() => { setKind(''); setWords(''); setPhoto(''); setError(null); setOpen(true); }}>
          {t('send.hold.report')}
        </Button>
      ) : null}
      <p class="hint">
        <a href={holdHelpUrl()} target="_blank" rel="noopener">
          {t('send.hold.how')}
        </a>
      </p>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('send.hold.report')}>
        {error ? <ErrorNote error={error} /> : null}
        <p class="card__note">{t('send.hold.lede')}</p>
        <div class="field">
          <Choice id={`hold-kind-${freightId}`} label={t('send.hold.what')} options={KINDS.map((k) => ({ value: k, label: t(KIND_WORDS[k]) }))} value={kind} onChange={(v) => setKind(v as Kind)} />
        </div>
        <div class="field">
          <label class="field__label" for={`hold-words-${freightId}`}>
            {t('send.hold.words')}
          </label>
          <input id={`hold-words-${freightId}`} class="input" value={words} maxLength={1000} onInput={(e) => setWords(e.currentTarget.value)} placeholder={t('send.hold.wordsPh')} />
        </div>
        {needsPhoto ? <PhotoField id={`hold-photo-${freightId}`} value={photo} label={t('send.hold.photo')} upload={upload} onCapture={setPhoto} disabled={busy} /> : null}
        <Button chevron={false} disabled={!kind || words.trim().length < 3 || (needsPhoto && !photo)} busy={busy} onClick={() => void send()}>
          {t('send.hold.send')}
        </Button>
        <Button variant="link" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
      </Sheet>
    </>
  );
}

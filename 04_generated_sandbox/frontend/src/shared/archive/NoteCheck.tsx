import { useState } from 'preact/hooks';
import { Button, Card, Note } from '../ui';
import { useT } from '../i18n';
import type { ProofAnswer } from '../../lib/sbg/personas/archive';

export interface NoteCheckProps {
  /** Runs the check. Returns the answer, or null when the call itself failed. */
  check: (sha256: string) => Promise<ProofAnswer | null>;
  /** Pre-filled from a deep link, so a printed address plus a fingerprint lands on the answer. */
  initial?: string;
  /** Standalone on the public page; inside a card in an app. */
  bare?: boolean;
}

/**
 * IS THIS THE DOCUMENT SEEBUYGET ISSUED?
 *
 * The same component in two places, and the second one is the point. Inside an app it saves a fleet
 * holding a note a shipper emailed them from leaving to a web page. On the public front door it serves
 * the people who actually need this answer and will never have an account here — an insurer weighing a
 * claim, a forwarder, a magistrate, the other side's lawyer.
 *
 * It takes the fingerprint printed at the foot of the note, and answers about that alone: never the
 * document, never the parties, never the route. A fingerprint cannot be guessed or reversed, so whoever
 * is asking already holds the document and there is nothing here to probe at.
 */
export function NoteCheck({ check, initial = '', bare = false }: NoteCheckProps) {
  const t = useT();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<ProofAnswer | null>(null);
  const [failed, setFailed] = useState(false);

  // Somebody typing 64 characters off a printed page will introduce spaces and capitals; neither is a
  // different fingerprint, and refusing them would be pedantry dressed as rigour.
  const cleaned = value.replace(/\s+/g, '').toLowerCase();
  const looksRight = /^[0-9a-f]{64}$/.test(cleaned);

  const run = async () => {
    setBusy(true);
    setFailed(false);
    setAnswer(null);
    const result = await check(cleaned);
    setBusy(false);
    if (!result) return setFailed(true);
    setAnswer(result);
  };

  const body = (
    <>
      <p class="hint">{t('verify.lede')}</p>
      <div class="field">
        <label class="field__label" for="verify-fp">{t('verify.label')}</label>
        <input
          id="verify-fp"
          class="input mono-t"
          type="text"
          autocomplete="off"
          spellcheck={false}
          placeholder={t('verify.placeholder')}
          value={value}
          onInput={(e) => setValue(e.currentTarget.value)}
        />
        {/* Said while they type rather than after they press: 64 characters is easy to get wrong and a
            refusal after the fact reads as "your document is not ours", which is a different claim. */}
        {value && !looksRight ? <p class="hint">{t('verify.notAFingerprint')}</p> : null}
      </div>
      <Button busy={busy} onClick={() => void run()} disabled={!looksRight}>
        {t('verify.check')}
      </Button>

      {failed ? <Note tone="warn" icon="offline" title={t('verify.failedTitle')} detail={t('verify.failedDetail')} /> : null}
      {answer ? (
        <Note
          tone={answer.known ? 'ok' : 'danger'}
          icon={answer.known ? 'check' : 'warning'}
          title={answer.known ? t('verify.genuine') : t('verify.unknown')}
          /* The server's own sentence, shown as written: it IS the finding, and paraphrasing a finding
             on the client is how two versions of one answer start existing. */
          detail={answer.says}
        />
      ) : null}
    </>
  );

  // Standalone, the page needs its own heading: inside an app the Card supplies one, and a public page
  // that opens straight onto a paragraph reads as a fragment of something else.
  return bare ? (
    <div class="scr">
      <h1 class="scr__title">{t('verify.title')}</h1>
      {body}
    </div>
  ) : (
    <Card title={t('verify.inApp')}>{body}</Card>
  );
}

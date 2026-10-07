import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { Button, Note } from '../ui';
import { useT } from '../i18n';
import { canShareFiles, fileNameFor, handOverFile, type HandedOver } from './handOver';
import { linkSays, looksLikeAKey, type LinkAnswer } from './documentLink';

export interface DocumentLinkPageProps {
  /** The key out of the address. Held here and nowhere else: the address bar no longer shows it. */
  linkKey: string;
  /** Ask what the link is. */
  look: (key: string) => Promise<LinkAnswer>;
  /** Take the file. Null when it could not be taken — and then the link is asked about again. */
  take: (key: string) => Promise<Blob | null>;
  /** Go and check a copy somebody already holds. */
  onVerify: () => void;
}

/**
 * THE PAGE AN EMAIL'S BUTTON OPENS — a consignment note, handed to whoever holds the link, with nobody signed in.
 *
 * It says what the link is BEFORE anything is taken: which note, between where and where, and until when the link
 * works. Then one button hands the file to the phone's own share sheet (their Drive, their mail, a chat) or into
 * their downloads. The file is the copy to keep: the link stops, and after its keeping the note itself is gone.
 *
 * A link that no longer opens is said as what happened to it, and who to turn to — the sender, never us: the note
 * is theirs to give. Nothing here asks anybody to join anything to read a document they were sent.
 */
export function DocumentLinkPage({ linkKey, look, take, onVerify }: DocumentLinkPageProps) {
  const t = useT();
  const [answer, setAnswer] = useState<LinkAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [handed, setHanded] = useState<HandedOver | 'failed' | null>(null);
  const share = useMemo(() => canShareFiles(), []);

  const ask = useCallback(async () => {
    setAnswer(null);
    // Something that cannot be a key is not asked about: a mail program cut the address short.
    setAnswer(looksLikeAKey(linkKey) ? await look(linkKey) : { failed: 'not_ours' });
  }, [linkKey, look]);

  useEffect(() => {
    void ask();
  }, [ask]);

  const says = answer ? linkSays(answer, t) : null;
  const number = answer && 'view' in answer ? answer.view.number : undefined;

  const takeIt = async () => {
    setBusy(true);
    setHanded(null);
    const blob = await take(linkKey);
    if (!blob) {
      setBusy(false);
      setHanded('failed');
      // It may have stopped between the look and the taking: say what it is now.
      return void ask();
    }
    const how = await handOverFile(fileNameFor(number ?? ''), blob, number ?? t('doclink.title'));
    setBusy(false);
    setHanded(how);
    // One opening fewer: what is left is said from the server, not counted here.
    setAnswer(await look(linkKey));
  };

  return (
    <div class="scr">
      <h1 class="scr__title">{t('doclink.title')}</h1>
      {says === null ? (
        <p class="hint" role="status">
          {t('doclink.loading')}
        </p>
      ) : (
        <>
          <Note tone={says.tone} icon={says.icon} title={says.title} detail={says.lines.join(' ')} />
          {says.canTake ? (
            <>
              <Button busy={busy} onClick={() => void takeIt()}>
                {t(share ? 'archive.shareBundle' : 'archive.exportBundle')}
              </Button>
              <p class="hint">{t(share ? 'archive.shareBundleHint' : 'archive.exportBundleHint')}</p>
            </>
          ) : null}
          {handed === 'shared' || handed === 'saved' ? (
            <p class="hint" role="status">
              {t(handed === 'shared' ? 'doclink.handed.shared' : 'doclink.handed.saved', { name: fileNameFor(number ?? '') })}
            </p>
          ) : null}
          {handed === 'failed' && says.canTake ? (
            <p class="hint" role="alert">
              {t('doclink.handed.failed')}
            </p>
          ) : null}
          {says.canRetry ? (
            <Button variant="outline" onClick={() => void ask()}>
              {t('doclink.again')}
            </Button>
          ) : null}
          {says.canVerify ? (
            <Button variant="outline" onClick={onVerify}>
              {t('doclink.verify')}
            </Button>
          ) : null}
          <p class="hint">{t('doclink.own')}</p>
        </>
      )}
    </div>
  );
}

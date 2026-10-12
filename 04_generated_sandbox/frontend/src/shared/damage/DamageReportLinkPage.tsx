import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { Button, Note } from '../ui';
import { useT } from '../i18n';
import { canShareFiles, handOverFile, type HandedOver } from '../archive/handOver';
import { looksLikeAKey, reportFileName, reportLinkSays, type ReportLinkAnswer } from './damageReport';

export interface DamageReportLinkPageProps {
  /** The key out of the address. Held here and nowhere else: the address bar no longer shows it. */
  linkKey: string;
  /** Ask what the link is. */
  look: (key: string) => Promise<ReportLinkAnswer>;
  /** Take the file. Null when it could not be taken — and then the link is asked about again. */
  take: (key: string) => Promise<Blob | null>;
}

/**
 * THE PAGE A LINK TO A DAMAGE CLAIM REPORT OPENS — for an insurer, a sender, whoever the claimant chose to hand it
 * to, with nobody signed in.
 *
 * It says what the link is BEFORE anything is taken: which report, on which parcel, and until when the link works.
 * Then one button hands over the file. It says what the report is and what it is not — the record, and no verdict —
 * because the person reading this page may never have heard of SeeBuyGet.
 *
 * A link that no longer opens is said as what happened to it, and who to turn to: whoever gave it to them, never
 * us. The report is theirs to give. Nothing here asks anybody to join anything to read what they were sent.
 */
export function DamageReportLinkPage({ linkKey, look, take }: DamageReportLinkPageProps) {
  const t = useT();
  const [answer, setAnswer] = useState<ReportLinkAnswer | null>(null);
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

  const says = answer ? reportLinkSays(answer, t) : null;
  const view = answer && 'view' in answer ? answer.view : undefined;

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
    const how = await handOverFile(reportFileName(view?.number), blob, view?.number ?? t('dreport.title'));
    setBusy(false);
    setHanded(how);
    // One opening fewer: what is left is said from the server, not counted here.
    setAnswer(await look(linkKey));
  };

  return (
    <div class="scr">
      <h1 class="scr__title">{t('dreport.link.pageTitle')}</h1>
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
                {t(share ? 'dreport.file.share' : 'dreport.file.save')}
              </Button>
              <p class="hint">{t('dreport.file.hint')}</p>
              {view?.sha256 ? (
                <div class="kv">
                  <span>{t('dreport.section.fingerprint')}</span>
                  <b class="mono-t" style="word-break:break-all">{view.sha256}</b>
                </div>
              ) : null}
            </>
          ) : null}
          {handed === 'shared' || handed === 'saved' ? (
            <p class="hint" role="status">
              {t(handed === 'shared' ? 'doclink.handed.shared' : 'doclink.handed.saved', { name: reportFileName(view?.number) })}
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
          <p class="hint">{t('dreport.link.whatItIs')}</p>
        </>
      )}
    </div>
  );
}

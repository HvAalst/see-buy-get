import { useMemo, useState } from 'preact/hooks';
import type { SbgClient } from '../../lib/sbg';
import { Button, Card, Note } from '../ui';
import { useT } from '../i18n';
import { day } from '../archive/words';
import { canShareFiles, handOverFile, passOnLink, waysToPassOn, type HandedOver, type PassedOn } from '../archive/handOver';
import { reportFileName, reportLinkRowSays, reportSections } from './damageReport';
import { useDamageReport } from './useDamageReport';

export interface DamageReportCardProps {
  client: SbgClient | null;
  parcelId: string;
  /** The report's own number, as the parcel names it. */
  number: string;
}

/**
 * THE DAMAGE CLAIM REPORT, ON THE PARCEL IT IS ABOUT — for whoever it was made for.
 *
 * Three things somebody with a claim does with it, in the order they do them: read it; take the file, which is the
 * copy to keep; and hand it on — to an insurer, to the sender, to whoever they choose. Nothing here sends it to
 * anybody: the user, 2026-10-12, "to an insurer of the claimants choice, to the claimant themselves". The choice is
 * the claimant's, so the handing over is too.
 *
 * A link opens the report with nobody signed in. So each one made is shown, with how often it was used, and can be
 * stopped; and the address is shown ONCE, because the server keeps no copy of the key.
 */
export function DamageReportCard({ client, parcelId, number }: DamageReportCardProps) {
  const t = useT();
  const r = useDamageReport(client, parcelId);
  const [open, setOpen] = useState(false);
  const [handed, setHanded] = useState<HandedOver | 'failed' | null>(null);
  const [passed, setPassed] = useState<PassedOn | null>(null);
  const [asking, setAsking] = useState('');
  const share = useMemo(() => canShareFiles(), []);
  const ways = useMemo(() => waysToPassOn(), []);
  const sections = useMemo(() => (r.report ? reportSections(r.report, t) : []), [r.report, t]);

  const read = () => {
    setOpen((o) => !o);
    if (!open && r.phase !== 'ready') void r.load();
  };
  const take = async () => {
    setHanded(null);
    const blob = await r.takeFile();
    if (!blob) return setHanded('failed');
    setHanded(await handOverFile(reportFileName(number), blob, t('dreport.title')));
  };
  const pass = async (how: 'share' | 'copy') => {
    if (r.made) setPassed(await passOnLink(r.made.url, `${t('dreport.title')} ${number}`, how, ways));
  };

  return (
    <Card title={t('dreport.title')} label={number}>
      <p class="hint">{t('dreport.lede')}</p>

      <Button variant="outline" chevron={false} onClick={read}>
        {t(open ? 'dreport.putAway' : 'dreport.read')}
      </Button>
      {open && r.phase === 'loading' ? <p class="hint" role="status">{t('dreport.loading')}</p> : null}
      {open && r.phase === 'error' ? (
        <p class="hint" role="alert">
          {t('dreport.failed')}{' '}
          <button type="button" class="linkbtn" onClick={() => void r.load()}>
            {t('doclink.again')}
          </button>
        </p>
      ) : null}
      {open && r.report ? (
        <div>
          <p class="hint">{r.report.body.statement}</p>
          {sections.map((s) => (
            <section key={s.title}>
              <h3 class="scr__section">{s.title}</h3>
              {s.rows.map((row, i) =>
                row.label ? (
                  <div key={i} class="kv">
                    <span>{row.label}</span>
                    <b>{row.value}</b>
                  </div>
                ) : (
                  <p key={i} class="hint" style="word-break:break-word">{row.value}</p>
                ),
              )}
            </section>
          ))}
        </div>
      ) : null}

      <h3 class="scr__section">{t('dreport.keepTitle')}</h3>
      <Button busy={r.taking} onClick={() => void take()}>
        {t(share ? 'dreport.file.share' : 'dreport.file.save')}
      </Button>
      <p class="hint">{t('dreport.file.hint')}</p>
      {handed === 'shared' || handed === 'saved' ? (
        <p class="hint" role="status">
          {t(handed === 'shared' ? 'doclink.handed.shared' : 'doclink.handed.saved', { name: reportFileName(number) })}
        </p>
      ) : null}
      {handed === 'failed' ? <p class="hint" role="alert">{t('doclink.handed.failed')}</p> : null}

      <h3 class="scr__section">{t('dreport.link.title')}</h3>
      <p class="hint">{t('dreport.link.lede')}</p>
      {r.made ? (
        <>
          <Note tone="warn" icon="warning" title={t('dreport.link.madeTitle')} detail={t('dreport.link.madeDetail', { date: day(r.made.link.expiresAt) })} />
          <div class="field">
            <label class="field__label" for="made-report-link">
              {t('archive.links.madeLabel')}
            </label>
            <input id="made-report-link" class="input mono-t" type="text" readOnly value={r.made.url} onFocus={(e) => e.currentTarget.select()} />
          </div>
          {ways.share ? <Button onClick={() => void pass('share')}>{t('archive.links.send')}</Button> : null}
          {ways.copy ? (
            <Button variant={ways.share ? 'outline' : 'primary'} onClick={() => void pass('copy')}>
              {t('archive.links.copy')}
            </Button>
          ) : null}
          {passed === 'shared' || passed === 'copied' || passed === 'shown' ? (
            <p class="hint" role="status">
              {t(passed === 'shared' ? 'archive.links.passedShared' : passed === 'copied' ? 'archive.links.passedCopied' : 'archive.links.passedShown')}
            </p>
          ) : null}
        </>
      ) : (
        <Button variant="outline" busy={r.making} onClick={() => void r.makeLink().then(() => setPassed(null))}>
          {t('dreport.link.make')}
        </Button>
      )}
      {r.problem ? <p class="hint" role="alert">{r.problem}</p> : null}

      {r.links.length ? (
        <div class="rows" role="list">
          {r.links.map((l) => {
            const says = reportLinkRowSays(l, t);
            return (
              <div key={l.linkId} class="row row--static" role="listitem">
                <span class="row__body">
                  <span class="row__t">{says.title}</span>
                  <span class="row__s">{asking === l.linkId ? t('archive.links.cancelAsk') : says.detail}</span>
                </span>
                {says.working && asking !== l.linkId ? (
                  <Button variant="link" danger full={false} onClick={() => setAsking(l.linkId)}>
                    {t('archive.links.cancel')}
                  </Button>
                ) : null}
                {says.working && asking === l.linkId ? (
                  <span class="row__end">
                    <Button variant="link" danger full={false} busy={r.cancelling === l.linkId} onClick={() => void r.cancelLink(l.linkId).then(() => setAsking(''))}>
                      {t('archive.links.cancelYes')}
                    </Button>
                    <Button variant="link" full={false} onClick={() => setAsking('')}>
                      {t('archive.links.cancelNo')}
                    </Button>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}

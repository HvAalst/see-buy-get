import { Abbreviated } from '../../../shared/ui/Abbr';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { adviserSays, bounceListenWords, checkSays, countWords, mailAddressWords, mailSays, momentWords, pushSays, routerSays, smsCapWords, smsCountryWords, smsSays, waitingWords, type Connections, type RouterCheck } from '../connections';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * WHAT THIS SERVER IS CONNECTED TO — the routing server and the adviser behind a fleet's planning panel, and the
 * email, the push and the text that carries a code behind everybody.
 *
 * Both are set where the server runs, and until this the only place that said so was a README. A fleet's office is
 * told what it needs where it works (its plan says which distances it was made on); whether the service behind that
 * is set up and answering is staff's to see, and to put right.
 *
 * Nothing is changed from here. The routing server can be asked one question; the adviser is not asked anything, since
 * a question to it is a question paid for — what the last office's question met says whether it is answering.
 */
export function ConnectionsScreen({ actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [view, setView] = useState<Connections | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<RouterCheck | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.connections();
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || t('tower.conn.unread'));
    setError(null);
    setView(r.data as unknown as Connections);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const ask = async () => {
    if (!client) return;
    setChecking(true);
    const r = await client.api.checkRouter();
    setChecking(false);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || t('tower.conn.unread'));
    setError(null);
    setCheck(r.data as unknown as RouterCheck);
  };

  const router = view ? routerSays(view.router, view.since, t) : null;
  const adviser = view ? adviserSays(view.adviser, view.since, t) : null;
  const mail = view ? mailSays(view.mail, view.sandbox, view.since, t) : null;
  const push = view ? pushSays(view.push, view.sandbox, view.since, t) : null;
  const sms = view ? smsSays(view.sms, view.sandbox, view.since, t, view.reviewCode) : null;
  const checked = check ? checkSays(check, t) : null;

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.conn.title')}</h1>
        <p class="cons__lede">{t('tower.conn.lede')}</p>
      </header>
      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}

      {view === null ? (
        error ? null : (
          <p class="cons__empty">{t('tower.imports.loading')}</p>
        )
      ) : (
        <>
          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.conn.router.title')}</span>
              <span class={`ctag ctag--${router!.tone}`}>{router!.tag}</span>
            </div>
            <p class="cons__lede">{router!.line}</p>
            <dl class="cons__facts">
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.address')}</dt>
                <dd class="cons__factv">{view.router.host ?? (view.router.configured ? t('tower.conn.fact.notAnAddress') : t('tower.conn.fact.none'))}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.profile')}</dt>
                <dd class="cons__factv">{view.router.profile}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.most')}</dt>
                <dd class="cons__factv">{t('tower.conn.fact.mostValue', { n: view.router.maxPoints })}</dd>
              </div>
            </dl>
            {view.router.configured ? (
              <>
                {checked ? (
                  <p class={checked.tone === 'ok' ? 'cnote' : 'cerr'} role="status">
                    {checked.line} <span class="chint">{t('tower.conn.check.at', { when: momentWords(check!.at) })}</span>
                  </p>
                ) : null}
                <div class="twr-panelend">
                  <button type="button" class="cbtn cbtn--ghost" disabled={checking} onClick={() => void ask()}>
                    {t(checking ? 'tower.conn.check.asking' : 'tower.conn.check.cta')}
                  </button>
                </div>
                <p class="chint">{t('tower.conn.check.what')}</p>
              </>
            ) : null}
            <p class="chint">{t('tower.conn.router.where')}</p>
          </section>

          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.conn.adviser.title')}</span>
              <span class={`ctag ctag--${adviser!.tone}`}>{adviser!.tag}</span>
            </div>
            <p class="cons__lede">{adviser!.line}</p>
            <dl class="cons__facts">
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.key')}</dt>
                <dd class="cons__factv">{t(view.adviser.configured ? 'tower.conn.fact.keySet' : 'tower.conn.fact.keyNone')}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.model')}</dt>
                <dd class="cons__factv">{view.adviser.model}</dd>
              </div>
            </dl>
            <p class="chint">{t('tower.conn.adviser.where')}</p>
          </section>

          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.conn.mail.title')}</span>
              <span class={`ctag ctag--${mail!.tone}`}>{mail!.tag}</span>
            </div>
            <p class="cons__lede">{mail!.line}</p>
            <dl class="cons__facts">
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.leaves')}</dt>
                <dd class="cons__factv">{t(view.mail.sends ? 'tower.conn.fact.leavesYes' : 'tower.conn.fact.leavesNo')}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.token')}</dt>
                <dd class="cons__factv">{t(view.mail.tokenSet ? 'tower.conn.fact.keySet' : 'tower.conn.fact.keyNone')}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.providerAddress')}</dt>
                <dd class="cons__factv">{mailAddressWords(view.mail, t)}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.from')}</dt>
                <dd class="cons__factv">{view.mail.fromIsPlaceholder ? t('tower.conn.fact.fromPlaceholder', { from: view.mail.from }) : view.mail.from}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.written')}</dt>
                <dd class="cons__factv">{countWords(view.mail.written, view.mail.failed, t, true)}</dd>
              </div>
              {view.mail.sends ? (
                <>
                  <div class="cons__fact">
                    <dt class="cons__factk">{t('tower.conn.fact.waiting')}</dt>
                    <dd class="cons__factv">{waitingWords(view.mail, t)}</dd>
                  </div>
                  <div class="cons__fact">
                    <dt class="cons__factk">{t('tower.conn.fact.sentLater')}</dt>
                    <dd class="cons__factv">{view.mail.sentLater}</dd>
                  </div>
                  <div class="cons__fact">
                    <dt class="cons__factk">{t('tower.conn.fact.gaveUp')}</dt>
                    <dd class="cons__factv">{view.mail.gaveUp}</dd>
                  </div>
                  <div class="cons__fact">
                    <dt class="cons__factk">{t('tower.conn.fact.reserved')}</dt>
                    <dd class="cons__factv">{view.mail.reserved}</dd>
                  </div>
                  <div class="cons__fact">
                    <dt class="cons__factk">{t('tower.conn.fact.bounced')}</dt>
                    <dd class="cons__factv">{view.mail.bounced}</dd>
                  </div>
                </>
              ) : null}
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.bounces')}</dt>
                <dd class="cons__factv">{bounceListenWords(view.mail, t)}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.stopped')}</dt>
                <dd class="cons__factv">{view.mail.bounces.stopped}</dd>
              </div>
            </dl>
            <p class="chint">
              <Abbreviated text={t('tower.conn.mail.where')} />
              {view.sandbox && !view.mail.sends ? ` ${t('tower.conn.mail.whereKept')}` : ''}
            </p>
            <p class="chint">{t('tower.conn.mail.whereBounces')}</p>
          </section>

          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.conn.push.title')}</span>
              <span class={`ctag ctag--${push!.tone}`}>{push!.tag}</span>
            </div>
            <p class="cons__lede">{push!.line}</p>
            <dl class="cons__facts">
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.leaves')}</dt>
                <dd class="cons__factv">{t(view.push.sends ? 'tower.conn.fact.leavesYes' : 'tower.conn.fact.leavesNo')}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.keys')}</dt>
                <dd class="cons__factv">{t(`tower.conn.fact.keys.${view.push.keys}`)}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.devices')}</dt>
                <dd class="cons__factv">{view.push.devices}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.people')}</dt>
                <dd class="cons__factv">{view.push.people}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.handed')}</dt>
                <dd class="cons__factv">{countWords(view.push.handed, view.push.failed, t)}</dd>
              </div>
            </dl>
            <p class="chint">{t('tower.conn.push.where')}</p>
          </section>

          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('tower.conn.sms.title')}</span>
              <span class={`ctag ctag--${sms!.tone}`}>{sms!.tag}</span>
            </div>
            <p class="cons__lede">{sms!.line}</p>
            <dl class="cons__facts">
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.leaves')}</dt>
                <dd class="cons__factv">{t(view.sms.sends ? 'tower.conn.fact.leavesYes' : 'tower.conn.fact.leavesNo')}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.smsAccount')}</dt>
                <dd class="cons__factv">{t(view.sms.accountSet ? 'tower.conn.fact.keySet' : 'tower.conn.fact.keyNone')}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.smsCredential')}</dt>
                <dd class="cons__factv">{t(view.sms.credential ? `tower.conn.fact.smsCredential.${view.sms.credential}` : 'tower.conn.fact.keyNone')}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.smsSender')}</dt>
                <dd class="cons__factv">{t(view.sms.sender ? `tower.conn.fact.smsSender.${view.sms.sender}` : 'tower.conn.fact.keyNone')}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.smsCountries')}</dt>
                <dd class="cons__factv">{smsCountryWords(view.sms, t)}</dd>
              </div>
              <div class="cons__fact">
                <dt class="cons__factk">{t('tower.conn.fact.written')}</dt>
                <dd class="cons__factv">{countWords(view.sms.written, view.sms.failed, t)}</dd>
              </div>
              {view.sms.sends || view.sms.fenced > 0 ? (
                <div class="cons__fact">
                  <dt class="cons__factk">{t('tower.conn.fact.smsFenced')}</dt>
                  <dd class="cons__factv">{view.sms.fenced}</dd>
                </div>
              ) : null}
              {/* The caps count only texts that leave: an outbox costs nothing, so a sandbox has none to show. */}
              {view.sms.sends && view.sms.cap ? (
                <div class="cons__fact">
                  <dt class="cons__factk">{t('tower.conn.fact.smsCap')}</dt>
                  <dd class="cons__factv">{smsCapWords(view.sms, t)}</dd>
                </div>
              ) : null}
            </dl>
            <p class="chint">
              {t('tower.conn.sms.where')}
              {view.sandbox && !view.sms.sends ? ` ${t('tower.conn.sms.whereKept')}` : ''}
            </p>
          </section>

          <p class="chint">{t('tower.conn.since', { since: momentWords(view.since) })}</p>
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void load()}>
              {t('tower.conn.again')}
            </button>
          </div>
        </>
      )}
    </>
  );
}

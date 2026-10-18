import { Button, CodeCard, ReadAloud, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { AgentActions, AgentState, TakenIn } from '../useAgentApp';

/** Open the label SVG in a new tab so the agent can print it and stick it on the parcel. */
export function openLabel(svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * What a take-in hands the counter: the label to print and stick on, the tracking key, and the pickup code for the
 * SENDER standing there — not printed on the parcel, and never learned by the collecting shop, so this is where it
 * reaches a human. The same block whether the take-in went at once or waited for a signal.
 */
export function TakenInLabel({ label }: { label: TakenIn }) {
  const t = useT();
  return (
    <>
      {label.svg ? (
        <>
          {/* Trusted markup: the SVG comes from OUR backend label builder, nothing user-authored. */}
          <div class="labelbox" dangerouslySetInnerHTML={{ __html: label.svg }} />
          <Button chevron={false} onClick={() => label.svg && openLabel(label.svg)}>
            {t('agent.accept.openLabel')}
          </Button>
        </>
      ) : null}
      {label.trackingKey ? <p class="hint" style="margin-top:8px">{t('agent.accept.trackingKey', { key: label.trackingKey })}</p> : null}
      {label.releaseCode ? (
        <>
          <CodeCard label={t('agent.accept.pickupCodeLabel')} code={label.releaseCode} />
          <p class="hint">{t('agent.accept.pickupCodeHint')}</p>
          <ReadAloud text={() => t('agent.accept.pickupCodeAloud', { digits: label.releaseCode!.split('').join(', ') })} label={t('agent.accept.pickupCodeSay')} />
        </>
      ) : null}
    </>
  );
}

/**
 * A TAKE-IN MADE WITHOUT A SIGNAL HAS REACHED SEEBUYGET. Its label and its release code exist only now, so they are shown
 * now — once, wherever the shopkeeper is in the app, the way they would have been at the counter. The code is not
 * kept on the phone or put in any list afterwards: a code a shop could look up later is a parcel it could release.
 */
export function LateTakeInSheet({ state, actions }: { state: AgentState; actions: AgentActions }) {
  const t = useT();
  const late = state.lateTakeIns[0];
  return (
    <Sheet open={Boolean(late)} onClose={actions.dismissLateTakeIn} title={t('agent.accept.lateTitle')}>
      {late ? (
        <>
          <p class="t-body">{t('agent.accept.lateBody', { parcel: late.parcelId, time: new Date(late.queuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</p>
          <TakenInLabel label={late} />
          {late.releaseCode && late.senderMobile ? <p class="hint">{t('agent.accept.lateCall', { phone: late.senderMobile })}</p> : null}
          <Button variant="link" onClick={actions.dismissLateTakeIn}>
            {state.lateTakeIns.length > 1 ? t('agent.accept.lateNext', { n: state.lateTakeIns.length - 1 }) : t('agent.accept.lateDone')}
          </Button>
        </>
      ) : null}
    </Sheet>
  );
}

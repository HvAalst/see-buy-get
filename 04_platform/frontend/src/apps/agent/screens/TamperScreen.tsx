import { Button, Card, ErrorNote, Explainer, Icon, Note, Pill, ReadAloud, ScanField } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { heldLine } from '../../../shared/tamper';
import type { AgentActions, AgentState } from '../useAgentApp';
import { PhotoField } from './PhotoField';

export interface TamperScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/**
 * ROUND 35 — A PARCEL FOUND CUT OR OPENED (the tamper protocol). A slit tape, a box opened and closed again, a wrap
 * torn: before the parcel goes anywhere the counter scans it, photographs it as it is and reports it. It is held here —
 * into no bag, onto no bus, into nobody's hands — and SeeBuyGet operations is told at once; the store whose goods they
 * are is told too. Operations releases it, with what was found and done, and it goes on as usual.
 */
export function TamperScreen({ state, actions }: TamperScreenProps) {
  const t = useT();
  const f = state.tamper;
  const busy = state.busy === 'tamper';
  const heldHere = state.shopParcels.filter((p) => p.held);

  return (
    <div class="scr">
      <h1 class="scr__title">{t('agent.tamper.title')}</h1>
      <Explainer who={state.agent?.did} id="agent.tamper.how" text={t('agent.tamper.lede')} />

      {state.error ? <ErrorNote error={state.error} /> : null}

      {f.done ? (
        <Card>
          <Note tone="warn" icon="warning" title={t('agent.tamper.doneTitle', { id: f.done.ref })} detail={f.done.held ? `${heldLine(f.done.held, t)} ${t('agent.tamper.doneWait')}` : t('agent.tamper.doneWait')} />
          <div style="margin-top:12px">
            <Button chevron={false} onClick={() => actions.setTamper({ parcelId: '', photoRef: '', note: '', done: null })}>
              {t('agent.tamper.another')}
            </Button>
            <Button variant="link" onClick={() => actions.go('home')}>
              {t('agent.tamper.backHome')}
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <ScanField
            id="tamper-id"
            label={t('agent.tamper.scanLabel')}
            value={f.parcelId}
            onValue={(v) => actions.setTamper({ parcelId: v })}
            expect="parcel"
            placeholder={t('agent.tamper.scanPlaceholder')}
            upper
          />
          <div style="margin-top:12px">
            <PhotoField id="tamper-photo" value={f.photoRef} label={t('agent.tamper.photo')} upload={(file) => actions.uploadPhoto('tamper', file)} onCapture={(ref) => actions.setTamper({ photoRef: ref })} />
          </div>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="tamper-note">
              {t('agent.tamper.note')}
            </label>
            <textarea id="tamper-note" class="input" rows={2} maxLength={500} value={f.note} onInput={(e) => actions.setTamper({ note: e.currentTarget.value })} disabled={busy} />
          </div>
          <p class="hint">{t('agent.tamper.who')}</p>
          <Button chevron={false} busy={busy} disabled={!f.parcelId.trim() || !f.photoRef} onClick={() => void actions.submitTamper()}>
            {t('agent.tamper.send')}
          </Button>
        </Card>
      )}

      {heldHere.length ? (
        <Card label={t('agent.tamper.heldHere', { count: heldHere.length })}>
          <div class="rows" role="list">
            {heldHere.map((p) => (
              <div key={p.parcelId} class="row row--static" role="listitem">
                <span class="row__ic">
                  <Icon name="warning" size={24} />
                </span>
                <span class="row__body">
                  <span class="row__t mono-t">{p.parcelId}</span>
                  <span class="row__s">{p.held ? heldLine(p.held, t) : ''}</span>
                </span>
                <span class="row__end">
                  <Pill tone="warn" dot>
                    {t('common.tamper.heldShort')}
                  </Pill>
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div class="scr__foot">
        <ReadAloud text={() => t('agent.tamper.aloud')} label={t('agent.readAloud')} />
      </div>
    </div>
  );
}

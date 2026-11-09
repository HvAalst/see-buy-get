import { useState } from 'preact/hooks';
import { Button, Card, Checklist, ErrorNote, Explainer, QrBlock, ReadAloud, ScanField } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { qrPayload } from '../../../shared/qr';
import type { MdpActions, MdpState } from '../useMdpApp';

export interface NewToteScreenProps {
  state: MdpState;
  actions: MdpActions;
}

/** Register a fresh laminated tote into this hub's pool; the code is shown for printing. */
export function NewToteScreen({ state, actions }: NewToteScreenProps) {
  const t = useT();
  const tote = state.lastTote;
  // 2026-11-09 — a bag this hub already has, its tag printed again: with its GRAI once SeeBuyGet's prefix is set.
  const [again, setAgain] = useState('');

  return (
    <div class="scr">
      <h1 class="scr__title">{t('mdp.newtote.title')}</h1>
      <Explainer who={state.hub?.did} id="mdp.tote.how" text={t('mdp.newtote.lede')} />

      {state.error ? <ErrorNote error={state.error} /> : null}

      <Card title={t('mdp.newtote.howTitle')} tone="soft">
        <Checklist items={[t('mdp.newtote.item1'), t('mdp.newtote.item2'), t('mdp.newtote.item3')]} />
      </Card>

      <div class="scr__cta">
        <Button onClick={() => void actions.submitNewTote()} busy={state.busy === 'newtote'}>
          {t('mdp.newtote.register')}
        </Button>
      </div>

      {tote ? (
        <section class="slotcard" aria-live="polite">
          <p class="slotcard__label">{t('mdp.newtote.printLaminate')}</p>
          <p class="slotcard__value mono">{tote.code}</p>
          {/* The laminated QR the bag carries for the rest of its life. It encodes the human
              CODE (BAG-###), because every bag endpoint — drop, receive, load — keys on the
              code, not the toteId; the printed code under it is the same value for when a
              scan fails. (S18 encoded the toteId here, which no endpoint could resolve.) */}
          <div style="margin-top:12px">
            <QrBlock
              value={qrPayload('tote', tote.code)}
              size={200}
              caption={tote.code}
              label={t('mdp.newtote.qrLabel', { code: tote.code })}
            />
          </div>
          <div style="margin-top:12px">
            <Button variant="outline" chevron={false} onClick={() => void actions.printBagTag(tote.code)}>
              {t('mdp.newtote.printTag')}
            </Button>
          </div>
          <div style="margin-top:8px">
            <Button variant="link" full={false} busy={state.busy === `tag:${tote.code}`} onClick={() => void actions.thermalBagTag(tote.code)}>
              {t('mdp.newtote.thermalTag')}
            </Button>
          </div>
        </section>
      ) : null}

      {/* 2026-11-09 — the tag of a bag the hub already has: once SeeBuyGet's GS1 prefix is set, every bag's tag carries its
          GRAI — print it again and put it in the bag's pocket. */}
      <Card title={t('mdp.newtote.againTitle')}>
        <p class="chint">{t('mdp.newtote.againLede')}</p>
        <ScanField id="tag-again" label={t('mdp.drop.bagCode')} value={again} onValue={setAgain} expect="tote" placeholder="BAG-000" upper />
        <div style="margin-top:12px">
          <Button variant="outline" chevron={false} disabled={!again.trim()} onClick={() => void actions.printBagTag(again)}>
            {t('mdp.newtote.printTag')}
          </Button>
        </div>
        <div style="margin-top:8px">
          <Button variant="link" full={false} disabled={!again.trim()} busy={state.busy === `tag:${again.trim()}`} onClick={() => void actions.thermalBagTag(again)}>
            {t('mdp.newtote.thermalTag')}
          </Button>
        </div>
      </Card>

      <div class="scr__foot">
        <ReadAloud
          text={() => (tote ? t('mdp.newtote.aloudDone', { code: tote.code }) : t('mdp.newtote.aloudIdle'))}
          label={t('mdp.readAloud')}
        />
      </div>
    </div>
  );
}

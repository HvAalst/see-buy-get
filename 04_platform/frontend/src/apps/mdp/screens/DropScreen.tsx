import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Checklist, ErrorNote, Explainer, Note, ReadAloud, ScanField } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { BagReceiptFields, BagReportSheet } from '../../../shared/BagSealFields';
import { EMPTY_BAG_RECEIPT, receiptBody, receiptReady, type BagReceiptForm } from '../../../shared/bagSeal';
import { heldLine } from '../../../shared/tamper';
import type { MdpActions, MdpState } from '../useMdpApp';

export interface DropScreenProps {
  state: MdpState;
  actions: MdpActions;
}

/**
 * A bus dropped a bag: received on its seal, then emptied — parcels join the queue, the tote frees up. Round 36: before
 * it is opened, the number read off its seal (never shown here), a photograph as it arrived, and whether it is as it was
 * closed. A seal not the one it was closed with, or a bag not as closed, is reported: the bag is held, operations told.
 */
export function DropScreen({ state, actions }: DropScreenProps) {
  const t = useT();
  const code = state.form.dropCode;
  const bag = state.drop.bag;
  const looked = bag !== undefined && bag !== null;
  const busy = state.busy === 'drop';
  const [receipt, setReceipt] = useState<BagReceiptForm>(EMPTY_BAG_RECEIPT);
  const [reporting, setReporting] = useState(false);
  useEffect(() => {
    setReceipt(EMPTY_BAG_RECEIPT);
    setReporting(false);
  }, [code]);

  return (
    <div class="scr">
      <h1 class="scr__title">{t('mdp.drop.title')}</h1>
      <Explainer who={state.hub?.did} id="mdp.drop.how" text={t('mdp.drop.lede')} />

      {state.error ? <ErrorNote error={state.error} /> : null}

      <Card>
        <ScanField
          id="drop-code"
          label={t('mdp.drop.bagCode')}
          value={code}
          onValue={(v) => actions.setForm({ dropCode: v })}
          expect="tote"
          placeholder="BAG-000"
          upper
          enterKeyHint="go"
          onScan={(v) => void actions.lookDropBag(v)}
        />
        {!looked ? (
          <div style="margin-top:12px">
            <Button variant="outline" onClick={() => void actions.lookDropBag()} disabled={!code.trim()}>
              {t('mdp.drop.look')}
            </Button>
          </div>
        ) : null}
      </Card>

      {looked && bag.held ? <Note tone="warn" icon="warning" title={t('mdp.bag.heldTitle')} detail={`${heldLine(bag.held, t)} ${t('common.bag.heldNote')}`} /> : null}

      {looked && !bag.held ? (
        <>
          <Card>
            {state.drop.mismatch !== undefined ? (
              <>
                <Note tone="warn" icon="warning" title={t('common.bag.mismatchTitle')} detail={t('common.bag.mismatchBody')} />
                <Button variant="link" full={false} onClick={() => setReporting(true)}>
                  {t('common.bag.mismatchReport')}
                </Button>
              </>
            ) : null}
            <BagReceiptFields id="drop-receive" closedWith={bag.closedWith} value={receipt} onChange={setReceipt} upload={(f) => actions.uploadPhoto(f, 'seal')} onReport={() => setReporting(true)} disabled={busy} />
          </Card>
          <div class="scr__cta">
            <Button
              onClick={async () => {
                const refused = await actions.submitDrop(receiptBody(receipt));
                if (refused === 'TAMPER_REPORT_FIRST') setReporting(true);
              }}
              disabled={!receiptReady(receipt, bag.closedWith)}
              busy={busy}
            >
              {t('mdp.drop.empty')}
            </Button>
          </div>
        </>
      ) : null}

      {state.queue.length ? (
        <Card title={state.queue.length === 1 ? t('mdp.drop.readyOne', { count: state.queue.length }) : t('mdp.drop.readyMany', { count: state.queue.length })}>
          <div class="chips">
            {state.queue.slice(0, 12).map((id) => (
              <span key={id} class="chip mono">
                {id}
              </span>
            ))}
          </div>
          <div style="margin-top:12px">
            <Button chevron onClick={() => actions.go('sort')}>
              {t('mdp.drop.startSorting')}
            </Button>
          </div>
        </Card>
      ) : (
        <Card title={t('mdp.drop.whatHappens')} tone="soft">
          <Checklist items={[t('mdp.drop.item1'), t('mdp.drop.item2'), t('mdp.drop.item3')]} />
        </Card>
      )}

      <div class="scr__foot">
        <ReadAloud
          text={() =>
            state.queue.length
              ? t('mdp.drop.aloudReady', { count: state.queue.length })
              : t('mdp.drop.aloudEmpty')
          }
          label={t('mdp.readAloud')}
        />
      </div>

      <BagReportSheet
        code={reporting ? code.trim().toUpperCase() : null}
        closedWith={bag?.closedWith}
        numberRead={state.drop.mismatch}
        upload={(f) => actions.uploadPhoto(f, 'tamper')}
        busy={state.busy === 'bag-report'}
        onSend={async (body) => {
          if (await actions.reportBag(code.trim().toUpperCase(), body)) setReporting(false);
        }}
        onClose={() => setReporting(false)}
      />
    </div>
  );
}

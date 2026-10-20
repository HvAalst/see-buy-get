import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Checklist, ErrorNote, Icon, Note, ReadAloud, ScanField } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { BagReceiptFields, BagReportSheet } from '../../../shared/BagSealFields';
import { EMPTY_BAG_RECEIPT, receiptBody, receiptReady, type BagReceiptForm } from '../../../shared/bagSeal';
import { heldLine } from '../../../shared/tamper';
import { putAwayAloud } from '../logic';
import type { AgentActions, AgentState } from '../useAgentApp';

export interface ReceiveBagScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/**
 * The tote last-mile: a bus dropped a bag for this shop — one scan shelves every parcel
 * inside and frees the bag for reuse.
 *
 * Then WHERE EACH ONE GOES: the slot every parcel was given, slot by slot in the order the shelf is walked.
 * It stays until the shop says the parcels are in — this is the only moment anybody is holding them.
 */
export function ReceiveBagScreen({ state, actions }: ReceiveBagScreenProps) {
  const t = useT();
  const code = state.receivebag.code;
  const putAway = state.receivebag.putAway;
  // Round 36 — the bag looked at before it is received: how it was closed, and whether it is held.
  const bag = state.receivebag.bag;
  const looked = bag !== undefined && bag !== null;
  const busy = state.busy === 'receivebag';
  const [receipt, setReceipt] = useState<BagReceiptForm>(EMPTY_BAG_RECEIPT);
  const [reporting, setReporting] = useState(false);
  useEffect(() => {
    setReceipt(EMPTY_BAG_RECEIPT);
    setReporting(false);
  }, [code]);

  if (putAway?.length) {
    return (
      <div class="scr">
        <h1 class="scr__title">{t('agent.receivebag.putAwayTitle')}</h1>
        <p class="scr__lede">{t('agent.receivebag.putAwayLede')}</p>

        <Card>
          <div class="rows" role="list">
            {putAway.map((row) => (
              <div key={row.slot} class="row row--static" role="listitem">
                <span class="row__ic"><Icon name="grid" size={24} /></span>
                <span class="row__body">
                  <span class="row__t">{row.slot}</span>
                  <span class="row__s">{row.parcelIds.join(' · ')}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>

        <div class="scr__cta">
          <Button onClick={() => actions.donePutAway()}>{t('agent.receivebag.putAwayDone')}</Button>
        </div>

        <div class="scr__foot">
          <ReadAloud text={() => putAwayAloud(putAway, t)} label={t('agent.readAloud')} />
        </div>
      </div>
    );
  }

  return (
    <div class="scr">
      <h1 class="scr__title">{t('agent.receivebag.title')}</h1>
      <p class="scr__lede">{t('agent.receivebag.lede')}</p>

      {/* A full shelf says how many the bag holds and what to do about it — the server's own sentence. */}
      {state.error ? <ErrorNote error={state.error} showDetail={state.error.code === 'SHELF_FULL'} /> : null}

      <Card>
        <ScanField
          id="bag-code"
          label={t('agent.receivebag.codeLabel')}
          value={code}
          onValue={(v) => actions.setReceiveBag(v)}
          expect="tote"
          placeholder="BAG-000"
          upper
          enterKeyHint="go"
          onScan={(v) => void actions.lookBag(v)}
        />
        {!looked ? (
          <div style="margin-top:12px">
            <Button variant="outline" onClick={() => void actions.lookBag()} disabled={!code.trim()}>
              {t('agent.receivebag.look')}
            </Button>
          </div>
        ) : null}
      </Card>

      {/* Round 36 — held under the tamper protocol: nobody opens it until operations releases it. */}
      {looked && bag.held ? <Note tone="warn" icon="warning" title={t('agent.receivebag.heldTitle')} detail={`${heldLine(bag.held, t)} ${t('common.bag.heldNote')}`} /> : null}

      {/* Round 36 — before it is opened: the number read off its seal, a photograph as it arrived, as it was closed. */}
      {looked && !bag.held ? (
        <>
          <Card>
            {state.receivebag.mismatch !== undefined ? (
              <>
                <Note tone="warn" icon="warning" title={t('common.bag.mismatchTitle')} detail={t('common.bag.mismatchBody')} />
                <Button variant="link" full={false} onClick={() => setReporting(true)}>
                  {t('common.bag.mismatchReport')}
                </Button>
              </>
            ) : null}
            <BagReceiptFields id="bag-receive" closedWith={bag.closedWith} value={receipt} onChange={setReceipt} upload={(f) => actions.uploadPhoto('seal', f)} onReport={() => setReporting(true)} disabled={busy} />
          </Card>
          <div class="scr__cta">
            <Button
              onClick={async () => {
                const refused = await actions.submitReceiveBag(receiptBody(receipt));
                if (refused === 'TAMPER_REPORT_FIRST') setReporting(true);
              }}
              disabled={!receiptReady(receipt, bag.closedWith)}
              busy={busy}
            >
              {t('agent.receivebag.receiveShelve')}
            </Button>
          </div>
        </>
      ) : null}

      <Card title={t('agent.receivebag.whatHappens')} tone="soft">
        <Checklist
          items={[t('agent.receivebag.step1'), t('agent.receivebag.step2'), t('agent.receivebag.step3')]}
        />
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => t('agent.receivebag.aloud')} label={t('agent.readAloud')} />
      </div>

      <BagReportSheet
        code={reporting ? code : null}
        closedWith={bag?.closedWith}
        numberRead={state.receivebag.mismatch}
        upload={(f) => actions.uploadPhoto('tamper', f)}
        busy={state.busy === 'bag-report'}
        onSend={async (body) => {
          if (await actions.reportBag(body)) setReporting(false);
        }}
        onClose={() => setReporting(false)}
      />
    </div>
  );
}

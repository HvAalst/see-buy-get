import { useEffect, useState } from 'preact/hooks';
import { Button, Note, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { BagReceiptFields } from '../../../shared/BagSealFields';
import { EMPTY_BAG_RECEIPT, receiptBody, takeReady, type BagReceiptForm } from '../../../shared/bagSeal';
import { readingMatches } from '../../../shared/seals';
import type { Claimable } from '../types';
import type { DriverActions, DriverState } from '../useDriverApp';

/*
 * ROUND 37 — A DRIVER TAKES A BAG ON ITS SEAL (the user: "A driver takes a bag on its seal"). The number is read off the
 * seal — never shown here — the bag photographed as taken, and said to be as it was closed. The reading is checked on the
 * phone against how the bag was closed, signal or not, so a number that is not the one it was closed with is said on the
 * spot. Loading it themselves, the reading is part of the load; a bag a counter loaded onto them by their pass is read
 * afterwards (BagTakeSheet), and received nowhere until it has been.
 */

export interface BagTake {
  form: BagReceiptForm;
  setForm: (f: BagReceiptForm) => void;
  /** The number typed, checked on the phone: the one it was closed with, not, or not checked (no number, no hashing). */
  match: boolean | null;
  ready: boolean;
}

export function useBagTake(claim: Claimable | null): BagTake {
  const [form, setForm] = useState<BagReceiptForm>(EMPTY_BAG_RECEIPT);
  const [match, setMatch] = useState<boolean | null>(null);
  const ref = claim?.ref ?? '';
  const check = claim?.bagSeal?.check;
  useEffect(() => setForm(EMPTY_BAG_RECEIPT), [ref]);
  useEffect(() => {
    setMatch(null);
    if (!check || !form.sealNumber.trim()) return;
    let current = true;
    void readingMatches(ref, form.sealNumber, check).then((ok) => {
      if (current) setMatch(ok);
    });
    return () => {
      current = false;
    };
  }, [ref, check, form.sealNumber]);
  // Not the number it was closed with, and said to be as closed: nothing is sent — read it again, or report it.
  const ready = Boolean(claim?.bagSeal) && takeReady(form, claim?.bagSeal?.closedWith, match);
  return { form, setForm, match, ready };
}

/** The reading itself: the shared fields, worded for taking, and the number said wrong on the spot. */
export function BagTakeFields({ claim, take, actions, busy, onReport }: { claim: Claimable; take: BagTake; actions: DriverActions; busy: boolean; onReport: (numberRead?: string) => void }) {
  const t = useT();
  if (!claim.bagSeal) return <Note tone="warn" icon="warning" title={t('driver.bag.notClosed')} />;
  const wrong = take.match === false && take.form.asClosed !== false;
  return (
    <>
      <BagReceiptFields
        id={`take-${claim.ref}`}
        take
        closedWith={claim.bagSeal.closedWith}
        value={take.form}
        onChange={take.setForm}
        upload={(f) => actions.uploadPhoto('seal', f)}
        onReport={() => onReport()}
        disabled={busy}
      />
      {wrong ? (
        <>
          <Note tone="warn" icon="warning" title={t('common.bag.mismatchTitle')} detail={t('common.bag.mismatchBody')} />
          <Button variant="link" full={false} disabled={busy} onClick={() => onReport(take.form.sealNumber.trim())}>
            {t('common.bag.mismatchReport')}
          </Button>
        </>
      ) : null}
    </>
  );
}

/** A bag a counter loaded onto this driver by their pass: read now. */
export function BagTakeSheet({ claim, state, actions, onClose, onReport }: { claim: Claimable | null; state: DriverState; actions: DriverActions; onClose: () => void; onReport: (claim: Claimable, numberRead?: string) => void }) {
  const t = useT();
  const take = useBagTake(claim);
  const busy = !!claim && state.busy === `take:${claim.ref}`;
  return (
    <Sheet open={!!claim} onClose={onClose} title={t('driver.bag.readTitle', { ref: claim?.code ?? claim?.ref ?? '' })}>
      {claim ? (
        <>
          <p class="t-body">{t('driver.bag.readBody')}</p>
          <BagTakeFields claim={claim} take={take} actions={actions} busy={busy} onReport={(n) => onReport(claim, n)} />
          <Button
            chevron={false}
            busy={busy}
            disabled={!take.ready}
            onClick={async () => {
              if (await actions.takeBag(claim.ref, receiptBody(take.form))) onClose();
            }}
          >
            {t('driver.bag.send')}
          </Button>
          <Button variant="link" onClick={onClose}>
            {t('driver.notYet')}
          </Button>
        </>
      ) : null}
    </Sheet>
  );
}

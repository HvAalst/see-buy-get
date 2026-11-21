import { useState } from 'preact/hooks';
import { Button, Card, Note } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';

/**
 * 2026-11-21 — CALL OFF A BOOKING BEFORE IT IS HANDED IN (the payments plan, 5c). The drop-off reminder always said "you can also
 * cancel it"; now this does. Quiet until asked for; then what it means — the place at the shop given back, and, where it was paid
 * online, the money going back to the account that paid — before the button that does it. Once handed in, the shop calls it off.
 */
export function CancelBooking({ paidOnline, cancel, open = false }: { paidOnline: boolean; cancel: () => Promise<string | null>; /** Asked already (a test renders it so). */ open?: boolean }) {
  const t = useT();
  const [asking, setAsking] = useState(open);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  if (!asking) {
    return (
      <Button variant="link" onClick={() => setAsking(true)}>
        {t('send.cancel.open')}
      </Button>
    );
  }
  return (
    <Card title={t('send.cancel.title')}>
      <Note tone="warn" icon="warning" title={t('send.cancel.means')} detail={t(paidOnline ? 'send.cancel.meansPaid' : 'send.cancel.meansUnpaid')} />
      {failed ? <p class="hint">{failed}</p> : null}
      <div class="stack">
        <Button
          chevron={false}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            const error = await cancel();
            setBusy(false);
            if (error) setFailed(error);
          }}
        >
          {t('send.cancel.yes')}
        </Button>
        <Button variant="outline" chevron={false} disabled={busy} onClick={() => setAsking(false)}>
          {t('send.cancel.keep')}
        </Button>
      </div>
    </Card>
  );
}

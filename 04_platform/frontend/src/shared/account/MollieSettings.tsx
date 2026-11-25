import { useEffect, useState } from 'preact/hooks';
import type { Result, SbgError } from '../../lib/sbg';
import { useT, type Translate } from '../i18n';
import { cash } from '../money';
import { Button, DocumentButton, ErrorNote, Note } from '../ui';
import { invoiceMonthWords, mollieBackSays, type MollieBack, type MollieInvoiceRow } from './mollie';
import type { AccountApi } from './useAccount';

/**
 * 2026-11-20 — THE INVOICES FOR OUR FEE, ONE A MONTH (the payments plan, part 2c): each one paid already — Mollie took the fee
 * from the payments — and opened as its printable page. A test invoice says it is one. Pure, for the test.
 */
export function MollieInvoiceList({ items, t, open }: { items: MollieInvoiceRow[] | null; t: Translate; open: (invoiceId: string) => Promise<Result<string>> }) {
  if (items === null) return null;
  return (
    <div style="margin-top:16px">
      <p class="t-body">
        <b>{t('account.mollie.invoicesTitle')}</b>
      </p>
      {items.length === 0 ? (
        <p class="hint">{t('account.mollie.invoicesNone')}</p>
      ) : (
        items.map((i) => (
          <div key={i.invoiceId}>
            <DocumentButton
              label={`${t('account.mollie.invoiceLine', { month: invoiceMonthWords(i.month), amount: cash(i.gross, i.currency) })}${i.test ? ` · ${t('account.mollie.invoiceTest')}` : ''}`}
              title={t('account.mollie.invoiceTitle', { number: i.number })}
              fetch={() => open(i.invoiceId)}
            />
          </div>
        ))
      )}
    </div>
  );
}

function MollieInvoices({ api }: { api: AccountApi }) {
  const t = useT();
  const [items, setItems] = useState<MollieInvoiceRow[] | null>(null);
  useEffect(() => {
    void api.mollieInvoices().then((r) => setItems(r.error || !r.data ? null : r.data.items));
  }, [api.mollieInvoices]);
  return <MollieInvoiceList items={items} t={t} open={api.mollieInvoice} />;
}

/**
 * 2026-11-19 — CONNECT YOUR OWN MOLLIE ACCOUNT (the payments plan, part 2). What it does, said before the button: a shipper who
 * pays you directly can pay at the handover from a QR code; the money goes into your Mollie account, never through SeeBuyGet;
 * and the small fee for server costs. Connected, it says whose account and whether Mollie still checks it; lost, how to
 * connect again. Back from Mollie's sign-in, how that ended comes first.
 */
export function MollieForm({ api, back }: { api: AccountApi; back: MollieBack | null }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const v = api.mollie;
  const c = v?.connected;
  const said = back ? mollieBackSays(back, t as never) : null;

  const connect = async () => {
    setBusy(true);
    setError(null);
    const r = await api.connectMollie();
    // Off to Mollie's own sign-in: the button stays busy until the page goes.
    if (r.error || !r.data?.url) setBusy(false);
    if (r.error) setError(r.error);
  };
  const disconnect = async () => {
    setBusy(true);
    setError(null);
    const r = await api.disconnectMollie();
    setBusy(false);
    if (r.error) setError(r.error);
  };

  return (
    <>
      {said ? <Note tone={said.tone} icon={said.tone === 'ok' ? 'check' : 'warning'} title={said.title} /> : null}
      {!v ? null : !v.available ? (
        <Note tone="info" icon="info" title={t('account.mollie.subFleet')} />
      ) : (
        <>
          <p class="t-body">{t('account.mollie.body')}</p>
          <p class="t-body">{t('account.mollie.fee')}</p>
          {v.paysLoads ? <p class="t-body">{t('account.mollie.paysLoads')}</p> : null}
          {v.via === 'test_key' ? <Note tone="info" icon="info" title={t('account.mollie.testKeyTitle')} detail={t('account.mollie.testKeyBody')} /> : null}
          {c && !c.lostAt ? (
            <>
              <Note tone="ok" icon="check" title={t('account.mollie.connectedTitle', { name: c.organizationName || c.profileName || t('account.mollie.title') })} detail={c.via === 'oauth' && c.testmode ? t('account.mollie.testPayments') : undefined} />
              {c.canReceivePayments === false ? <Note tone="warn" icon="warning" title={t('account.mollie.checkingTitle')} detail={t('account.mollie.checkingBody')} /> : null}
              {c.canReceivePayments === false && c.dashboardUrl ? (
                <p class="t-body">
                  <a href={c.dashboardUrl} target="_blank" rel="noopener noreferrer">
                    {t('account.mollie.openMollie')}
                  </a>
                </p>
              ) : null}
              <Button variant="outline" chevron={false} busy={busy} onClick={() => void disconnect()}>
                {t('account.mollie.disconnect')}
              </Button>
            </>
          ) : (
            <>
              {c?.lostAt ? <Note tone="warn" icon="warning" title={t('account.mollie.lostTitle')} detail={t('account.mollie.lostBody')} /> : null}
              <Button chevron={false} busy={busy} onClick={() => void connect()}>
                {t('account.mollie.connect')}
              </Button>
            </>
          )}
          {/* Kept after a disconnect too: an invoice is the carrier's to keep. */}
          <MollieInvoices api={api} />
        </>
      )}
      {error ? <ErrorNote error={error} /> : null}
    </>
  );
}

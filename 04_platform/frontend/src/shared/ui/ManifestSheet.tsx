import { useEffect, useState } from 'preact/hooks';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { Note, refusalSentence } from './ErrorNote';
import { Pill } from './Pill';
import { FiscalCodeLines } from './FiscalCodes';
import { useLocale, useT, type MessageKey } from '../i18n';
import { passageWords } from '../passages';
import { triggerDownload } from '../download';
import type { FiscalCard } from '../fiscal-codes';
import type { SbgError } from '../../lib/sbg/errors';

/** Why a manifest line wants a look (backend vehicle-manifest.types.ts). */
export type ManifestFlag = 'missing_code' | 'over_500kg' | 'over_ron_10000' | 'code_expiring' | 'code_expired';
export type AboardKind = 'freight' | 'bag' | 'booking' | 'parcel';

export interface ManifestItemView {
  kind: AboardKind;
  ref: string;
  label: string;
  state: 'aboard' | 'to_collect';
  from?: string;
  to?: string;
  pickupCountry?: string;
  destCountry?: string;
  weightKg: number;
  parcels?: number;
  declaredValue?: { amount: number; currency: string };
  valueRon?: number;
  fiscalCodes?: FiscalCard[];
  flags: ManifestFlag[];
}

/** 2026-11-24 — everything aboard one vehicle on a shift, as the server sends it (the owner's brief, feature 3). */
export interface ManifestView {
  manifestId: string;
  vehicleId: string;
  truckPlate: string;
  trailerPlate?: string;
  driverDid: string;
  driverName?: string;
  shiftStartedAt: string;
  items: ManifestItemView[];
  totalWeightKg: number;
  totalValue: Array<{ amount: number; currency: string }>;
  totalValueRon?: number;
  flagged: number;
  crossings: Array<{ freightCode: string; kind: string; post?: string; from?: string; to?: string; at: string }>;
  at: string;
}

export const MANIFEST_FLAG_WORDS: Record<ManifestFlag, MessageKey> = {
  missing_code: 'common.aboard.flag.missingCode',
  over_500kg: 'common.aboard.flag.over500kg',
  over_ron_10000: 'common.aboard.flag.overRon',
  code_expiring: 'common.aboard.flag.codeExpiring',
  code_expired: 'common.aboard.flag.codeExpired',
};
export const ABOARD_KIND_WORDS: Record<AboardKind, MessageKey> = {
  freight: 'common.aboard.kind.freight',
  bag: 'common.aboard.kind.bag',
  booking: 'common.aboard.kind.booking',
  parcel: 'common.aboard.kind.parcel',
};

type Fetched = { data?: unknown; error?: unknown };

/**
 * 2026-11-24 — THE MASTER MANIFEST, READ (the owner's brief, feature 3): a vehicle's plates and driver, what wants a look first,
 * the totals, each thing aboard with its codes, the crossings its loads passed, and the CSV or JSON to keep. For the driver on
 * their Home and the office on its shifts; each passes the two fetches its own client makes.
 */
export function ManifestSheet({ open, onClose, fetchManifest, fetchCsv }: { open: boolean; onClose: () => void; fetchManifest: () => Promise<Fetched>; fetchCsv: () => Promise<Fetched> }) {
  const t = useT();
  const [m, setM] = useState<ManifestView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setM(null);
    setProblem(null);
    void fetchManifest().then((r) => (r.error ? setProblem(refusalSentence(r.error as SbgError)) : setM(r.data as ManifestView)));
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title={t('common.aboard.title')}>
      {problem ? <Note tone="warn" icon="warning" title={problem} /> : null}
      {m ? <ManifestBody m={m} /> : null}
      {m ? (
        <div class="linkcol">
          <Button
            variant="outline"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              const r = await fetchCsv();
              setBusy(false);
              if (r.error) return setProblem(refusalSentence(r.error as SbgError));
              triggerDownload(`manifest-${m.truckPlate}.csv`, String(r.data ?? ''));
            }}
          >
            {t('common.aboard.csv')}
          </Button>
          <Button variant="link" full={false} onClick={() => triggerDownload(`manifest-${m.truckPlate}.json`, JSON.stringify(m, null, 2), 'application/json')}>
            {t('common.aboard.json')}
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}

/** The manifest itself: drawn apart from its fetching, so it can be read and tested as it is. */
export function ManifestBody({ m }: { m: ManifestView }) {
  const t = useT();
  const locale = useLocale();
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const looks = m.items.filter((i) => i.flags.length);
  return (
    <>
      <p class="t-body">
        <b>{m.trailerPlate ? t('common.aboard.platesWithTrailer', { truck: m.truckPlate, trailer: m.trailerPlate }) : m.truckPlate}</b>
      </p>
      <p class="card__note">{t('common.aboard.driver', { name: m.driverName ?? m.driverDid, since: when(m.shiftStartedAt) })}</p>
      <p class="card__note">{t('common.aboard.totals', { count: m.items.length, kg: m.totalWeightKg })}</p>
      {m.totalValue.length ? <p class="card__note">{t('common.aboard.value', { list: m.totalValue.map((v) => `${v.currency} ${v.amount.toLocaleString(locale)}`).join(' + ') })}{m.totalValueRon !== undefined ? ` ${t('common.aboard.valueRon', { ron: m.totalValueRon.toLocaleString(locale) })}` : ''}</p> : null}
      {looks.map((i) => (
        <Note key={`look-${i.ref}`} tone={i.flags.includes('code_expired') || i.flags.includes('missing_code') ? 'danger' : 'warn'} icon="warning" title={i.label} detail={i.flags.map((f) => t(MANIFEST_FLAG_WORDS[f])).join(' · ')} />
      ))}
      {m.items.length === 0 ? <p class="card__note">{t('common.aboard.none')}</p> : null}
      <div class="rows" role="list">
        {m.items.map((i) => (
          <div key={`${i.kind}-${i.ref}`} class="row row--static" role="listitem">
            <span class="row__body">
              <span class="row__t">
                {t(ABOARD_KIND_WORDS[i.kind])} {i.label} {i.state === 'to_collect' ? <Pill tone="idle">{t('common.aboard.toCollect')}</Pill> : null}
              </span>
              {i.from || i.to ? <span class="row__s">{[i.from, i.to].filter(Boolean).join(' → ')}</span> : null}
              <span class="row__s">{t('common.aboard.kg', { kg: i.weightKg })}</span>
              <FiscalCodeLines cards={i.fiscalCodes} />
            </span>
          </div>
        ))}
      </div>
      {m.crossings.length ? (
        <>
          <p class="t-body">
            <b>{t('common.aboard.crossings')}</b>
          </p>
          {m.crossings.map((c) => (
            <p key={`${c.freightCode}-${c.at}`} class="card__note">
              {c.freightCode}: {passageWords({ kind: c.kind as never, post: c.post, at: c.at } as never, t, when)}
            </p>
          ))}
        </>
      ) : null}
    </>
  );
}

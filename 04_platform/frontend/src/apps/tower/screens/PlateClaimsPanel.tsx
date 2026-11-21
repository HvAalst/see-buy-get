import { useEffect, useState } from 'preact/hooks';
import { formatDate, useT } from '../../../shared/i18n';
import { narrow } from '../../../lib/sbg';
import type { TowerActions, TowerState } from '../useTowerApp';

const DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

interface Party {
  kind: 'driver' | 'fleet';
  name: string;
}
interface LapsedClaim {
  claimId: string;
  vehicleId: string;
  plate: string;
  vehicleClass: string;
  claimant: Party;
  holder?: Party;
  askedAt: string;
  lapsedAt: string;
  lastShiftAt?: string;
}

/**
 * 2026-11-21 — PLATES NOBODY ANSWERED ABOUT (the owner: "consider that a vehicle may be sold and no longer belongs to a driver as
 * well"). Somebody said they bought a vehicle; its owner did not answer in fourteen days, or nobody could be asked. Staff see who
 * asked, whose it is, and — what tells whether it was sold — when it last went out; then take it off its owner's list or leave it,
 * with a reason both are told. Each in the country of the vehicle.
 */
export function PlateClaimsPanel({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [claims, setClaims] = useState<LapsedClaim[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = () => {
    if (!client) return;
    void client.api.lapsedPlateClaims().then((r) => {
      if (r.error) return setFailed(r.error.detail || r.error.title);
      setClaims(narrow<LapsedClaim[]>(r.data) ?? []);
    });
  };
  useEffect(load, [client]);

  const decide = async (c: LapsedClaim, release: boolean) => {
    if (!client || !reason.trim()) return;
    setBusy(true);
    const r = await client.api.decidePlateClaim(c.vehicleId, { claimId: c.claimId, release, reason: reason.trim(), ...(state.who?.name ? { by: state.who.name } : {}) });
    setBusy(false);
    if (r.error) return setFailed(r.error.detail || r.error.title);
    setFailed(null);
    setOpen(null);
    setReason('');
    setDone(t(release ? 'tower.plates.released' : 'tower.plates.left', { plate: c.plate }));
    load();
  };

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.plates.title', { n: claims?.length ?? 0 })}</span>
      </div>
      <p class="chint">{t('tower.plates.lede')}</p>
      {failed ? <p class="cerr">{failed}</p> : null}
      {done ? <p class="chint">{done}</p> : null}
      {claims === null ? (
        <p class="cons__empty">{t('tower.papers.loading')}</p>
      ) : claims.length === 0 ? (
        <p class="cons__empty">{t('tower.plates.none')}</p>
      ) : (
        <div class="crows">
          {claims.map((c) => {
            // A shift since it was asked about: somebody still drives it.
            const inUse = Boolean(c.lastShiftAt && c.lastShiftAt > c.askedAt);
            return (
              <div class="crow crow--static" key={c.claimId}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">{c.plate}</span>
                    <span class={`ctag ${inUse ? 'ctag--warn' : 'ctag--quiet'}`}>{inUse ? t('tower.plates.inUse') : t('tower.plates.notOut')}</span>
                  </span>
                  <span class="crow__sub">
                    {t('tower.plates.who', { asker: c.claimant.name, owner: c.holder?.name ?? t('tower.plates.nobody'), day: formatDate(c.askedAt, DAY) })}
                  </span>
                  <span class="crow__sub">{c.lastShiftAt ? t('tower.plates.lastOut', { day: formatDate(c.lastShiftAt, DAY) }) : t('tower.plates.neverOut')}</span>
                  {open === c.claimId ? (
                    <div class="twr-clear">
                      <label class="cfield">
                        <span class="cfield__label">{t('tower.plates.why')}</span>
                        <textarea class="ctextarea" value={reason} maxLength={400} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} />
                      </label>
                      <div class="twr-clear__act">
                        <button type="button" class="cbtn cbtn--primary" disabled={!reason.trim() || busy} onClick={() => void decide(c, true)}>
                          {t('tower.plates.release')}
                        </button>
                        <button type="button" class="cbtn cbtn--ghost" disabled={!reason.trim() || busy} onClick={() => void decide(c, false)}>
                          {t('tower.plates.leave')}
                        </button>
                        <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => setOpen(null)}>
                          {t('tower.papers.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </span>
                {open === c.claimId ? null : (
                  <button
                    type="button"
                    class="cbtn cbtn--ghost cbtn--sm"
                    onClick={() => {
                      setOpen(c.claimId);
                      setReason('');
                    }}
                  >
                    {t('tower.plates.decide')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

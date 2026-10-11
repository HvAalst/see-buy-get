import { useState } from 'preact/hooks';
import { Button, Card, Note, RefusalNote, Sheet } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import type { SbgError } from '../../../lib/sbg';
import { removalWords, removedLine } from '../logic';
import type { DriverActions, DriverState, FleetOffer } from '../useDriverApp';

const DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

/**
 * WHO THIS DRIVER DRIVES FOR — and the only place a fleet's offer can be answered.
 *
 * It used to take a fleet's code, and whoever typed one became that fleet's driver. The code names a company at its
 * own sign-in, it is handed round a depot, and it is short enough to guess. So nothing is typed here any more: a
 * fleet offers a place to a driver it names by the phone number they sign in with, and the offer appears HERE, in
 * that driver's own signed-in app. Yes or no is theirs alone — the server refuses anybody else, staff included.
 *
 * Whatever is unfinished is said before they commit, in the server's own words: a shift running, a load in hand, a
 * run of their current fleet's still to go. And what saying yes changes is said before it does.
 *
 * AND THE WAY OUT, which is theirs alone too. A driver in a fleet can leave it from here, with nobody's leave: once
 * their shift has ended and nothing is in their hands. What leaving means is said before the button that does it —
 * above all that no shift can start afterwards until a fleet offers them a place.
 */
export function FleetSheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: DriverState; actions: DriverActions }) {
  const t = useT();
  const [error, setError] = useState<SbgError | null>(null);
  const [leaving, setLeaving] = useState(false);
  const driver = state.driver;
  const removed = driver && !driver.managerDid ? driver.removedFrom : undefined;
  const courier = Boolean(driver) && !driver?.managerDid && !removed;

  const close = () => {
    setError(null);
    setLeaving(false);
    onClose();
  };
  const answer = async (act: () => Promise<SbgError | null>, thenClose: boolean) => {
    const failed = await act();
    setError(failed);
    if (!failed && thenClose) close();
  };

  return (
    <Sheet open={open} onClose={close} title={t('driver.fleet.title')}>
      <p class="t-body">{driver?.fleetName ? t('driver.fleet.now', { company: driver.fleetName }) : removed ? t('driver.fleet.nowNone') : t('driver.fleet.nowOwn')}</p>
      {removed ? <Note tone="warn" icon="truck" title={removedLine(removed, formatDate(removed.at, DAY), t)} detail={removalWords(removed, t)} /> : null}
      {error ? <RefusalNote error={error} /> : null}

      {/* THE WAY OUT. Quiet until asked for; then what it means, and one button that does it. A refusal — a shift
          still running, something still in their hands — is shown above in the server's own words. */}
      {driver?.managerDid && driver.fleetName ? (
        leaving ? (
          <Card title={t('driver.fleet.leaveTitle', { company: driver.fleetName })}>
            <Note tone="warn" icon="truck" title={t('driver.fleet.leaveMeans')} detail={t('driver.fleet.leaveDetail', { company: driver.fleetName })} />
            <div class="stack">
              <Button
                chevron={false}
                busy={state.busy === 'fleet-leave'}
                onClick={() =>
                  void answer(async () => {
                    const failed = await actions.leaveFleet();
                    if (!failed) setLeaving(false);
                    return failed;
                  }, false)
                }
              >
                {t('driver.fleet.leaveCta', { company: driver.fleetName })}
              </Button>
              <Button variant="outline" chevron={false} disabled={state.busy === 'fleet-leave'} onClick={() => setLeaving(false)}>
                {t('driver.fleet.leaveStay')}
              </Button>
            </div>
          </Card>
        ) : (
          <Button variant="link" onClick={() => setLeaving(true)}>
            {t('driver.fleet.leave', { company: driver.fleetName })}
          </Button>
        )
      ) : null}

      {state.fleetOffers.map((offer) => (
        <OfferCard key={offer.offerId} offer={offer} courier={courier} busy={state.busy === 'fleet-offer'} onYes={() => void answer(() => actions.acceptFleetOffer(offer.offerId), true)} onNo={() => void answer(() => actions.declineFleetOffer(offer.offerId), false)} />
      ))}

      {/* No offer waiting: say how one arrives, because the old answer — "type the fleet's code" — is gone. */}
      {state.fleetOffers.length === 0 ? <Note tone="info" icon="info" title={t('driver.fleet.howTitle')} detail={t('driver.fleet.how')} /> : null}

      <Button variant="link" onClick={close}>
        {t('driver.fleet.notNow')}
      </Button>
    </Sheet>
  );
}

function OfferCard({ offer, courier, busy, onYes, onNo }: { offer: FleetOffer; courier: boolean; busy: boolean; onYes: () => void; onNo: () => void }) {
  const t = useT();
  const blocked = offer.blockers.length > 0;
  return (
    <Card title={t('driver.fleet.offerTitle', { company: offer.companyName })}>
      <p class="card__note">{t('driver.fleet.offerUntil', { day: formatDate(offer.expiresAt, DAY) })}</p>
      {blocked ? (
        <Note tone="warn" icon="clock" title={t('driver.fleet.blockedTitle', { company: offer.companyName })} detail={offer.blockers.map((b) => b.charAt(0).toUpperCase() + b.slice(1)).join('. ') + '.'} />
      ) : (
        /* What happens, said before it does. A courier joining a fleet changes who the network pays and whether
           they have a public page — consequences they would otherwise discover afterwards. */
        <Note
          tone="info"
          icon="truck"
          title={t('driver.fleet.confirmTitle', { company: offer.companyName })}
          detail={[
            t('driver.fleet.keeps'),
            offer.fromCompany ? t('driver.fleet.confirmFrom', { from: offer.fromCompany }) : '',
            courier ? t('driver.fleet.confirmCourier', { company: offer.companyName }) : '',
            t('driver.fleet.signedInAgain'),
          ]
            .filter(Boolean)
            .join(' ')}
        />
      )}
      {/* One solid button: yes, when it can happen now. No is always there, and never the loud one. */}
      <div class="stack">
        {blocked ? null : (
          <Button chevron={false} busy={busy} onClick={onYes}>
            {t('driver.fleet.cta', { company: offer.companyName })}
          </Button>
        )}
        <Button variant="outline" chevron={false} disabled={busy} onClick={onNo}>
          {t('driver.fleet.decline')}
        </Button>
      </div>
    </Card>
  );
}

import { useState } from 'preact/hooks';
import { Button, Card, CodeCard, ErrorNote, Note, Pill, Sheet } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import { mayHandOn, passOnState, type FleetOrder, type PartnerInvite, type PartnerLists, type ordersApi } from '../orders';

type Api = ReturnType<typeof ordersApi>;
const day = (iso: string | undefined) => (iso ? formatDate(iso, { dateStyle: 'medium' }) : '');

/**
 * P4 — WHERE AN ORDER HAS BEEN HANDED, AND THE ONE THING THAT CAN BE DONE ABOUT IT NOW.
 *
 * The user, 2026-10-05: what a fleet cannot carry goes to "partner fleets, then board". An order is in exactly one of
 * these places, and each has its own next step and its own way back: its own fleet's (offer it, or put it on the
 * board) · on offer (take the offer back) · with a partner (theirs now) · on the board (take it back while nobody has
 * it) · offered TO this fleet (take it or leave it) · taken BY this fleet from a partner (give it back, with a reason,
 * until it is on a truck).
 *
 * PASSED ON (the user, 2026-10-06: "only if I allowed that partner"). A fleet that took an order may offer it on to
 * partners of its own where the fleet it came from allows that — one step, no further. Every fleet along the way sees
 * who is carrying: the first fleet "Pwani passed it on to Rift, who carries it"; the one in the middle "Rift carries
 * it — you passed it on"; the one carrying, who it has it from and may give it back to.
 */
export function OrderHandOn({ order, api, hasPartners, lists, onDone }: { order: FleetOrder; api: Api; hasPartners: boolean; lists?: PartnerLists | null; onDone: () => Promise<void> | void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [givingBack, setGivingBack] = useState(false);
  const [reason, setReason] = useState('');

  const run = async (fn: () => Promise<{ error?: unknown; data?: unknown }>) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.error) return setError(r.error);
    // A batch answers 200 even when the one order in it was refused: the refusal is the news.
    const refused = (r.data as { refused?: Array<{ why: string }> } | undefined)?.refused;
    if (refused?.length) return setError({ code: 'INVALID_STATE', title: refused[0].why, detail: refused[0].why, status: 400 });
    await onDone();
  };

  const h = order.handOn;
  const names = (list: Array<{ fleetName: string }> | undefined) => (list ?? []).map((p) => p.fleetName).join(', ');
  const passOn = passOnState(order, lists ?? null);
  let body = null;

  if (order.role === 'offered') {
    body = (
      <>
        <p class="hint">{t('fleet.handOn.offerToYou', { fleet: order.fromFleetName ?? '' })}</p>
        <div class="orders__acts">
          <Button chevron={false} busy={busy} onClick={() => void run(() => api.takeOffer(order.freightId))}>
            {t('fleet.handOn.takeCta')}
          </Button>
          <Button variant="outline" chevron={false} disabled={busy} onClick={() => void run(() => api.leaveOffer(order.freightId))}>
            {t('fleet.handOn.leaveCta')}
          </Button>
        </div>
      </>
    );
  } else if (order.role === 'passed') {
    body = <p class="hint">{t('fleet.handOn.passedOn', { partner: h?.partner?.fleetName ?? '', when: day(h?.takenAt) })}</p>;
  } else if (order.role === 'partner' && h?.onward) {
    // This fleet's own offer to pass it on. Until somebody takes it, or it is taken back, it goes on nobody's truck.
    body = (
      <>
        <p class="hint">{t('fleet.handOn.fromPartnerShort', { fleet: order.fromFleetName ?? '' })}</p>
        <p class="hint">{t('fleet.handOn.onOffer', { to: names(h.onward.offeredTo), when: day(h.onward.at) })}</p>
        <Button variant="outline" chevron={false} busy={busy} onClick={() => void run(() => api.withdrawOffer(order.freightId))}>
          {t('fleet.handOn.withdrawCta')}
        </Button>
      </>
    );
  } else if (order.role === 'partner') {
    body = (
      <>
        <p class="hint">{h?.takenAt ? t('fleet.handOn.fromPartner', { fleet: order.fromFleetName ?? '', when: day(h.takenAt) }) : t('fleet.handOn.fromPartnerShort', { fleet: order.fromFleetName ?? '' })}</p>
        {passOn === 'yes' ? (
          <>
            <Button variant="outline" chevron={false} busy={busy} onClick={() => void run(() => api.passOnOrders([order.freightId]))}>
              {t('fleet.handOn.passOnCta')}
            </Button>
            <p class="hint">{t('fleet.handOn.passOnHint', { fleet: order.fromFleetName ?? '' })}</p>
          </>
        ) : passOn === 'not_allowed' ? (
          <p class="hint">{t('fleet.handOn.passOnNotAllowed', { fleet: order.fromFleetName ?? '' })}</p>
        ) : h?.via ? (
          <p class="hint">{t('fleet.handOn.noFurther')}</p>
        ) : null}
        {order.status === 'ordered' ? (
          givingBack ? (
            <div class="field">
              <label class="field__label" for="ho-why">
                {t('fleet.handOn.handBackWhy')}
              </label>
              <input id="ho-why" class="input" maxLength={280} value={reason} onInput={(e) => setReason(e.currentTarget.value)} />
              <p class="hint">{t('fleet.handOn.handBackHint')}</p>
              <div class="orders__acts">
                <Button variant="outline" chevron={false} onClick={() => setGivingBack(false)}>
                  {t('common.cancel')}
                </Button>
                <Button chevron={false} disabled={reason.trim().length < 3} busy={busy} onClick={() => void run(() => api.handBack(order.freightId, reason.trim()))}>
                  {t('fleet.handOn.handBackConfirm')}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="link" chevron={false} onClick={() => setGivingBack(true)}>
              {t('fleet.handOn.handBackCta', { fleet: order.fromFleetName ?? '' })}
            </Button>
          )
        ) : null}
      </>
    );
  } else if (h?.state === 'offered') {
    body = (
      <>
        <p class="hint">{t('fleet.handOn.onOffer', { to: (h.offeredTo ?? []).map((p) => p.fleetName).join(', '), when: day(h.at) })}</p>
        <Button variant="outline" chevron={false} busy={busy} onClick={() => void run(() => api.withdrawOffer(order.freightId))}>
          {t('fleet.handOn.withdrawCta')}
        </Button>
      </>
    );
  } else if (h?.state === 'partner') {
    body = (
      <>
        <p class="hint">
          {h.via
            ? t('fleet.handOn.withThird', { via: h.via.fleetName, partner: h.partner?.fleetName ?? '', when: day(h.takenAt) })
            : h.takenAt
              ? t('fleet.handOn.withPartner', { partner: h.partner?.fleetName ?? '', when: day(h.takenAt) })
              : t('fleet.handOn.withPartnerAgain', { partner: h.partner?.fleetName ?? '' })}
        </p>
        {h.onward ? <p class="hint">{t('fleet.handOn.partnerOffering', { partner: h.partner?.fleetName ?? '', to: names(h.onward.offeredTo) })}</p> : null}
      </>
    );
  } else if (h?.state === 'board') {
    body = (
      <>
        {order.status === 'available' ? <p class="hint">{t('fleet.handOn.onBoard', { when: day(h.at) })}</p> : null}
        {order.status === 'available' ? (
          <Button variant="outline" chevron={false} busy={busy} onClick={() => void run(() => api.takeBack(order.freightId))}>
            {t('fleet.handOn.takeBackCta')}
          </Button>
        ) : null}
      </>
    );
  } else if (mayHandOn(order)) {
    body = (
      <>
        <p class="field__label">{t('fleet.handOn.title')}</p>
        {hasPartners ? (
          <>
            <Button variant="outline" chevron={false} busy={busy} onClick={() => void run(() => api.offerOrders([order.freightId]))}>
              {t('fleet.handOn.offerCta')}
            </Button>
            <p class="hint">{t('fleet.handOn.offerHint')}</p>
          </>
        ) : (
          <p class="hint">{t('fleet.handOn.noPartners')}</p>
        )}
        <Button variant="link" chevron={false} disabled={busy} onClick={() => void run(() => api.releaseOrders([order.freightId]))}>
          {t('fleet.handOn.releaseCta')}
        </Button>
        <p class="hint">{t('fleet.handOn.releaseHint')}</p>
      </>
    );
  }

  const back = order.handedBack;
  if (!body && !back) return null;
  return (
    <div class="handon">
      {back ? <Note tone="warn" icon="info" title={t('fleet.handOn.givenBack', { partner: back.fleetName ?? '', when: day(back.at), reason: back.reason ?? '' })} /> : null}
      {body}
      {error ? <ErrorNote error={error as never} showDetail /> : null}
    </div>
  );
}

/**
 * P4 — THE FLEETS THIS ONE HANDS WORK TO, AND THE FLEETS THAT HAND WORK TO IT.
 *
 * Made like a contract's link: this fleet names a partner and is shown a code once; the partner's office enters it.
 * The same card is where a code somebody else sent is entered.
 */
export function PartnersCard({ api, lists, onChanged }: { api: Api | null; lists: PartnerLists | null; onChanged: () => Promise<void> | void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [issued, setIssued] = useState<PartnerInvite | null>(null);
  const [linked, setLinked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = async <T,>(fn: () => Promise<{ data?: T; error?: unknown }>, after?: (data: T) => void) => {
    setBusy(true);
    setError(null);
    setLinked(null);
    const r = await fn();
    setBusy(false);
    if (r.error || r.data === undefined) return setError(r.error);
    after?.(r.data);
    await onChanged();
  };

  const mine = lists?.offeringTo ?? [];
  const theirs = (lists?.offeredBy ?? []).filter((p) => p.status === 'active');

  return (
    <Card title={t('fleet.partners.title')}>
      <p class="hint">{t('fleet.partners.lede')}</p>
      {mine.length ? (
        <div class="rows" role="list">
          {mine.map((p) => (
            <div key={p.partnershipId} class="row row--static" role="listitem">
              <span class="row__body">
                <span class="row__t">{p.partnerName}</span>
                <span class="row__s">
                  {p.status === 'active'
                    ? t('fleet.partners.linked', { when: day(p.linkedAt) })
                    : p.status === 'invited'
                      ? t('fleet.partners.codeOut', { until: day(p.inviteExpiresAt) })
                      : t('fleet.partners.endedOn', { when: day(p.ended?.at) })}
                </span>
                {/* THE LEAVE TO PASS ON: this fleet's alone to give, off until it does. */}
                {p.status === 'active' ? (
                  <label class="checkline partners__pass">
                    <input type="checkbox" checked={p.mayPassOn === true} disabled={busy} onChange={(e) => void run(() => api!.setPassOn(p.partnershipId, e.currentTarget.checked))} />
                    <span>{t('fleet.partners.mayPassOn')}</span>
                  </label>
                ) : null}
                {p.status !== 'ended' ? (
                  <span class="orders__acts">
                    {p.status === 'invited' ? (
                      <Button variant="outline" chevron={false} disabled={busy} onClick={() => void run(() => api!.reissuePartner(p.partnershipId), setIssued)}>
                        {t('fleet.partners.newCode')}
                      </Button>
                    ) : null}
                    <Button variant="link" chevron={false} disabled={busy} onClick={() => void run(() => api!.endPartner(p.partnershipId))}>
                      {t('fleet.partners.end')}
                    </Button>
                  </span>
                ) : null}
              </span>
              <span class="row__end">
                <Pill tone={p.status === 'active' ? 'ok' : p.status === 'invited' ? 'info' : 'idle'}>{t(`fleet.partners.${p.status}`)}</Pill>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p class="hint">{t('fleet.partners.none')}</p>
      )}

      <div class="field" style="margin-top:12px">
        <label class="field__label" for="pt-name">
          {t('fleet.partners.nameLabel')}
        </label>
        <input id="pt-name" class="input" maxLength={120} value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <div style="margin-top:8px">
          <Button
            variant="outline"
            chevron={false}
            disabled={!name.trim() || busy}
            onClick={() =>
              void run(
                () => api!.invitePartner(name.trim()),
                (d) => {
                  setIssued(d);
                  setName('');
                },
              )
            }
          >
            {t('fleet.partners.nameCta')}
          </Button>
        </div>
      </div>

      <div class="field" style="margin-top:16px">
        <label class="field__label" for="pt-code">
          {t('fleet.partners.linkLabel')}
        </label>
        <input id="pt-code" class="input" maxLength={40} autocomplete="off" spellcheck={false} placeholder="ABCDE-FGHJK" value={code} onInput={(e) => setCode(e.currentTarget.value)} />
        <div style="margin-top:8px">
          <Button
            variant="outline"
            chevron={false}
            disabled={!code.trim() || busy}
            onClick={() =>
              void run(
                () => api!.linkPartner(code.trim()),
                (d) => {
                  setLinked(d?.fromFleetName ?? '');
                  setCode('');
                },
              )
            }
          >
            {t('fleet.partners.linkCta')}
          </Button>
        </div>
      </div>
      {linked ? <Note tone="ok" icon="check" title={t('fleet.partners.linkedNote', { fleet: linked })} /> : null}
      {error ? <ErrorNote error={error as never} showDetail /> : null}

      {theirs.length ? (
        <>
          <p class="field__label" style="margin-top:16px">
            {t('fleet.partners.offeredBy')}
          </p>
          <div class="rows" role="list">
            {theirs.map((p) => (
              <div key={p.partnershipId} class="row row--static" role="listitem">
                <span class="row__body">
                  <span class="row__t">{t('fleet.partners.offeredByRow', { fleet: p.fromFleetName, when: day(p.linkedAt) })}</span>
                  <span class="row__s">{t(p.mayPassOn ? 'fleet.partners.theyAllow' : 'fleet.partners.theyDoNotAllow')}</span>
                </span>
                <span class="row__end">
                  <Button variant="link" chevron={false} disabled={busy} onClick={() => void run(() => api!.endPartner(p.partnershipId))}>
                    {t('fleet.partners.end')}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <Sheet open={issued !== null} onClose={() => setIssued(null)} title={t('fleet.partners.codeTitle', { partner: issued?.partnership.partnerName ?? '' })}>
        {issued ? (
          <>
            <CodeCard label={t('fleet.partners.codeLabel')} code={issued.code} />
            <p class="hint">{t('fleet.partners.codeHint', { until: day(issued.expiresAt) })}</p>
          </>
        ) : null}
      </Sheet>
    </Card>
  );
}

import { useState } from 'preact/hooks';
import { Button, Card, Checklist, CodeBoxes, ErrorNote, Icon, Note, PlaceMap, ReadAloud, ShopDetailSheet } from '../../../shared/ui';
import { toPlaceWords } from '../../../shared/placewords';
import { useT } from '../../../shared/i18n';

import { DRIVER_CLASSES, joinSpoken, needsLicence, pickedClasses, pickedVehicle, roleMeta, stepBlocker, stepsFor, vehicleClassFor } from '../logic';
import type { HomeActions, HomeState } from '../useHomeApp';

export interface JoinScreenProps {
  state: HomeState;
  actions: HomeActions;
}

/**
 * The join wizard — one decision per screen, the only place in the product where an
 * account is BORN. Roles the backend can self-serve (shop, driver, hub) run the full
 * phone-verified signup; a store registers itself; a fleet office is invite-only and says
 * so instead of dead-ending.
 */
export function JoinScreen({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role;
  if (!role) return null;

  if (role.kind === 'invite' && state.step !== 'done') return <InviteOnly state={state} actions={actions} />;

  const steps = stepsFor(role.kind);
  const at = steps.indexOf(state.step) + 1;
  const blocker = stepBlocker(role, state.step, state.form, t);

  return (
    <div class="scr">
      {state.step !== 'done' ? (
        <div class="dots" role="img" aria-label={t('home.join.step', { at, total: steps.length - 1 })}>
          {steps.slice(0, -1).map((s, i) => (
            <span key={s} class={`dots__dot${i === at - 1 ? ' dots__dot--on' : i < at - 1 ? ' dots__dot--done' : ''}`} />
          ))}
        </div>
      ) : null}

      {state.error ? <ErrorNote error={state.error} /> : null}

      {state.step === 'phone' ? <PhoneStep state={state} actions={actions} /> : null}
      {state.step === 'code' ? <CodeStep state={state} actions={actions} /> : null}
      {state.step === 'about' ? <AboutStep state={state} actions={actions} /> : null}
      {state.step === 'where' ? <WhereStep state={state} actions={actions} /> : null}
      {state.step === 'login' ? <LoginStep state={state} actions={actions} /> : null}
      {state.step === 'done' ? <DoneStep state={state} actions={actions} /> : null}

      {state.step !== 'done' ? (
        <div class="scr__foot">
          <Button variant="link" full={false} onClick={actions.back}>
            {t('home.goBack')}
          </Button>
          <ReadAloud text={() => `${joinSpoken(role, state.step, t)} ${blocker ?? ''}`} label={t('home.readAloud')} />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ phone -- */

function PhoneStep({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role!;
  const blocker = stepBlocker(role, 'phone', state.form, t);
  return (
    <>
      <h1 class="scr__title">{t('home.join.joinAs', { role: roleMeta(role, t).labelLower })}</h1>
      <p class="scr__lede">{t('home.join.phone.lede')}</p>

      <Card>
        <div class="field">
          <label class="field__label" for="phone">
            {t('home.join.phone.label')}
          </label>
          <input
            id="phone"
            class="input"
            type="tel"
            inputMode="tel"
            value={state.form.phone}
            onInput={(e) => actions.setForm({ phone: e.currentTarget.value })}
            placeholder="+254 700 000 000"
            autocomplete="tel"
            enterkeyhint="send"
          />
        </div>
      </Card>

      <div class="scr__cta">
        <Button onClick={() => void actions.sendCode()} disabled={Boolean(blocker)} busy={state.busy === 'code'}>
          {t('home.join.phone.cta')}
        </Button>
        {blocker ? <p class="hint" style="margin-top:8px">{blocker}</p> : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- code -- */

function CodeStep({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role!;
  const blocker = stepBlocker(role, 'code', state.form, t);
  return (
    <>
      <h1 class="scr__title">{t('home.join.code.title')}</h1>
      <p class="scr__lede">{t('home.join.code.lede', { phone: state.form.phone })}</p>

      <Card>
        <div class="field">
          <span class="field__label">{t('home.join.code.label')}</span>
          <CodeBoxes
            id="otp"
            label={t('home.join.code.boxLabel')}
            length={state.form.code.length > 4 ? 6 : 4}
            value={state.form.code}
            onInput={(code) => actions.setForm({ code })}
          />
        </div>
        {state.issuedCode ? <p class="hint" style="margin-top:10px">{t('home.join.code.sandbox', { code: state.issuedCode })}</p> : null}
      </Card>

      <div class="scr__cta">
        <Button onClick={() => void actions.confirmCode()} disabled={Boolean(blocker)} busy={state.busy === 'verify'}>
          {t('home.join.code.cta')}
        </Button>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- country -- */

/**
 * Which country somebody is joining in — and nothing to choose when there is only one.
 *
 * A pick list rather than a free-text code, because this decides which company contracts them and the
 * backend refuses a country with no company behind it. Typing "TZ" and being told at the end of a wizard
 * that nobody there can invoice you is the worst possible moment to find out; the list only ever offers
 * countries the network can actually take somebody on in.
 *
 * With one country the control is not rendered at all — a select with a single option is a decision nobody
 * is making. The hook has already put that country on the form, so the sign-up still names it.
 */
function CountryField({ id, state, actions }: JoinScreenProps & { id: string }) {
  const t = useT();
  const { countries, countriesState, form } = state;
  if (countriesState === 'error') return <Note tone="warn" icon="warning" title={t('home.join.country.unavailable')} />;
  if (countries.length < 2) return null;
  return (
    <div class="field" style="margin-top:12px">
      <label class="field__label" for={id}>
        {t('home.join.country.label')}
      </label>
      <select id={id} class="input" value={form.country} onChange={(e) => actions.setForm({ country: e.currentTarget.value, zone: '' })}>
        <option value="">{t('home.join.country.choose')}</option>
        {countries.map((c) => (
          <option key={c.country} value={c.country}>
            {c.name} ({c.country}){c.settles === false ? ` · ${t('home.join.country.noMoney')}` : ''}
          </option>
        ))}
      </select>
      <p class="card__note">{t('home.join.country.note')}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ about -- */

function AboutStep({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role!;
  const f = state.form;
  const blocker = stepBlocker(role, 'about', f, t);
  // Derived once, so the card and the blocker can never disagree about which vehicle is chosen.
  const chosen = vehicleClassFor(f);
  const nameLabel =
    role.id === 'pudo' ? t('home.join.about.nameShop') : role.id === 'mdp' ? t('home.join.about.nameHub') : role.id === 'vendor' ? t('home.join.about.nameStore') : t('home.join.about.nameDriver');

  return (
    <>
      <h1 class="scr__title">{role.id === 'driver' ? t('home.join.about.titleDriver') : t('home.join.about.titlePlace')}</h1>
      <p class="scr__lede">{roleMeta(role, t).promise}</p>

      <Card>
        <div class="field">
          <label class="field__label" for="dname">
            {nameLabel}
          </label>
          <input
            id="dname"
            class="input"
            value={f.displayName}
            onInput={(e) => actions.setForm({ displayName: e.currentTarget.value })}
            placeholder={role.id === 'pudo' ? t('home.join.about.phShop') : role.id === 'driver' ? t('home.join.about.phDriver') : role.id === 'mdp' ? t('home.join.about.phHub') : t('home.join.about.phStore')}
          />
        </div>

        {role.id === 'vendor' ? <CountryField id="country" state={state} actions={actions} /> : null}

        {role.id !== 'mdp' && role.id !== 'vendor' ? (
          <>
            <div class="field" style="margin-top:12px">
              <label class="field__label" for="fname">
                {t('home.join.about.fullName')}
              </label>
              <input id="fname" class="input" value={f.fullName} onInput={(e) => actions.setForm({ fullName: e.currentTarget.value })} placeholder={t('home.join.about.fullNamePh')} />
            </div>
            <div class="field" style="margin-top:12px">
              <label class="field__label" for="nid">
                {t('home.join.about.idNumber')}
              </label>
              <input id="nid" class="input" value={f.nationalId} onInput={(e) => actions.setForm({ nationalId: e.currentTarget.value })} spellcheck={false} />
            </div>
            <p class="card__note">{t('home.join.about.privacyNote')}</p>
          </>
        ) : null}
      </Card>

      {/* `title`, not `label`: "What do you drive?" was the section's aria-label and rendered nothing, so
          the form showed a row of bare chips and never asked the question out loud. */}
      {role.id === 'driver' ? (
        <Card title={t('home.join.about.driveTitle')}>
          <div class="chips">
            {DRIVER_CLASSES.map((c) => {
              const on = f.licenceClasses.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  class={`chip chip--tap${on ? ' chip--on' : ''}`}
                  aria-pressed={on}
                  onClick={() => actions.setForm(pickedClasses(f, c))}
                >
                  {c}
                </button>
              );
            })}
          </div>
          <p class="card__note">{t('home.join.about.driveNote')}</p>

          {/* THE LICENCE, asked for only where the network actually requires one. Without these two
              fields anything above a motorcycle was refused outright, which is why joining independently
              looked impossible. Shown the moment a heavy class is picked, so the reason is visible. */}
          {needsLicence(f.licenceClasses) ? (
            <>
              <div class="field" style="margin-top:12px">
                <label class="field__label" for="licno">
                  {t('home.join.about.licenceNumber')}
                </label>
                <input id="licno" class="input" value={f.licenceNumber} onInput={(e) => actions.setForm({ licenceNumber: e.currentTarget.value })} spellcheck={false} />
              </div>
              <div class="field" style="margin-top:12px">
                <label class="field__label" for="licexp">
                  {t('home.join.about.licenceExpiry')}
                </label>
                <input id="licexp" class="input" type="date" value={f.licenceExpiresAt} onInput={(e) => actions.setForm({ licenceExpiresAt: e.currentTarget.value })} />
              </div>
              <p class="card__note">{t('home.join.about.licenceNote')}</p>
            </>
          ) : null}
        </Card>
      ) : null}

      {/* THE VEHICLE THEY ARRIVE WITH.
          This door makes self-employed couriers — there is no fleet code on it — and one without a
          vehicle is an account that cannot take a load: the driver app opens on "scan the sticker on the
          dashboard", and the only stickers in the network belong to vehicles a fleet registered. So it is
          asked here, and the class offered is only what they have just said they can drive. */}
      {role.id === 'driver' ? (
        <Card title={t('home.join.about.vehicleTitle')}>
          {/* THE WHOLE CATALOGUE, not the classes ticked above. Offering only those read as "these are
              the only vehicles you may have" — a driver with a truck saw a bike and a van and reasonably
              concluded the network did not carry trucks. Saying you own one also clears you to drive it. */}
          <div class="chips">
            {DRIVER_CLASSES.map((c) => (
              <button
                key={c}
                type="button"
                class={`chip chip--tap${chosen === c ? ' chip--on' : ''}`}
                aria-pressed={chosen === c}
                onClick={() => actions.setForm(pickedVehicle(f, c))}
              >
                {c}
              </button>
            ))}
          </div>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="plate">
              {t('home.join.about.vehiclePlate')}
            </label>
            <input id="plate" class="input" value={f.vehiclePlate} onInput={(e) => actions.setForm({ vehiclePlate: e.currentTarget.value })} spellcheck={false} />
          </div>
          {chosen === 'truck' ? (
            <div class="field" style="margin-top:12px">
              <span class="field__label">{t('home.join.about.truckSubtype')}</span>
              {/* Read from the network, never restated here: the catalogue runs to twenty-odd bodies and
                  combinations, and a hand-typed list in a client is wrong the day after it is written. */}
              {state.truckSubtypes.length === 0 ? (
                <p class="card__note">{t('home.join.about.truckSubtypeLoading')}</p>
              ) : (
                <div class="chips">
                  {state.truckSubtypes.map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      class={`chip chip--tap${f.truckSubtype === sub.id ? ' chip--on' : ''}`}
                      aria-pressed={f.truckSubtype === sub.id}
                      onClick={() => actions.setForm({ truckSubtype: sub.id })}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          <p class="card__note">{t('home.join.about.vehicleNote')}</p>
        </Card>
      ) : null}

      <div class="scr__cta">
        <Button
          onClick={() => (role.kind === 'vendor' ? void actions.submit() : actions.advance())}
          disabled={Boolean(blocker)}
          busy={state.busy === 'submit'}
        >
          {role.kind === 'vendor' ? t('home.join.about.ctaVendor') : t('home.continue')}
        </Button>
        {blocker ? <p class="hint" style="margin-top:8px">{blocker}</p> : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ where -- */

function WhereStep({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role!;
  const f = state.form;
  const blocker = stepBlocker(role, 'where', f, t);
  // Suggest the areas of the country being joined, not every area on the network — a Kenyan zone code is
  // no help to somebody opening in Addis, and offering it invites picking one.
  const zones = [...new Set(state.points.filter((p) => !f.country || !p.country || p.country === f.country).map((p) => p.zone).filter(Boolean))].sort();
  const [openShop, setOpenShop] = useState<string | null>(null);
  const preview = openShop ? state.points.find((p) => p.did === openShop) ?? null : null;

  return (
    <>
      <h1 class="scr__title">{role.id === 'driver' ? t('home.join.where.titleDriver') : t('home.join.where.title')}</h1>
      <p class="scr__lede">{t('home.join.where.lede')}</p>

      <PlaceMap
        label={t('home.join.where.mapLabel')}
        pins={state.points.filter((p) => p.location).map((p) => ({ id: p.did, label: p.shopName, point: p.location! }))}
        selectedId={openShop}
        onPick={setOpenShop}
        onDrop={(location) => actions.setForm({ location })}
        dropped={f.location}
      />

      {f.location ? (
        <Card label={t('home.join.where.wordsTitle')}>
          <p class="words">{toPlaceWords(f.location)}</p>
          <p class="card__note">{t('home.join.where.wordsNote')}</p>
          <ReadAloud text={() => t('home.join.where.wordsAloud', { words: toPlaceWords(f.location!).split(' ').join(', ') })} label={t('home.join.where.wordsAloudLabel')} />
        </Card>
      ) : (
        <Note tone="info" icon="pin" title={t('home.join.where.noPin')} />
      )}

      <Card label={t('home.join.where.areaTitle')}>
        {/* Which country first: it narrows the areas below, and it is what decides who contracts them. */}
        <CountryField id="join-country" state={state} actions={actions} />
        {/* Type-or-pick: existing network zones are SUGGESTIONS (datalist), but a shop opening in a brand-new
            area must be able to type it — a plain dropdown of existing zones would trap them (they cannot add
            an area that isn't already on the map). */}
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="join-zone">
            {t('home.join.where.areaLabel')}
          </label>
          <input
            id="join-zone"
            class="input"
            list="join-zones"
            value={f.zone}
            onInput={(e) => actions.setForm({ zone: e.currentTarget.value })}
            placeholder="Z-A"
            autocapitalize="characters"
          />
        </div>
        {zones.length ? (
          <datalist id="join-zones">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        ) : null}
        <p class="card__note">{t('home.join.where.areaHint')}</p>
        {role.id !== 'driver' ? (
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="landmark">
              {t('home.join.where.landmarkLabel')}
            </label>
            <input id="landmark" class="input" value={f.landmark} onInput={(e) => actions.setForm({ landmark: e.currentTarget.value })} placeholder={t('home.join.where.landmarkPh')} />
          </div>
        ) : null}
      </Card>

      <div class="scr__cta">
        <Button onClick={actions.advance} disabled={Boolean(blocker)}>
          {t('home.continue')}
        </Button>
        {blocker ? <p class="hint" style="margin-top:8px">{blocker}</p> : null}
      </div>

      {/* G4b — the bearings pins are tappable: an info-only preview, so no pin is a dead tap. */}
      <ShopDetailSheet
        open={!!preview}
        title={preview?.shopName ?? t('home.join.where.shopFallback')}
        subtitle={preview ? t('home.zone', { zone: preview.zone }) : undefined}
        lines={preview ? [preview.openState === 'open' ? t('home.openNow') : t('home.closedNow')] : []}
        location={preview?.location ?? null}
        onClose={() => setOpenShop(null)}
      />
    </>
  );
}

/* ------------------------------------------------------------------ login -- */

function LoginStep({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role!;
  const f = state.form;
  const blocker = stepBlocker(role, 'login', f, t);
  return (
    <>
      <h1 class="scr__title">{t('home.join.login.title')}</h1>
      <p class="scr__lede">{t('home.join.login.lede')}</p>

      <Card>
        <div class="field">
          <label class="field__label" for="email">
            {t('home.join.login.email')}
          </label>
          <input
            id="email"
            class="input"
            type="email"
            value={f.email}
            onInput={(e) => actions.setForm({ email: e.currentTarget.value })}
            placeholder="you@example.com"
            autocomplete="username"
            autocapitalize="none"
            spellcheck={false}
          />
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="pass">
            {t('home.join.login.password')}
          </label>
          <input
            id="pass"
            class="input"
            type="password"
            value={f.password}
            onInput={(e) => actions.setForm({ password: e.currentTarget.value })}
            autocomplete="new-password"
            placeholder={t('home.join.login.passwordPh')}
          />
        </div>
      </Card>

      <div class="scr__cta">
        <Button onClick={() => void actions.submit()} disabled={Boolean(blocker)} busy={state.busy === 'submit'}>
          {t('home.join.joinAs', { role: roleMeta(role, t).labelLower })}
        </Button>
        {blocker ? <p class="hint" style="margin-top:8px">{blocker}</p> : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- done -- */

function DoneStep({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role!;
  const acc = state.account;
  const store = state.store;

  return (
    <>
      <h1 class="scr__title">{t('home.join.done.title')}</h1>
      <p class="scr__lede">{role.id === 'vendor' ? t('home.join.done.ledeVendor') : t('home.join.done.ledeWelcome', { name: state.form.displayName })}</p>

      {store ? (
        <>
          <Card label={t('home.join.done.storeId')}>
            <p class="cred">{store.vendorId}</p>
          </Card>
          <Card label={t('home.join.done.storeSecret')}>
            <p class="cred">{store.secret}</p>
          </Card>
          <Card title={t('home.join.done.writeDown')} tone="soft">
            <Checklist items={[t('home.join.done.secret1'), t('home.join.done.secret2'), t('home.join.done.secret3')]} />
          </Card>
        </>
      ) : null}

      {acc ? (
        <Card title={t('home.join.done.whatNext')} tone="soft">
          <Checklist
            items={
              acc.entityStatus === 'ACTIVE'
                ? [t('home.join.done.active1'), t('home.join.done.active2'), t('home.join.done.active3')]
                : [t('home.join.done.pending1'), t('home.join.done.pending2'), t('home.join.done.pending3')]
            }
          />
        </Card>
      ) : null}

      <div class="scr__cta">
        <a class="btn btn--primary btn--full" href={role.app}>
          {t('home.join.done.openApp', { name: roleMeta(role, t).appNoun })}
          <Icon name="chevronRight" size={20} class="btn__chev" />
        </a>
      </div>

      <Button variant="link" onClick={actions.restart}>
        {t('home.join.done.restart')}
      </Button>
    </>
  );
}

/* ----------------------------------------------------------- invite-only -- */

function InviteOnly({ state, actions }: JoinScreenProps) {
  const t = useT();
  const role = state.role!;
  return (
    <div>
      <h1 class="scr__title">{t('home.join.invite.title', { role: roleMeta(role, t).label })}</h1>
      <p class="scr__lede">{t('home.join.invite.lede')}</p>

      <Card title={t('home.join.invite.whatYouGet')} tone="soft">
        <Checklist items={[t('home.join.invite.get1'), t('home.join.invite.get2'), t('home.join.invite.get3')]} />
      </Card>

      <div class="scr__cta">
        <a class="btn btn--primary btn--full" href={role.app}>
          {t('home.join.invite.haveCode')}
          <Icon name="chevronRight" size={20} class="btn__chev" />
        </a>
      </div>

      <Button variant="link" onClick={() => actions.go('roles')}>
        {t('home.join.invite.pickElse')}
      </Button>
    </div>
  );
}

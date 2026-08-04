import { useState } from 'preact/hooks';
import { Button, Card, Checklist, CodeBoxes, ErrorNote, Icon, Note, PlaceMap, ReadAloud, ShopDetailSheet } from '../../../shared/ui';
import { toPlaceWords } from '../../../shared/placewords';

import { DRIVER_CLASSES, joinSpoken, stepBlocker, stepsFor } from '../logic';
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
  const role = state.role;
  if (!role) return null;

  if (role.kind === 'invite' && state.step !== 'done') return <InviteOnly state={state} actions={actions} />;

  const steps = stepsFor(role.kind);
  const at = steps.indexOf(state.step) + 1;
  const blocker = stepBlocker(role, state.step, state.form);

  return (
    <div class="scr">
      {state.step !== 'done' ? (
        <div class="dots" role="img" aria-label={`Step ${at} of ${steps.length - 1}`}>
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
            Go back
          </Button>
          <ReadAloud text={() => `${joinSpoken(role, state.step)} ${blocker ?? ''}`} label="Read this aloud" />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ phone -- */

function PhoneStep({ state, actions }: JoinScreenProps) {
  const role = state.role!;
  const blocker = stepBlocker(role, 'phone', state.form);
  return (
    <>
      <h1 class="scr__title">{`Join as ${role.label.toLowerCase()}`}</h1>
      <p class="scr__lede">Your phone number is your key to the network. We send a code to check it works.</p>

      <Card>
        <div class="field">
          <label class="field__label" for="phone">
            Phone number
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
          Send me the code
        </Button>
        {blocker ? <p class="hint" style="margin-top:8px">{blocker}</p> : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- code -- */

function CodeStep({ state, actions }: JoinScreenProps) {
  const role = state.role!;
  const blocker = stepBlocker(role, 'code', state.form);
  return (
    <>
      <h1 class="scr__title">Type the code</h1>
      <p class="scr__lede">{`We sent it to ${state.form.phone}.`}</p>

      <Card>
        <div class="field">
          <span class="field__label">Your code</span>
          <CodeBoxes
            id="otp"
            label="The code sent to your phone"
            length={state.form.code.length > 4 ? 6 : 4}
            value={state.form.code}
            onInput={(code) => actions.setForm({ code })}
          />
        </div>
        {state.issuedCode ? <p class="hint" style="margin-top:10px">{`Sandbox: your code is ${state.issuedCode}`}</p> : null}
      </Card>

      <div class="scr__cta">
        <Button onClick={() => void actions.confirmCode()} disabled={Boolean(blocker)} busy={state.busy === 'verify'}>
          Check the code
        </Button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ about -- */

function AboutStep({ state, actions }: JoinScreenProps) {
  const role = state.role!;
  const f = state.form;
  const blocker = stepBlocker(role, 'about', f);
  const nameLabel = role.id === 'pudo' ? 'Shop name' : role.id === 'mdp' ? 'Hub name' : role.id === 'vendor' ? 'Store name' : 'Your name as drivers see it';

  return (
    <>
      <h1 class="scr__title">{role.id === 'driver' ? 'About you' : 'About your place'}</h1>
      <p class="scr__lede">{role.promise}</p>

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
            placeholder={role.id === 'pudo' ? 'Mama Sarah Shop' : role.id === 'driver' ? 'Amos K.' : role.id === 'mdp' ? 'Central Sort' : 'Nairobi Threads'}
          />
        </div>

        {role.id === 'vendor' ? (
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="country">
              Country
            </label>
            <input
              id="country"
              class="input"
              value={f.vendorCountry}
              onInput={(e) => actions.setForm({ vendorCountry: e.currentTarget.value })}
              placeholder="KE"
              autocapitalize="characters"
            />
          </div>
        ) : null}

        {role.id !== 'mdp' && role.id !== 'vendor' ? (
          <>
            <div class="field" style="margin-top:12px">
              <label class="field__label" for="fname">
                Your full name
              </label>
              <input id="fname" class="input" value={f.fullName} onInput={(e) => actions.setForm({ fullName: e.currentTarget.value })} placeholder="As on your ID" />
            </div>
            <div class="field" style="margin-top:12px">
              <label class="field__label" for="nid">
                ID number
              </label>
              <input id="nid" class="input" value={f.nationalId} onInput={(e) => actions.setForm({ nationalId: e.currentTarget.value })} spellcheck={false} />
            </div>
            <p class="card__note">Your name and ID are kept private — they never show on the network.</p>
          </>
        ) : null}
      </Card>

      {role.id === 'driver' ? (
        <Card label="What do you drive?">
          <div class="chips">
            {DRIVER_CLASSES.map((c) => {
              const on = f.licenceClasses.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  class={`chip chip--tap${on ? ' chip--on' : ''}`}
                  aria-pressed={on}
                  onClick={() => actions.setForm({ licenceClasses: on ? f.licenceClasses.filter((x) => x !== c) : [...f.licenceClasses, c] })}
                >
                  {c}
                </button>
              );
            })}
          </div>
          <p class="card__note">A bike or motorcycle starts today. Anything heavier needs a licence check first.</p>
        </Card>
      ) : null}

      <div class="scr__cta">
        <Button
          onClick={() => (role.kind === 'vendor' ? void actions.submit() : actions.advance())}
          disabled={Boolean(blocker)}
          busy={state.busy === 'submit'}
        >
          {role.kind === 'vendor' ? 'Create my store' : 'Continue'}
        </Button>
        {blocker ? <p class="hint" style="margin-top:8px">{blocker}</p> : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ where -- */

function WhereStep({ state, actions }: JoinScreenProps) {
  const role = state.role!;
  const f = state.form;
  const blocker = stepBlocker(role, 'where', f);
  const zones = [...new Set(state.points.map((p) => p.zone).filter(Boolean))].sort();
  const [openShop, setOpenShop] = useState<string | null>(null);
  const preview = openShop ? state.points.find((p) => p.did === openShop) ?? null : null;

  return (
    <>
      <h1 class="scr__title">{role.id === 'driver' ? 'Where do you start?' : 'Where are you?'}</h1>
      <p class="scr__lede">Tap the map to drop your pin — or tap a shop to see it. No street address needed.</p>

      <PlaceMap
        label="Tap the map to drop your pin"
        pins={state.points.filter((p) => p.location).map((p) => ({ id: p.did, label: p.shopName, point: p.location! }))}
        selectedId={openShop}
        onPick={setOpenShop}
        onDrop={(location) => actions.setForm({ location })}
        dropped={f.location}
      />

      {f.location ? (
        <Card label="Your three words">
          <p class="words">{toPlaceWords(f.location)}</p>
          <p class="card__note">Say these three words and anyone can find you. Put them on your sign.</p>
          <ReadAloud text={() => `Your three words are: ${toPlaceWords(f.location!).split(' ').join(', ')}.`} label="Say them aloud" />
        </Card>
      ) : (
        <Note tone="info" icon="pin" title="Tap the map above to drop your pin" />
      )}

      <Card label="Which area do you serve?">
        {zones.length ? (
          <select class="select" value={f.zone} onChange={(e) => actions.setForm({ zone: e.currentTarget.value })}>
            <option value="">Pick your area</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        ) : (
          <input class="input" value={f.zone} onInput={(e) => actions.setForm({ zone: e.currentTarget.value })} placeholder="Z-A" autocapitalize="characters" />
        )}
        {role.id !== 'driver' ? (
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="landmark">
              Nearest landmark (optional)
            </label>
            <input id="landmark" class="input" value={f.landmark} onInput={(e) => actions.setForm({ landmark: e.currentTarget.value })} placeholder="Blue gate, next to the market" />
          </div>
        ) : null}
      </Card>

      <div class="scr__cta">
        <Button onClick={actions.advance} disabled={Boolean(blocker)}>
          Continue
        </Button>
        {blocker ? <p class="hint" style="margin-top:8px">{blocker}</p> : null}
      </div>

      {/* G4b — the bearings pins are tappable: an info-only preview, so no pin is a dead tap. */}
      <ShopDetailSheet
        open={!!preview}
        title={preview?.shopName ?? 'Shop'}
        subtitle={preview ? `Zone ${preview.zone}` : undefined}
        lines={preview ? [preview.openState === 'open' ? 'Open now' : 'Closed right now'] : []}
        location={preview?.location ?? null}
        onClose={() => setOpenShop(null)}
      />
    </>
  );
}

/* ------------------------------------------------------------------ login -- */

function LoginStep({ state, actions }: JoinScreenProps) {
  const role = state.role!;
  const f = state.form;
  const blocker = stepBlocker(role, 'login', f);
  return (
    <>
      <h1 class="scr__title">How you sign in</h1>
      <p class="scr__lede">This is what opens your app from now on.</p>

      <Card>
        <div class="field">
          <label class="field__label" for="email">
            Email
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
            Password
          </label>
          <input
            id="pass"
            class="input"
            type="password"
            value={f.password}
            onInput={(e) => actions.setForm({ password: e.currentTarget.value })}
            autocomplete="new-password"
            placeholder="At least 6 characters"
          />
        </div>
      </Card>

      <div class="scr__cta">
        <Button onClick={() => void actions.submit()} disabled={Boolean(blocker)} busy={state.busy === 'submit'}>
          {`Join as ${role.label.toLowerCase()}`}
        </Button>
        {blocker ? <p class="hint" style="margin-top:8px">{blocker}</p> : null}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- done -- */

function DoneStep({ state, actions }: JoinScreenProps) {
  const role = state.role!;
  const acc = state.account;
  const store = state.store;

  return (
    <>
      <h1 class="scr__title">You are in</h1>
      <p class="scr__lede">{role.id === 'vendor' ? 'Your store is registered.' : `Welcome to SeeBuyGet, ${state.form.displayName}.`}</p>

      {store ? (
        <>
          <Card label="Store ID">
            <p class="cred">{store.vendorId}</p>
          </Card>
          <Card label="Store secret — shown once">
            <p class="cred">{store.secret}</p>
          </Card>
          <Card title="Write these down now" tone="soft">
            <Checklist items={['The secret opens your store app', 'It also signs your order callbacks', 'SeeBuyGet cannot show it again']} />
          </Card>
        </>
      ) : null}

      {acc ? (
        <Card title="What happens next" tone="soft">
          <Checklist
            items={
              acc.entityStatus === 'ACTIVE'
                ? ['Your app is ready to open', 'Sign in with your email and password', 'Your phone number stays your key']
                : [
                    'SeeBuyGet checks your details — usually same day',
                    'You can open your app and look around now',
                    'You start working the moment you are approved',
                  ]
            }
          />
        </Card>
      ) : null}

      <div class="scr__cta">
        <a class="btn btn--primary btn--full" href={role.app}>
          {`Open the ${role.id === 'pudo' ? 'shop' : role.id === 'mdp' ? 'hub' : role.id === 'vendor' ? 'store' : role.label.replace('A ', '')} app`}
          <Icon name="chevronRight" size={20} class="btn__chev" />
        </a>
      </div>

      <Button variant="link" onClick={actions.restart}>
        Back to the start
      </Button>
    </>
  );
}

/* ----------------------------------------------------------- invite-only -- */

function InviteOnly({ state, actions }: JoinScreenProps) {
  const role = state.role!;
  return (
    <div>
      <h1 class="scr__title">{`${role.label} joins by invite`}</h1>
      <p class="scr__lede">
        A fleet office is set up by SeeBuyGet operations — vehicles, drivers and the operating bond are checked before the console
        opens. You will be given a sign-in code.
      </p>

      <Card title="What you get" tone="soft">
        <Checklist items={['A live map of your vehicles and drivers', 'Shift and cargo tracking', 'Your own vehicle and driver registry']} />
      </Card>

      <div class="scr__cta">
        <a class="btn btn--primary btn--full" href={role.app}>
          I have a code — open the fleet app
          <Icon name="chevronRight" size={20} class="btn__chev" />
        </a>
      </div>

      <Button variant="link" onClick={() => actions.go('roles')}>
        Pick something else
      </Button>
    </div>
  );
}

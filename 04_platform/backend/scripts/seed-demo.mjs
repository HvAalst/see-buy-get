/**
 * Demo world seeder — one command gives every SeeBuyGet PWA something real to show.
 *
 *   node scripts/seed-demo.mjs          (backend must be running on :3000)
 *
 * Idempotent where the world is durable (accounts, fleet, corridors are looked up
 * before they are created; wallets top up only when thin) and fresh where the demo
 * needs motion (a new batch of parcels per run, stamped so stickers never collide).
 * Ends by printing the credential sheet.
 *
 * Sandbox-only by construction: it uses the public phone-OTP echo and the ungated
 * operator mint, both of which die the moment GLOS_CLIENT_SECRET is configured.
 */
import { contentsDataUrl, documentDataUrl, roadDataUrl } from './seed-image.mjs';

const API = process.env.SBG_API ?? 'http://localhost:3000';
// The demo password. It was 'seebuyget' — the first thing anybody guessing would try, and refused now wherever a
// password is chosen. Accounts an earlier run made with it are moved to this one (`ensureAccount`).
const PASSWORD = 'seebuyget-demo';
const OLD_PASSWORD = 'seebuyget';
const stamp = Date.now().toString(36).slice(-5).toUpperCase();

const out = [];
const say = (s) => console.log(s);
const die = (s) => {
  console.error(`\nSEED FAILED: ${s}`);
  process.exit(1);
};

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * PUT MONEY IN THE WAY MONEY GETS IN — ask, then let the provider confirm it.
 *
 * A top-up used to BE the credit. It is not: asking moves nothing and the books wait for a payment
 * provider (money model, rule 5 — see foundation/funding). `op` is the operator token, because
 * standing in for the provider is a staff act, and in a live deployment it is the provider's own POST.
 */
async function fundVia(path, amount, tok, op) {
  const asked = need(await req('POST', path, { token: tok, body: { amount } }), 'ask to pay in');
  const providerRef = `MPX${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
  return need(
    await req('POST', `/v1/rails/funding/${asked.fundingId}/simulate`, { token: op, body: { providerRef, amount } }),
    'provider confirmation',
  );
}

/**
 * Upload a real image and return its media id, so a seeded document can actually be LOOKED at.
 *
 * Every photo in this world used to be a filename with no bytes behind it, which was invisible until
 * three console screens tried to show one. Returns undefined rather than throwing: a demo world that
 * cannot upload a picture should still come up, just without the pictures.
 */
async function uploadDoc(token, kind, sort, seed) {
  const r = await req('POST', '/v1/sbg/media', { token, body: { kind, dataUrl: documentDataUrl(sort, seed) } });
  if (!r.ok || !r.data?.mediaId) return undefined;
  return r.data.mediaId;
}

/**
 * Round 30 — the photo of a store order's contents, uploaded by the store as its own. The order door makes a store's
 * order only on a photo we hold, for that parcel alone, so each order uploads its own. Undefined when it cannot.
 */
async function uploadContents(token, seed, kind = 'content') {
  const r = await req('POST', '/v1/sbg/media', { token, body: { kind, dataUrl: contentsDataUrl(seed) } });
  if (!r.ok || !r.data?.mediaId) return undefined;
  return r.data.mediaId;
}

/** The same, for a picture of a ROAD — 'washout' (broken) or 'clear' (whole). Owned by whoever uploads it. */
async function uploadRoad(token, sort) {
  const r = await req('POST', '/v1/sbg/media', { token, body: { kind: 'hazard', dataUrl: roadDataUrl(sort) } });
  if (!r.ok || !r.data?.mediaId) return undefined;
  return r.data.mediaId;
}

const need = (r, what) => {
  if (!r.ok) die(`${what} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};

/**
 * Round 39 — A PARTNER SIGNS ITS SECURITY DECLARATION, from its own sign-in, as at joining: a shop, a hub and a fleet take
 * on nothing new without one in force. Signed here only when it asks for it — missing, lapsed, a new wording, or due.
 */
async function declare(token, label) {
  const mine = need(await req('GET', '/v1/sbg/declarations/mine', { token }), `declaration ${label}`);
  if (!mine.required || mine.state === 'signed') return;
  need(await req('POST', '/v1/sbg/declarations/mine/sign', { token, body: { version: mine.version, by: label } }), `sign ${label}`);
  say(`security declaration signed: ${label}`);
}

async function verifiedPhone() {
  const phone = `+2547${Math.floor(10000000 + Math.random() * 89999999)}`;
  const r1 = await req('POST', '/v1/sbg/auth/phone/request', { body: { phone } });
  const code = r1.data?.code ?? r1.data?.otp ?? r1.data?.verificationCode;
  need(await req('POST', '/v1/sbg/auth/phone/verify', { body: { phone, code } }), 'phone verify');
  return phone;
}

/**
 * A SHOP'S, A HUB'S OR A STORE'S SIGN-IN WORKS ONLY ON ITS OWN PHONES (2026-10-18; hubs and stores round 40): this machine is
 * confirmed by the code the sandbox hands back. One made before it had a number (an older sandbox's hub or store) gives one
 * first, as its holder would. Null when the answer was not that.
 */
async function confirmHere(answer, email) {
  if (answer.status !== 403 || answer.data?.code !== 'DEVICE_NOT_KNOWN') return null;
  let { challenge, code } = answer.data.params ?? {};
  if (answer.data.params?.needsPhone) {
    const given = need(await req('POST', '/v1/sbg/auth/device/phone', { body: { challenge, phone: await verifiedPhone() } }), `a number for ${email}`);
    ({ challenge, code } = given);
    say(`  (${email} had no phone number: it has one now)`);
  }
  if (!code) return null;
  return need(await req('POST', '/v1/sbg/auth/device', { body: { challenge, code } }), `confirm this machine for ${email}`);
}

/** Login with the fixed demo credentials, else sign the account up. */
async function ensureAccount(email, role, profile) {
  const login = await req('POST', '/v1/sbg/auth/login', { body: { email, password: PASSWORD } });
  if (login.ok) return login.data;
  const confirmed = await confirmHere(login, email);
  if (confirmed) return confirmed;
  // An account an earlier run made with the old demo password: it changes it, as its holder would.
  const moved = await req('POST', '/v1/sbg/auth/password', { body: { email, password: OLD_PASSWORD, newPassword: PASSWORD } });
  if (moved.ok) {
    say(`  (${email} moved to the new demo password)`);
    return need(await req('POST', '/v1/sbg/auth/login', { body: { email, password: PASSWORD } }), `login ${email}`);
  }
  const phone = await verifiedPhone();
  const r = await req('POST', '/v1/sbg/auth/signup', { body: { role, email, password: PASSWORD, phone, profile } });
  return need(r, `signup ${email}`);
}

const HOURS = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '07:30', close: '20:30' }]));

const agentProfile = (shopName, zone, landmark, lat, lng, price) => ({
  agent: {
    shopName,
    fullName: `${shopName} Keeper`,
    nationalId: `NID-${shopName.replace(/\s+/g, '')}`,
    mobile: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
    deviceImei: `IMEI-${shopName.replace(/\s+/g, '')}`,
    zone,
    landmark,
    location: { lat, lng },
    pricePerParcel: price,
    shelf: { rows: 4, cols: 5 },
    openingHours: HOURS,
    requirements: { androidVersion: 13, reliablePower: true, tradingLicence: `TL-${shopName.replace(/\s+/g, '')}`, criminalRecordClear: true },
  },
});

const run = async () => {
  say(`Seeding the demo world against ${API} (batch ${stamp})…\n`);

  /* ---------------------------------------------------------- operator ---- */
  const op = need(await req('POST', '/v1/auth/token', { body: { role: 'operator' } }), 'operator mint').access_token;

  // Two NAMED staff accounts: the two-person rules (a country switched on, a company's papers verified) are about
  // people, and the console can now show two real ones instead of two names typed beside one key.
  const STAFF_PASSWORD = 'seebuyget-staff';
  for (const [email, name] of [
    ['ops1@sbg.test', 'Amina Otieno'],
    ['ops2@sbg.test', 'Brian Kamau'],
  ]) {
    if ((await req('POST', '/v1/sbg/operators/login', { body: { email, password: STAFF_PASSWORD } })).ok) continue;
    const made = await req('POST', '/v1/sbg/operators', { token: op, body: { email, name } });
    if (!made.ok) {
      say(`  (staff account ${email} exists with a password this seeder did not set — left alone)`);
      continue;
    }
    need(await req('POST', '/v1/sbg/operators/password', { body: { email, password: made.data.temporaryPassword, newPassword: STAFF_PASSWORD } }), `staff password ${email}`);
    say(`staff account ${email} (${name}) created`);
  }

  /* ---------------------------------------------------------- corridors --- */
  const corridors = need(await req('GET', '/v1/sbg/corridors', { token: op }), 'corridors');
  for (const [o, d] of [
    ['Z-A', 'Z-B'],
    ['Z-B', 'Z-A'],
  ]) {
    if (!corridors.some((c) => c.originZone === o && c.destZone === d)) {
      need(await req('POST', '/v1/sbg/corridors', { token: op, body: { name: `${o} → ${d}`, originZone: o, destZone: d } }), `corridor ${o}→${d}`);
      say(`corridor ${o} → ${d} created`);
    }
  }

  /* ------------------------------------------------------------- shops ---- */
  const a1 = await ensureAccount('agent1@sbg.test', 'pudo', agentProfile('Mama Sarah Shop', 'Z-A', 'Blue gate, next to the market', -1.2864, 36.8172, 1.5));
  const a2 = await ensureAccount('agent2@sbg.test', 'pudo', agentProfile('Riverside Corner', 'Z-B', 'Next to the clinic', -1.3021, 36.8456, 1.2));
  const a3 = await ensureAccount('agent3@sbg.test', 'pudo', agentProfile('Downtown Kiosk', 'Z-B', 'Opposite the bus stage', -1.2899, 36.8219, 1.3));
  const tokA1 = a1.token.access_token;
  const tokA2 = a2.token.access_token;
  const tokA3 = a3.token.access_token;
  say(`shop  Mama Sarah Shop   ${a1.did}`);
  say(`shop  Riverside Corner  ${a2.did}`);
  say(`shop  Downtown Kiosk    ${a3.did}`);

  // Round 40 — the date each shop's trading licence runs to: a year ahead, and Riverside Corner's in twenty days, so its
  // home screen shows the notice a shop gets thirty days before.
  const licenceRunsTo = (label) => new Date(Date.now() + (label === 'Riverside Corner' ? 20 : 365) * 86_400_000).toISOString().slice(0, 10);

  // DRAFT → KYC_PENDING → APPROVED_UNFUNDED (wallet minted) → deposit → ACTIVE with money.
  for (const [did, tok, label] of [
    [a1.did, tokA1, 'Mama Sarah Shop'],
    [a2.did, tokA2, 'Riverside Corner'],
    [a3.did, tokA3, 'Downtown Kiosk'],
  ]) {
    const rec = need(await req('GET', `/v1/sbg/agents/${encodeURIComponent(did)}`, { token: tok }), 'agent read');
    if (rec.status === 'DRAFT' || rec.status === 'KYC_PENDING') {
      if (rec.status === 'DRAFT') {
        // Its papers are pictures the shop itself uploaded: a file name with nothing behind it is refused.
        const [idCopyRef, tradingLicenceRef, shopFront] = [await uploadDoc(tok, 'kyc_id', 'id', 1), await uploadDoc(tok, 'kyc_licence', 'licence', 2), await uploadDoc(tok, 'shop', 'shop', 3)];
        if (!idCopyRef || !tradingLicenceRef || !shopFront) die(`could not upload the papers of ${label}`);
        need(
          await req('POST', `/v1/sbg/agents/${encodeURIComponent(did)}/submit-kyc`, {
            token: tok,
            body: { idCopyRef, tradingLicenceRef, shopPhotoRefs: [shopFront] },
          }),
          `kyc ${label}`,
        );
      }
      need(await req('POST', `/v1/sbg/agents/${encodeURIComponent(did)}/kyc-decision`, { token: op, body: { approve: true, by: 'seed', licenceExpiresAt: licenceRunsTo(label) } }), `approve ${label}`);
      // The starter-kit deposit is recorded by the staff who hand over the kit, not by the shop.
      need(await req('POST', `/v1/sbg/agents/${encodeURIComponent(did)}/deposit`, { token: op }), `deposit ${label}`);
      say(`activated: ${label}`);
    }
    // Round 40 — a shop approved before its licence's date was asked gets one, as staff would note it.
    if (!need(await req('GET', `/v1/sbg/agents/${encodeURIComponent(did)}`, { token: tok }), 'agent read').licence) {
      need(await req('POST', `/v1/sbg/agents/${encodeURIComponent(did)}/licence`, { token: op, body: { expiresAt: licenceRunsTo(label), by: 'seed' } }), `licence ${label}`);
    }
    await declare(tok, label);
    const gate = need(await req('GET', `/v1/sbg/agents/${encodeURIComponent(did)}/can-transact`, { token: tok }), 'gate');
    if ((gate.balance ?? 0) < 20) {
      await fundVia(`/v1/sbg/agents/${encodeURIComponent(did)}/top-up`, 60, tok, op);
      say(`wallet funded (payment confirmed): ${label}`);
    }
  }

  /* --------------------------------------------------------------- hub ---- */
  const hub = await ensureAccount('hub@sbg.test', 'mdp', {
    mdp: { name: 'Central Sort', zones: ['Z-A', 'Z-B'], location: { lat: -1.295, lng: 36.83 }, pricePerParcel: 0.4 },
  });
  const tokHub = hub.token.access_token;
  const hubRow = need(await req('GET', '/v1/sbg/mdps', { token: tokHub }), 'mdps').find((m) => m.did === hub.did);
  if (!hubRow) die('hub row missing from /mdps');
  say(`hub   Central Sort      ${hubRow.mdpId}`);
  // A hub that signs itself up works once staff have seen its papers, as a shop does: it sends them, and staff approve.
  if (hubRow.vetting?.state !== 'approved') {
    if (hubRow.vetting?.state !== 'pending') {
      const [idCopyRef, licenceRef, premises] = [await uploadDoc(tokHub, 'kyc_id', 'id', 31), await uploadDoc(tokHub, 'kyc_licence', 'licence', 32), await uploadDoc(tokHub, 'shop', 'shop', 33)];
      need(await req('POST', `/v1/sbg/mdps/${encodeURIComponent(hubRow.mdpId)}/papers`, { token: tokHub, body: { idCopyRef, licenceRef, photoRefs: [premises] } }), 'hub papers');
    }
    need(await req('POST', `/v1/sbg/mdps/${encodeURIComponent(hubRow.mdpId)}/papers-decision`, { token: op, body: { approve: true } }), 'approve hub');
    say('hub   Central Sort      papers seen and approved');
  }

  await declare(tokHub, 'Central Sort');
  const hubTotes = need(await req('GET', `/v1/sbg/totes?location=${encodeURIComponent(hubRow.mdpId)}&status=`, { token: tokHub }), 'totes');
  for (let i = hubTotes.filter((t) => t.status === 'free').length; i < 2; i++) {
    need(await req('POST', `/v1/sbg/mdps/${encodeURIComponent(hubRow.mdpId)}/totes`, { token: tokHub }), 'hub tote');
  }

  /* ------------------------------------------------------------- fleet ---- */
  let mgr = need(await req('GET', '/v1/sbg/fleet/managers', { token: op }), 'managers').find((m) => m.companyName === 'Kilima Logistics');
  if (!mgr) {
    mgr = need(
      await req('POST', '/v1/sbg/fleet/managers', {
        token: op,
        body: {
          companyName: 'Kilima Logistics',
          contactPhone: '+254700000001',
          ownerFullName: 'Kilima Owner',
          ownerNationalId: 'NID-KILIMA',
          depotAddress: 'Enterprise Rd depot',
          requirements: { businessRegistrationNo: 'BR-KILIMA', transportOperatorLicence: 'TOL-KILIMA', taxId: 'TAX-KILIMA' },
        },
      }),
      'manager register',
    );
    // Its papers are pictures the member of staff setting it up put on record: a file name is refused.
    const [businessRegCertRef, operatorLicenceRef, ownerIdRef, proofOfAddressRef] = [
      await uploadDoc(op, 'kyc_registration', 'licence', 21),
      await uploadDoc(op, 'kyc_licence', 'licence', 22),
      await uploadDoc(op, 'kyc_id', 'id', 23),
      await uploadDoc(op, 'kyc_address', 'licence', 24),
    ];
    if (!businessRegCertRef || !operatorLicenceRef || !ownerIdRef || !proofOfAddressRef) die('could not upload the fleet’s papers');
    need(
      await req('POST', `/v1/sbg/fleet/managers/${mgr.did}/submit-kyc`, {
        token: op,
        body: { businessRegCertRef, operatorLicenceRef, ownerIdRef, proofOfAddressRef },
      }),
      'manager kyc',
    );
    need(await req('POST', `/v1/sbg/fleet/managers/${mgr.did}/kyc-decision`, { token: op, body: { approve: true, by: 'seed' } }), 'manager decide');
    mgr = need(await req('POST', `/v1/sbg/fleet/managers/${mgr.did}/bond`, { token: op, body: {} }), 'manager bond');
  }
  const fleetCode = mgr.loginCode ?? need(await req('GET', `/v1/sbg/fleet/managers/${mgr.did}`, { token: op }), 'manager read').loginCode;
  const fm = need(
    await req('POST', '/v1/auth/token', { body: { role: 'fleet_manager', did: mgr.did, tenant: mgr.did, type: 'client_credentials' } }),
    'fleet mint',
  ).access_token;
  // The fleet signs for its drivers: Amos, Grace and Peter sign nothing of their own.
  await declare(fm, 'Kilima Logistics');
  // The manager as a PERSON, with a PIN. The company code names the fleet; the PIN is what actually
  // signs somebody in, so a seeded fleet with no person behind it is a console nobody can open.
  const MGR_PIN = '24689';
  {
    const r1 = await req('POST', '/v1/sbg/auth/phone/request', { body: { phone: mgr.contactPhone } });
    const otp = r1.data?.code ?? r1.data?.otp ?? r1.data?.verificationCode;
    if (otp) await req('POST', '/v1/sbg/auth/phone/verify', { body: { phone: mgr.contactPhone, code: otp } });
    // A PIN is chosen with a confirmed recovery email behind it (the sandbox echoes the code it would mail).
    const mgrEmail = 'kilima.manager@sbg.test';
    const mgrCode = (await req('POST', '/v1/sbg/identity/email/request', { body: { email: mgrEmail } })).data?.code;
    const enrolled = await req('POST', '/v1/sbg/identity/enroll', { body: { phone: mgr.contactPhone, pin: MGR_PIN, email: mgrEmail, emailCode: mgrCode } });
    if (!enrolled.ok) {
      // Already enrolled from an earlier run — that is the idempotent case, not a failure.
      say(`  (fleet manager person already enrolled: ${mgr.contactPhone})`);
    }
  }
  say(`fleet Kilima Logistics   company code ${fleetCode} · manager ${mgr.contactPhone} PIN ${MGR_PIN}`);

  // WHERE THEY ARE PAID (the user, 2026-10-18): in Kenya, an M-Pesa number the payee set and confirmed with a code.
  // Set once for the demo's payees as each would in Settings (a sandbox hands the code back); a number that is there stays.
  const ensurePayoutNumber = async (token, number, label) => {
    const now = await req('GET', '/v1/sbg/payout-number', { token });
    if (!now.ok || now.data?.way !== 'mpesa' || now.data?.masked) return;
    const sent = await req('POST', '/v1/sbg/payout-number/code', { token, body: { phone: number } });
    if (!sent.ok || !sent.data?.code) return say(`  (no payout number for ${label}: ${sent.data?.detail ?? sent.status})`);
    need(await req('POST', '/v1/sbg/payout-number', { token, body: { code: sent.data.code } }), `payout number ${label}`);
    say(`payout number ${label}: ${sent.data.masked}`);
  };
  await ensurePayoutNumber(fm, '0700 000 101', 'Kilima Logistics');
  await ensurePayoutNumber(tokHub, '0700 000 102', 'Central Sort');

  const vehicles = need(await req('GET', '/v1/sbg/vehicles?status=&class=', { token: fm }), 'vehicles');
  const ensureVehicle = async (plate, vehicleClass, pricePerKm) => {
    const have = vehicles.find((v) => v.plate === plate);
    if (have) return have;
    return need(
      await req('POST', '/v1/sbg/vehicles', {
        token: fm,
        body: { plate, vehicleClass, ownerName: 'Kilima Owner', ownerType: 'fleet_owned', managerDid: mgr.did, pricePerKm },
      }),
      `vehicle ${plate}`,
    );
  };
  const van = await ensureVehicle('KLM 001V', 'van', 0.32);
  const bike = await ensureVehicle('KLM 002B', 'bike', 0.5);

  const drivers = need(await req('GET', '/v1/sbg/fleet/drivers', { token: fm }), 'drivers');
  let amos = drivers.find((d) => d.displayName === 'Amos K.');
  if (!amos) {
    amos = need(
      await req('POST', '/v1/sbg/drivers/onboard', {
        token: fm,
        body: {
          displayName: 'Amos K.',
          fullName: 'Amos Kariuki',
          nationalId: 'NID-AMOS',
          mobile: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
          licenceClasses: ['bike'],
          managerDid: mgr.did,
        },
      }),
      'driver amos',
    );
  }
  /*
   * Every driver signs in the way a driver does: the phone the fleet registered, and a PIN.
   *
   * Written once because there are three of them now, and because a seeded driver with no way to sign in
   * is not a driver in this world — the uploads a haul needs are checked against the OWNER of the photo,
   * so the fleet's token cannot stand in for the person who took it. The phone is the one in the DID's
   * controller (`pudo-driver:<mobile>`): on a re-seed the driver already exists and nobody printed it. Staff read
   * the controller on a route of their own; the public one never carries a phone number.
   */
  const DRIVER_PIN = '13570';
  const signInDriver = async (driver, label) => {
    const phone = (need(await req('GET', `/v1/did/${encodeURIComponent(driver.did)}/controller`, { token: op }), `${label} did`).controller ?? '').replace(/^pudo-driver:/, '');
    // A PIN IS LOOKED AT ONLY ON A DEVICE A CODE TO THE PHONE CONFIRMED, and this script is a device like any other:
    // it asks for the code (echoed in a sandbox), types it, and is handed the key the PIN is then asked with. That also
    // sets the demo PIN afresh each run — which is what moves a sandbox seeded with the old four-digit PINs to five.
    const r1 = await req('POST', '/v1/sbg/auth/phone/request', { body: { phone } });
    if (!r1.ok) die(`a code to ${label}'s phone was refused (${r1.status} ${JSON.stringify(r1.data)}) — a number is sent one code a minute: wait a minute between two seeds`);
    need(await req('POST', '/v1/sbg/auth/phone/verify', { body: { phone, code: r1.data?.code } }), `${label} phone code`);
    const email = `${label}.driver@sbg.test`;
    const e1 = await req('POST', '/v1/sbg/identity/email/request', { body: { email } });
    const enrolled = need(await req('POST', '/v1/sbg/identity/enroll', { body: { phone, pin: DRIVER_PIN, email, emailCode: e1.data?.code } }), `${label} PIN`);
    const session = need(await req('POST', '/v1/sbg/drivers/session', { body: { phone, pin: DRIVER_PIN, device: enrolled.device } }), `${label} sign-in`);
    return { phone, token: session.token?.access_token };
  };
  const amosIn = await signInDriver(amos, 'amos');
  const amosToken = amosIn.token;
  // What Amos's phone shows a counter: his badge and the code of the shift he is on, read from his own session as the
  // driver app reads it. His badge NUMBER alone hands over nothing (the user, 2026-10-15).
  const amosPass = async () => need(await req('GET', `/v1/sbg/fleet/drivers/${encodeURIComponent(amos.did)}/session`, { token: amosToken }), 'Amos’s badge').handoverPass;
  say(`driver Amos K.   phone ${amosIn.phone} PIN ${DRIVER_PIN}`);

  let grace = drivers.find((d) => d.displayName === 'Grace M.');
  if (!grace) {
    grace = need(
      await req('POST', '/v1/sbg/drivers/onboard', {
        token: fm,
        body: {
          displayName: 'Grace M.',
          fullName: 'Grace Mwangi',
          nationalId: 'NID-GRACE',
          mobile: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
          licenceClasses: ['van'],
          managerDid: mgr.did,
          licenceNumber: 'DL-GRACE-1',
          licenceExpiresAt: new Date(Date.now() + 400 * 86400e3).toISOString(),
          criminalRecordClear: true,
        },
      }),
      'driver grace',
    );
  }

  /*
   * Papers in → KYC_PENDING; the decision stays with GLOS ops so the fleet app shows "GLOS checking".
   *
   * REAL UPLOADS, not filenames. These were 'grace-id.jpg' and 'grace-licence.jpg' with no bytes anywhere,
   * so the driver sat in the vetting queue holding two documents nobody could open — and when the vetting
   * screen was finally built there was still nothing for it to show.
   *
   * REPAIRED RATHER THAN ONLY SEEDED, and this is the part that matters on a long-lived sandbox: Grace
   * already existed from an earlier run, so a fix applied only inside `if (!grace)` changed nothing at all
   * and the drive said so. A ref that is not a `med_…` id is a placeholder, and a placeholder is repaired
   * by refusing the old papers (which is now possible, with a reason, and sends her back to DRAFT) and
   * submitting a real pair.
   */
  {
    const fresh = need(await req('GET', `/v1/sbg/fleet/drivers/${encodeURIComponent(grace.did)}`, { token: fm }), 'grace').driver ?? {};
    const real = (ref) => typeof ref === 'string' && ref.startsWith('med_');
    if (!real(fresh.kyc?.licenceCopyRef) || !real(fresh.kyc?.idCopyRef)) {
      if (fresh.status === 'KYC_PENDING') {
        await req('POST', `/v1/sbg/fleet/drivers/${encodeURIComponent(grace.did)}/kyc-decision`, {
          token: op,
          body: { approve: false, reason: 'Re-seeding the demo world with documents that can actually be opened.' },
        });
      }
      const graceLicence = await uploadDoc(fm, 'kyc_licence', 'licence', 1);
      const graceId = await uploadDoc(fm, 'kyc_id', 'id', 4);
      await req('POST', `/v1/sbg/fleet/drivers/${encodeURIComponent(grace.did)}/submit-kyc`, {
        token: fm,
        body: { idCopyRef: graceId ?? 'grace-id.jpg', licenceCopyRef: graceLicence ?? 'grace-licence.jpg' },
      });
    }
  }
  say(`drivers Amos K. (badge ${amos.badgeId ?? '—'}) · Grace M. (papers with GLOS)`);

  /*
   * THE ROAD, AS TWO DRIVERS REPORT IT — with a photograph on each side of the argument.
   *
   * Seeded because this is the one feature that cannot be judged from a single account: a hazard photo
   * is read by the NEXT driver down that road, so the demo needs two people who have never met
   * disagreeing about one culvert, each with a picture. Grace gets a PIN here for the same reason —
   * signing in as the second driver is how anybody checks that the first driver's photograph is visible.
   *
   * IDEMPOTENT by position: a re-run finds the washout already standing and leaves it alone rather than
   * drawing a second one 40 m up the same road.
   */
  // Named out here because the sign-in sheet prints it at the end: both drivers are credentials now.
  const graceIn = await signInDriver(grace, 'grace');
  say(`driver Grace M.  phone ${graceIn.phone} PIN ${DRIVER_PIN}`);
  {
    const graceToken = graceIn.token;

    // On the straight line between Nairobi and Nakuru, so it is on the corridor the demo actually runs.
    const spot = { lat: -0.7935, lng: 36.4503 };
    const standing = (await req('GET', `/v1/sbg/route-constraints?lat=${spot.lat}&lng=${spot.lng}&radiusKm=1`, { token: op })).data?.items ?? [];
    if (!standing.some((c) => c.kind === 'WASHOUT') && amosToken && graceToken) {
      const seen = await uploadRoad(amosToken, 'washout');
      const rep = await req('POST', '/v1/sbg/route-constraints', {
        token: amosToken,
        body: { kind: 'WASHOUT', at: spot, note: 'Culvert went in the night rain — the whole lane is out', ...(seen ? { photoRef: seen } : {}) },
      });
      const id = rep.data?.constraintId;
      // And the answer to it, which is what makes this worth looking at: a second driver, a second photo,
      // and a hazard that goes on warning anyway until an operator decides.
      const answer = await uploadRoad(graceToken, 'clear');
      if (id) {
        await req('POST', `/v1/sbg/route-constraints/${id}/refute`, {
          token: graceToken,
          body: { note: 'Graded yesterday — I came through at six this morning', ...(answer ? { photoRef: answer } : {}) },
        });
      }
      say('road       one disputed washout on the Nakuru line, a photo on each side');
    }
  }

  // Handover resolves the badge only for a COUPLED driver on a corridor — put Amos on shift.
  const corridorZAB = need(await req('GET', '/v1/sbg/corridors', { token: op }), 'corridors').find(
    (c) => c.originZone === 'Z-A' && c.destZone === 'Z-B',
  );
  const assignments = need(await req('GET', '/v1/sbg/fleet/assignments?status=active', { token: fm }), 'assignments');
  if (!assignments.some((x) => x.driverDid === amos.did)) {
    need(
      await req('POST', `/v1/sbg/fleet/drivers/${encodeURIComponent(amos.did)}/start-session`, {
        token: amosToken,
        body: { vehicleId: bike.vehicleId, pin: DRIVER_PIN },
      }),
      'amos starts his shift',
    );
    need(
      await req('POST', `/v1/sbg/fleet/drivers/${encodeURIComponent(amos.did)}/assign-corridor`, { token: fm, body: { corridorId: corridorZAB.corridorId } }),
      'corridor for amos',
    );
    say(`Amos coupled to ${bike.plate} on ${corridorZAB.name}`);
  }
  void van;

  /* ------------------------------------------------------------ parcels --- */
  const accept = async (n, opts = {}) => {
    const id = `DEMO-${stamp}-${n}`;
    // Round 31 — the shop's own photo of the parcel it takes in, uploaded first: a name is refused now.
    const dropoffPhotoRef = await uploadContents(tokA1, 20 + n, 'dropoff');
    const p = need(
      await req('POST', '/v1/sbg/parcels/accept', {
        token: tokA1,
        body: {
          agentDid: a1.did,
          parcelId: id,
          size: opts.size ?? 'M',
          destZone: 'Z-B',
          destPudoDid: a2.did,
          senderMobile: '+254700100100',
          receiverMobile: '+254700200200',
          dropoffPhotoRef,
        },
      }),
      `accept ${id}`,
    );
    return p;
  };

  // S25 completeness gate: the bus takes ONE parcel and knowingly leaves the rest, which is exactly the
  // acknowledgement a real shopkeeper gives when a load will not fit.
  //
  // It used to rely on the shelf being empty — hand p3 over while it is the only parcel waiting for that
  // corridor, and accept p1/p2 afterwards. True on a virgin store and false on every re-run after it: the
  // shelf accumulates, the gate rightly refuses a short load, and the seed died at this line with 28
  // parcels listed. A seeder that only works once is a seeder you cannot use to reproduce anything.
  const p3 = await accept(3);
  need(
    await req('POST', '/v1/sbg/parcels/handover', {
      token: tokA1,
      body: { agentDid: a1.did, driverBadgeId: await amosPass(), parcelIds: [p3.parcelId], acknowledgeShortShip: true, shortShipReason: 'demo seed — the bus takes one parcel' },
    }),
    'handover p3',
  );
  say(`parcel on the bus with Amos: ${p3.parcelId} (track ${p3.trackingKey})`);

  const p6 = await accept(6, { size: 'L' });
  need(
    await req('POST', '/v1/sbg/parcels/handover', {
      token: tokA1,
      body: { agentDid: a1.did, driverBadgeId: await amosPass(), parcelIds: [p6.parcelId], acknowledgeShortShip: true, shortShipReason: 'demo seed — the bus takes one parcel' },
    }),
    'handover p6',
  );
  need(
    await req('POST', `/v1/sbg/parcels/${encodeURIComponent(p6.parcelId)}/arrive`, { token: tokA2, body: { destAgentDid: a2.did } }),
    'arrive p6',
  );
  const p6Now = need(await req('GET', `/v1/sbg/parcels/${encodeURIComponent(p6.parcelId)}`, { token: tokA2 }), 'read p6');
  // The pickup code comes from the ACCEPT response — it is minted with the parcel and given to the sender.
  // Arrival no longer returns it (the shop that hands the parcel over must not know it), so this sheet is
  // standing in for the sender, who would have passed it to whoever is collecting.
  const p6Code = p6.otp;
  say(`parcel ready to collect at Riverside: ${p6.parcelId} — pickup code ${p6Code}${p6Now.binSlot ? ` · shelf ${p6Now.binSlot}` : ''}`);

  // Now the two parcels that sit waiting at the shop — accepted AFTER the handovers so the gate is happy.
  const p1 = await accept(1);
  const p2 = await accept(2, { size: 'S' });
  say(`parcels waiting for the bus at Mama Sarah: ${p1.parcelId}, ${p2.parcelId}`);

  /* The demo shop keeps more bag bays than a two-bay default.
   *
   * Each run opens a bag at Mama Sarah, and a run that dies partway leaves it half-filled on the floor.
   * Two of those and the next run cannot open one at all — STAGING_FULL, which is a real shop constraint
   * doing its job against a seeder that never tidies up. Room for ten is an honest setting for a shop
   * this busy, and it costs the demo nothing. */
  await req('POST', `/v1/sbg/agents/${encodeURIComponent(a1.did)}/bag-bays`, { token: tokA1, body: { bays: 10 } });

  /* Amos finishes yesterday's run before starting today's.
   *
   * A bike holds one bag, and the capacity check enforces that properly now — so the bag this seeder
   * deliberately leaves ON the bike at the end of a run is still there at the start of the next one, and
   * the hub leg below died with CAPACITY_EXCEEDED. That is the guard doing its job and the seeder
   * pretending yesterday never happened. He drops it at the hub, which is where it was going. */
  {
    const carrying = need(await req('GET', '/v1/sbg/fleet/dashboard', { token: fm }), 'fleet before the tote leg');
    for (const item of carrying.cargo?.items ?? []) {
      if (item.kind !== 'tote') continue;
      const dropped = await req('POST', `/v1/sbg/mdps/${encodeURIComponent(hubRow.mdpId)}/drop-bag`, { token: tokHub, body: { code: item.ref } });
      say(dropped.ok ? `yesterday's bag ${item.ref} delivered to the hub` : `  (could not drop ${item.ref}: ${dropped.status})`);
    }
  }

  /* Tote leg → hub floor content: two parcels bagged at the shop, bussed, dropped at the hub. */
  const p4 = await accept(4);
  const p5 = await accept(5, { size: 'S' });
  const bag = need(await req('POST', `/v1/sbg/agents/${encodeURIComponent(a1.did)}/totes`, { token: tokA1 }), 'shop tote');
  need(
    await req('POST', `/v1/sbg/totes/${encodeURIComponent(bag.code)}/assign`, {
      token: tokA1,
      body: { destinationNodeId: hubRow.mdpId, destinationLabel: 'Central Sort' },
    }),
    'assign bag',
  );
  for (const p of [p4, p5]) {
    need(await req('POST', `/v1/sbg/totes/${encodeURIComponent(bag.code)}/fill`, { token: tokA1, body: { parcelId: p.parcelId } }), `fill ${p.parcelId}`);
  }
  // Rounds 36–37: a bag leaves closed (here photographed closed), the driver carrying it reads it as closed, and the hub
  // receives it on a photograph before it opens it — each photograph its taker's own.
  need(await req('POST', `/v1/sbg/totes/${encodeURIComponent(bag.code)}/close`, { token: tokA1, body: { photoRef: await uploadDoc(tokA1, 'seal', 'shop', 41) } }), 'close bag');
  need(await req('POST', `/v1/sbg/totes/${encodeURIComponent(bag.code)}/load`, { token: tokA1, body: { driverBadgeId: await amosPass() } }), 'load bag');
  need(await req('POST', `/v1/sbg/totes/${encodeURIComponent(bag.code)}/take`, { token: amosToken, body: { photoRef: await uploadDoc(amosToken, 'seal', 'shop', 42), asClosed: true } }), 'Amos reads the bag');
  need(
    await req('POST', `/v1/sbg/mdps/${encodeURIComponent(hubRow.mdpId)}/drop-bag`, { token: tokHub, body: { code: bag.code, receipt: { photoRef: await uploadDoc(tokHub, 'seal', 'shop', 43), asClosed: true } } }),
    'drop bag',
  );
  const sorted = need(
    await req('POST', `/v1/sbg/mdps/${encodeURIComponent(hubRow.mdpId)}/sort`, { token: tokHub, body: { parcelId: p5.parcelId } }),
    'sort p5',
  );
  say(`hub floor: ${p4.parcelId} waiting to sort · ${p5.parcelId} sorted into ${sorted.toteCode} → ${sorted.nextDestination.label}`);

  /* ------------------------------------------------------------- vendor --- */
  const VENDOR_SECRET = 'whsec_demo_nairobi_threads';
  // A store signs in with its own email and password; its secret is for its systems.
  const STORE_EMAIL = 'store@sbg.test';
  let shop = need(await req('GET', '/v1/sbg/vendors', { token: op }), 'vendors').find((v) => v.name === 'Nairobi Threads');
  if (!shop) {
    shop = need(
      await req('POST', '/v1/sbg/vendors', {
        body: {
          name: 'Nairobi Threads',
          country: 'KE',
          address: 'Biashara St 12',
          location: { lat: -1.284, lng: 36.824 },
          secret: VENDOR_SECRET,
          email: STORE_EMAIL,
          password: PASSWORD,
          // Round 40 — a store's number is verified by its code, as a shop's and a hub's are.
          ownerPhone: await verifiedPhone(),
        },
      }),
      'vendor register',
    );
  }
  // Round 40 — the store's sign-in works only on its own phones: this machine is confirmed by the sandbox's code.
  const storeSession = async () => {
    const answer = await req('POST', '/v1/sbg/vendors/session', { body: { email: STORE_EMAIL, password: PASSWORD } });
    const confirmed = await confirmHere(answer, STORE_EMAIL);
    return confirmed ? { ok: true, status: 201, data: confirmed } : answer;
  };
  let storeIn = await storeSession();
  if (!storeIn.ok) {
    // A demo store from before stores had accounts: in by its secret one last time, and it sets its account up.
    const old = need(await req('POST', '/v1/sbg/vendors/login', { body: { vendorId: shop.vendorId, secret: VENDOR_SECRET } }), 'vendor login (by secret)');
    need(await req('POST', `/v1/sbg/vendors/${shop.vendorId}/account`, { token: old.token.access_token, body: { email: STORE_EMAIL, password: PASSWORD } }), 'store account');
    say(`  (the demo store now signs in as ${STORE_EMAIL})`);
    storeIn = await storeSession();
  }
  const vLogin = need(storeIn, 'store sign-in');
  const tokV = vLogin.token.access_token;

  // Enough float for the WHOLE run, not enough to look plausible. This run mints about fifty shipments —
  // two demo orders plus the 44-row register history — and each one is billed at mint. Topping up 120
  // when the balance dips under 40 covered the first run and starved every one after it: the float drained
  // faster than the threshold refilled it, and the seed died at an intake with SHIPMENT_NOT_PAID.
  if ((vLogin.balance ?? 0) < 300) {
    await fundVia(`/v1/sbg/vendors/${shop.vendorId}/top-up`, 600, tokV, op);
    say(`vendor balance topped up: Nairobi Threads (was ${(vLogin.balance ?? 0).toFixed(2)})`);
  }

  // Two buyer checkouts waiting to ship (the console's inbox) + one order minted end-to-end.
  for (const [ref, email, items, subtotal] of [
    [`SO-${stamp}-A`, 'amina@example.com', [{ name: 'Ankara shirt', qty: 2 }], 38],
    [`SO-${stamp}-B`, 'brian@example.com', [{ name: 'Kitenge scarf', qty: 1 }], 14],
  ]) {
    need(
      await req('POST', `/v1/sbg/vendors/${shop.vendorId}/checkout`, {
        token: tokV,
        body: { destPudoDid: a2.did, buyerEmail: email, buyerMobile: '+254700300300', externalOrderId: ref, items, subtotal, source: 'node' },
      }),
      `checkout ${ref}`,
    );
  }
  const minted = need(
    await req('POST', '/v1/sbg/inbound/orders', {
      token: tokV,
      body: {
        vendorId: shop.vendorId,
        originPudoDid: a1.did,
        destPudoDid: a2.did,
        buyerMobile: '+254700400400',
        buyerEmail: 'clara@example.com',
        externalOrderId: `SO-${stamp}-C`,
        dimensionsCm: { l: 30, w: 20, h: 10 },
        weightKg: 1.6,
        contentPhotoRef: await uploadContents(tokV, 3),
        routeMode: 'locked',
        items: [{ name: 'Denim jacket', qty: 1 }],
        subtotal: 55,
      },
    }),
    'vendor mint',
  );
  need(await req('POST', `/v1/sbg/parcels/${encodeURIComponent(minted.parcel.parcelId)}/intake`, { token: tokA1, body: {} }), 'intake minted');
  say(
    `vendor Nairobi Threads: 2 checkouts waiting · ${minted.parcel.parcelId} minted (${minted.paid ? 'paid' : 'UNPAID'}), at the drop-off shop`,
  );

  /* ---- a rich shipment HISTORY so the register (search / filter / paginate / multi-select / export)
   *      has real volume: varied products, buyers, two collection PUDOs, sizes, and a paid/unpaid +
   *      status spread. Kept resilient — a per-parcel failure is skipped, never fatal. -------------- */
  const PRODUCTS = [
    [{ name: 'Ankara shirt', qty: 2 }],
    [{ name: 'Kitenge dress', qty: 1 }],
    [{ name: 'Maasai sandals', qty: 1 }, { name: 'Beaded necklace', qty: 2 }],
    [{ name: 'Denim jacket', qty: 1 }],
    [{ name: 'Leather satchel', qty: 1 }],
    [{ name: 'Cotton kanga', qty: 3 }],
    [{ name: 'Silk headwrap', qty: 2 }],
    [{ name: 'Woven basket', qty: 1 }],
    [{ name: 'Canvas tote bag', qty: 2 }],
    [{ name: 'Wool blanket', qty: 1 }],
  ];
  const BUYERS = [
    ['amina', '+254700310001'], ['brian', '+254700310002'], ['clara', '+254700310003'],
    ['david', '+254700310004'], ['esther', '+254700310005'], ['felix', '+254700310006'],
    ['grace', '+254700310007'], ['hassan', '+254700310008'], ['irene', '+254700310009'], ['james', '+254700310010'],
  ];
  const DESTS = [a2.did, a3.did]; // Riverside Corner · Downtown Kiosk — gives the per-PUDO filter two values
  const SIZES = [['S', { l: 18, w: 12, h: 6 }, 0.4], ['M', { l: 30, w: 20, h: 10 }, 1.6], ['L', { l: 45, w: 32, h: 22 }, 6.0]];

  const history = [];
  const HISTORY_N = 44; // > 2 pages at 20/page
  for (let i = 0; i < HISTORY_N; i++) {
    const [firstname, mobile] = BUYERS[i % BUYERS.length];
    const [size, dims, kg] = SIZES[i % SIZES.length];
    const ref = `SO-${stamp}-${String(i + 10).padStart(3, '0')}`;
    void size;
    const r = await req('POST', '/v1/sbg/inbound/orders', {
      token: tokV,
      body: {
        vendorId: shop.vendorId,
        originPudoDid: a1.did,
        destPudoDid: DESTS[i % DESTS.length],
        buyerMobile: mobile,
        buyerEmail: `${firstname}@example.com`,
        externalOrderId: ref,
        dimensionsCm: dims,
        weightKg: kg,
        contentPhotoRef: await uploadContents(tokV, i + 10),
        routeMode: i % 3 === 0 ? 'flexible' : 'locked',
        items: PRODUCTS[i % PRODUCTS.length],
        subtotal: 20 + (i % 7) * 8,
      },
    });
    if (!r.ok || !r.data?.parcel) continue; // a rare diverted/blocked mint is simply skipped in the demo
    history.push({ parcelId: r.data.parcel.parcelId, paid: Boolean(r.data.paid) });
  }
  say(`vendor history: minted ${history.length}/${HISTORY_N} shipments`);

  // Fund the store, then settle HALF of the still-unpaid ones so the Paid filter has both sides to show.
  await fundVia(`/v1/sbg/vendors/${shop.vendorId}/top-up`, 3000, tokV, op);
  const unpaidOnes = history.filter((h) => !h.paid);
  for (let k = 0; k < Math.floor(unpaidOnes.length / 2); k++) {
    const s = await req('POST', `/v1/sbg/parcels/${encodeURIComponent(unpaidOnes[k].parcelId)}/settle`, { token: tokV });
    if (s.ok) unpaidOnes[k].paid = true;
  }

  // Spread the statuses: intake ~70% (→ At the drop-off shop / At_PUDO), void a few of those, leave the rest Created.
  let intook = 0;
  let voided = 0;
  for (let i = 0; i < history.length; i++) {
    if (i % 10 >= 7) continue; // ~30% stay Created
    const h = history[i];
    const t = await req('POST', `/v1/sbg/parcels/${encodeURIComponent(h.parcelId)}/intake`, { token: tokA1, body: {} });
    if (!t.ok) continue;
    intook++;
    if (voided < 4 && i % 10 === 6) {
      const v = await req('POST', `/v1/sbg/parcels/${encodeURIComponent(h.parcelId)}/void`, {
        token: tokA1,
        body: { agentDid: a1.did, voidedPhotoRef: await uploadDoc(tokA1, 'dropoff', 'pod', 40 + i) },
      });
      if (v.ok) {
        voided++;
        intook--;
      }
    }
  }
  const paidNow = history.filter((h) => h.paid).length;
  say(`vendor history: ${paidNow} paid / ${history.length - paidNow} unpaid · ${intook} at the shop · ${voided} voided · rest created`);

  /* ----------------------------------------------------- fleet in motion --- */
  /**
   * Put the fleet ON THE ROAD, which nothing before this did.
   *
   * Every other app got a world with something in it, and the fleet manager got two vehicles, two
   * drivers and an empty screen: no shift, no cargo, no position, no map pins. The coupling above exists
   * to make ONE handover resolve a badge — it is a means to a parcel, and it ends. A manager's whole app
   * is the live picture, so a seed that never starts a shift seeds every app but theirs.
   *
   * Idempotent like the rest: a driver already on shift is left where they are, because re-coupling
   * would end a session this run had nothing to do with.
   *
   * THE DRIVER STARTS IT, from their own sign-in and with their PIN; the office only says where they run. This
   * asked the office to do both (`couple`) long after that route was gone, and said only "could not" when it failed.
   */
  const live = need(await req('GET', '/v1/sbg/fleet/assignments?status=active', { token: fm }), 'active assignments');
  const startShift = async (driver, driverToken, vehicle, corridorId) => {
    const path = (tail) => `/v1/sbg/fleet/drivers/${encodeURIComponent(driver.did)}/${tail}`;
    const started = await req('POST', path('start-session'), { token: driverToken, body: { vehicleId: vehicle.vehicleId, pin: DRIVER_PIN } });
    if (!started.ok) return started;
    return corridorId ? req('POST', path('assign-corridor'), { token: fm, body: { corridorId } }) : started;
  };
  const onShift = async (driver, driverToken, vehicle, corridorId) => {
    if (live.some((x) => x.driverDid === driver.did)) return;
    const r = await startShift(driver, driverToken, vehicle, corridorId);
    if (!r.ok) say(`  (could not put ${driver.displayName} on ${vehicle.plate}: ${r.status} ${JSON.stringify(r.data).slice(0, 160)})`);
  };
  await onShift(amos, amosToken, bike, corridorZAB?.corridorId);
  // Grace is the KYC_PENDING half of the pair on purpose — she is what a manager chasing paperwork looks
  // like — so she is put on the van only once her papers actually clear.
  const graceNow = need(await req('GET', '/v1/sbg/fleet/drivers', { token: fm }), 'drivers again').find((d) => d.displayName === 'Grace M.');
  if (graceNow?.status === 'ACTIVE') await onShift(graceNow, graceIn.token, van);

  // A BAG THAT IS STILL ON THE BIKE. The tote leg above loads one onto Amos and drops it at the hub in
  // the same breath, which is right for the hub demo and leaves the fleet manager watching an empty
  // vehicle: "cargo in motion" counts totes a driver is holding, so cargo that has already arrived is
  // cargo nobody is carrying. This one is loaded and deliberately never dropped.
  // Only if the bike is empty. A bike holds one bag, and the capacity check enforces that properly now —
  // so a second run that blindly loaded another died with CAPACITY_EXCEEDED, which is the guard working
  // and the seeder being wrong. Asking what is already aboard is the idempotent question.
  const aboard = need(await req('GET', '/v1/sbg/fleet/dashboard', { token: fm }), 'fleet before loading');
  if ((aboard.cargo?.count ?? 0) === 0) {
    const p7 = await accept(7);
    const p8 = await accept(8, { size: 'S' });
    const rolling = need(await req('POST', `/v1/sbg/agents/${encodeURIComponent(a1.did)}/totes`, { token: tokA1 }), 'rolling tote');
    need(
      await req('POST', `/v1/sbg/totes/${encodeURIComponent(rolling.code)}/assign`, {
        token: tokA1,
        body: { destinationNodeId: hubRow.mdpId, destinationLabel: 'Central Sort' },
      }),
      'assign rolling bag',
    );
    for (const p of [p7, p8]) {
      need(await req('POST', `/v1/sbg/totes/${encodeURIComponent(rolling.code)}/fill`, { token: tokA1, body: { parcelId: p.parcelId } }), `fill ${p.parcelId}`);
    }
    const loaded = await req('POST', `/v1/sbg/totes/${encodeURIComponent(rolling.code)}/load`, { token: tokA1, body: { driverBadgeId: await amosPass() } });
    say(loaded.ok ? `bag ${rolling.code} is on ${bike.plate} with Amos, still rolling` : `  (could not load ${rolling.code}: ${loaded.status})`);
  }

  // A GPS heartbeat each, so the live map has something on it. Positions ON THE ROAD between the shops
  // rather than at them: a dot sitting exactly on a shop is indistinguishable from a dot that has not
  // moved, and the one thing this map exists to show is movement.
  // A position is a claim about the driver's own phone, so the fleet office may not post one; the seed
  // stands in as network staff, the only other caller the route accepts.
  const heartbeat = async (driver, lat, lng) => {
    if (!driver) return;
    await req('POST', `/v1/sbg/fleet/drivers/${encodeURIComponent(driver.did)}/locate`, { token: op, body: { lat, lng } });
  };
  await heartbeat(amos, -1.2942, 36.8331); // between Mama Sarah (Z-A) and Riverside (Z-B)
  await heartbeat(graceNow?.status === 'ACTIVE' ? graceNow : null, -1.2881, 36.8198); // near Downtown Kiosk

  const fleetNow = need(await req('GET', '/v1/sbg/fleet/dashboard', { token: fm }), 'fleet dashboard');
  say(
    `fleet on the road: ${fleetNow.drivers.onShift}/${fleetNow.drivers.total} on shift · ` +
      `${(fleetNow.positions ?? []).length} reporting a position · ${fleetNow.cargo?.count ?? 0} parcels in motion`,
  );

  /* ------------------------------- a damage claim somebody can actually decide --- */

  /*
   * A FREIGHT CLAIM WITH THE EVIDENCE ATTACHED, driven through the real flow rather than written down.
   *
   * The claims queue names its evidence as media ids, and the only honest way to produce ids with bytes
   * behind them is to walk one load through the three gates a real one passes: a securement photo at
   * pickup, a proof-of-delivery photo at the door, and the claimant's own photo of the damage. Each is
   * uploaded by the party who would really have taken it — the driver twice, the shipper once — because
   * the media store checks OWNERSHIP when it adopts a client-supplied reference, and a photo the wrong
   * account uploaded is silently dropped rather than refused.
   *
   * NO TRADE TERM on this one, deliberately: standing then sits with the sender, which is the plain case,
   * and the seeded CIF load already on the queue shows the other. It also keeps this block independent of
   * which terms a country happens to have switched on.
   */
  {
    const LOAD = 'A carton of school books';
    const freightPath = (id, tail) => `/v1/sbg/dispatch/freight/${encodeURIComponent(id)}${tail}`;
    const claimsNow = need(await req('GET', '/v1/sbg/freight-claims', { token: op }), 'claims queue').claims ?? [];

    if (!claimsNow.some((c) => c.description === LOAD)) {
      /*
       * REPAIRED, NOT MULTIPLIED — the lesson from getting this wrong four times in a row.
       *
       * The first guard asked whether the CLAIM existed, which is the last thing this block creates. So
       * every run that failed half way left a load posted and taken, the next run saw no claim and posted
       * another, and by the fourth the driver's bike was full of cartons nobody would ever deliver and the
       * dispatch gate refused the lot — correctly, and for a reason that had nothing to do with the bug.
       * A seeder has to ask about what it makes FIRST, and clear up after its own failed attempt.
       */
      const all = need(await req('GET', '/v1/sbg/dispatch/freight', { token: op }), 'freight list');
      const mineAlready = (all.items ?? all).filter((f) => f.description === LOAD && f.status !== 'cancelled');
      const carried = mineAlready.find((f) => f.status === 'delivered');
      for (const f of mineAlready) {
        if (f.status === 'delivered') continue; // carrying it again is not possible, and its photos are real
        await req('POST', freightPath(f.freightId, '/cancel'), { token: tokA1, body: { reason: 'Unfinished seeding attempt — never a real load.' } });
      }

      let frt = carried;
      let picked = { ok: Boolean(carried) };

      if (!frt) {
        const posted = await req('POST', '/v1/sbg/dispatch/freight', {
          token: tokA1,
          body: {
            description: LOAD,
            pickupLocation: { lat: -1.2864, lng: 36.8172 },
            pickupLabel: 'Mama Sarah Shop',
            destLabel: 'Riverside Corner',
            destLocation: { lat: -1.3021, lng: 36.8456 },
            // Small, and not marked fragile, because the vehicle that will carry it is a bike: the seeder
            // posts a load this fleet can actually take rather than one the dispatch gate has to refuse.
            weightKg: 8,
            packaging: 'piece',
          },
        });
        if (!posted.ok) say(`  (could not post the claim demo load: ${posted.status} ${JSON.stringify(posted.data).slice(0, 160)})`);
        frt = posted.ok ? posted.data : undefined;
      }

      if (frt && !carried) {
        /*
         * ITS OWN DRIVER, AND ITS OWN SHIFT, ENDED WHEN THE HAUL IS.
         *
         * Not Amos, and that is the seeder learning from the rules rather than working round them: his
         * shift is left open so the demo world has somebody on the road, so by the next run he is
         * nineteen hours on duty and the hours gate refuses him any new load. Correctly. A seeder that
         * reached past that would be seeding a world its own rules say cannot exist.
         *
         * So this haul gets a driver of its own, coupled for the length of it and UNCOUPLED after. A
         * shift of a few seconds owes no rest, so a re-seed can do it again; a shift left open could not.
         */
        const carrier =
          need(await req('GET', '/v1/sbg/fleet/drivers', { token: fm }), 'fleet drivers').find((d) => d.displayName === 'Peter O.') ??
          need(
            await req('POST', '/v1/sbg/drivers/onboard', {
              token: fm,
              body: {
                displayName: 'Peter O.',
                fullName: 'Peter Otieno',
                nationalId: 'NID-PETER',
                mobile: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
                licenceClasses: ['bike'],
                managerDid: mgr.did,
              },
            }),
            'driver peter',
          );
        const carrierIn = await signInDriver(carrier, 'peter');
        const spare = await ensureVehicle('KLM 003B', 'bike', 0.5);
        const shift = await startShift(carrier, carrierIn.token, spare, corridorZAB.corridorId);
        if (!shift.ok) say(`  (could not start ${carrier.displayName}'s shift: ${shift.status} ${JSON.stringify(shift.data).slice(0, 160)})`);

        const assigned = await req('POST', `/v1/sbg/fleet/managers/${encodeURIComponent(mgr.did)}/dispatch`, {
          token: fm,
          body: { freightId: frt.freightId, driverDid: carrier.did },
        });
        if (!assigned.ok) {
          say(`  (could not dispatch ${frt.code}: ${assigned.status} ${JSON.stringify(assigned.data).slice(0, 160)})`);
        } else {
          /*
           * THE CHECKLIST IS READ FROM THE LOAD, never written down here.
           *
           * The backend re-derives the required keys from the cargo, so a list copied into a seeder goes
           * quietly stale the day a cargo class gains an item. It lives on the DRIVER'S view of the loads
           * they hold — not on the dispatch board, which is the shape an office sees and carries no
           * checklist at all. That cost two runs.
           */
          const held = await req('GET', `/v1/sbg/fleet/drivers/${encodeURIComponent(carrier.did)}/claims`, { token: carrierIn.token });
          const mine = (held.data?.claims ?? []).find((c) => c.freightId === frt.freightId || c.ref === frt.freightId || c.code === frt.code);
          const loadKeys = (mine?.loadChecklist ?? []).map((i) => i.key);
          const unloadKeys = (mine?.unloadChecklist ?? []).map((i) => i.key);
          if (!loadKeys.length) say(`  (no load checklist came back for ${frt.code} — the pickup gate will refuse it)`);

          const securement = await uploadDoc(carrierIn.token, 'securement', 'securement', 3);
          picked = await req('POST', freightPath(frt.freightId, '/pickup'), {
            token: carrierIn.token,
            body: { driverDid: carrier.did, confirmed: loadKeys, securementPhotoId: securement, reservations: 'Carton already scuffed on one corner when handed over' },
          });
          if (!picked.ok) say(`  (could not pick up ${frt.code}: ${picked.status} ${JSON.stringify(picked.data).slice(0, 160)})`);

          if (picked.ok) {
            const pod = await uploadDoc(carrierIn.token, 'pod', 'pod', 6);
            const delivered = await req('POST', freightPath(frt.freightId, '/deliver'), {
              token: carrierIn.token,
              body: { driverDid: carrier.did, confirmed: unloadKeys, receiverName: 'Joseph Mwangi', podPhotoId: pod, remarks: 'The carton was wet through by the time it came off the bike' },
            });
            picked = delivered;
            if (!delivered.ok) say(`  (could not deliver ${frt.code}: ${delivered.status} ${JSON.stringify(delivered.data).slice(0, 160)})`);
          }
        }
        // The shift ENDS with the haul, always — including after a failure, or the next run finds this
        // driver coupled, cannot couple them again, and seeds nothing while saying nothing.
        await req('POST', `/v1/sbg/fleet/drivers/${encodeURIComponent(carrier.did)}/uncouple`, { token: fm });
      }

      if (frt && picked.ok) {
        // And the shipper's own photograph of the damage — the third thing the queue counts.
        const damage = await uploadDoc(tokA1, 'dispute', 'damage', 9);
        const claimed = await req('POST', freightPath(frt.freightId, '/claim'), {
          token: tokA1,
          body: { kind: 'damaged', description: 'Rain got into the carton — about a third of the books are pulped', photoRef: damage },
        });
        say(
          claimed.ok
            ? `claim      ${frt.code} damaged — 3 photographs an operator can open`
            : `  (could not raise the claim on ${frt.code}: ${claimed.status} ${JSON.stringify(claimed.data).slice(0, 160)})`,
        );
      }
    }
  }

  /* ------------------------------------------------ who administers a company --- */

  // A login for each company, so the operator console can be opened as the people it is FOR: the group,
  // which sees its sisters side by side, and a sister, which sees only itself. Created with an operator
  // token because there is deliberately no public route into this — an admin of a company is made by
  // somebody who already administers it.
  const companyAdmins = [];
  const entities = need(await req('GET', '/v1/sbg/entities', { token: op }), 'entities');
  for (const entity of entities) {
    const email = `${entity.entityId}@sbg.test`;
    const made = await req('POST', `/v1/sbg/entities/${encodeURIComponent(entity.entityId)}/admins`, {
      token: op,
      body: { email, name: entity.kind === 'group' ? 'Group Finance' : `${entity.name} Finance` },
    });
    // A re-seed hits the "already administers" refusal, which is correct and not worth failing over:
    // the login from the first run still works, and its password was printed then.
    if (made?.temporaryPassword) companyAdmins.push({ entityId: entity.entityId, kind: entity.kind, email, password: made.temporaryPassword });
  }

  /* -------------------------------------------------------------- sheet --- */
  out.push('', '='.repeat(64), '  SEEBUYGET DEMO — SIGN-IN SHEET', '='.repeat(64));
  out.push(`  Agent app   /agent/   agent1@sbg.test / ${PASSWORD}   (Mama Sarah Shop)`);
  out.push(`                        agent2@sbg.test / ${PASSWORD}   (Riverside Corner)`);
  out.push(`                        agent3@sbg.test / ${PASSWORD}   (Downtown Kiosk)`);
  out.push(`  Hub app     /mdp/     hub@sbg.test    / ${PASSWORD}   (Central Sort)`);
  out.push(`  Fleet app   /fleet/   company ${fleetCode} · then ${mgr.contactPhone} PIN ${MGR_PIN}`);
  // BOTH drivers, because one account proves nothing about what a second may see — the road photographs
  // are read back by the next driver down that road, and checking that needs two sign-ins.
  out.push(`  Driver app  /driver/  phone ${amosIn.phone} PIN ${DRIVER_PIN}   (Amos K., on shift)`);
  out.push(`                        phone ${graceIn.phone} PIN ${DRIVER_PIN}   (Grace M., papers with GLOS)`);
  out.push('  Send app    /send/    no sign-in needed');
  out.push('  Operator    :5181/    ops1@sbg.test / seebuyget-staff (Amina Otieno) · ops2@sbg.test (Brian Kamau), same password');
  out.push('              :5181/    or the setup key: your name + any key (no GLOS_CLIENT_SECRET set in a sandbox)');
  for (const a of companyAdmins) {
    out.push(`              :5181/    ${a.email.padEnd(18)} / ${a.password}   (${a.kind === 'group' ? 'the group: sees every sister' : 'this company only'})`);
  }
  if (!companyAdmins.length) out.push('              :5181/    company logins already exist — their passwords were printed on the first seed');
  out.push(`  Vendor app  /vendor/  ${STORE_EMAIL}  / ${PASSWORD}   (Nairobi Threads, ${shop.vendorId})`);
  out.push(`                        its signing secret, for its systems only: ${VENDOR_SECRET}`);
  out.push('-'.repeat(64));
  out.push(`  Handover demo   ${p1.parcelId}, ${p2.parcelId} wait for badge ${amos.badgeId}`);
  out.push(`  Release demo    ${p3.parcelId} is On_Bus at Riverside (mark arrived)`);
  out.push(`  Pickup demo     ${p6.parcelId} — code ${p6Code}${p6Now.binSlot ? ` · shelf ${p6Now.binSlot}` : ''}`);
  out.push(`  Track demo      ${p6.trackingKey} (ready) · ${p3.trackingKey} (on the bus)`);
  out.push(`  Hub sort demo   ${p4.parcelId} queued · bag ${sorted.toteCode} ready to load`);
  out.push(`  Vendor demo     ${minted.parcel.parcelId} minted · collection ${minted.parcel.collectionCode ?? '—'} · track ${minted.parcel.trackingKey ?? '—'}`);
  out.push(`  Register demo   Nairobi Threads has ${history.length + 1} shipments — try Search / Filters / pages / multi-select + Export`);
  out.push('='.repeat(64));
  say(out.join('\n'));
};

run().catch((e) => die(String(e?.stack ?? e)));

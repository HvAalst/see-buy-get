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
const API = process.env.SBG_API ?? 'http://localhost:3000';
const PASSWORD = 'seebuyget';
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

const need = (r, what) => {
  if (!r.ok) die(`${what} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};

async function verifiedPhone() {
  const phone = `+2547${Math.floor(10000000 + Math.random() * 89999999)}`;
  const r1 = await req('POST', '/v1/sbg/auth/phone/request', { body: { phone } });
  const code = r1.data?.code ?? r1.data?.otp ?? r1.data?.verificationCode;
  need(await req('POST', '/v1/sbg/auth/phone/verify', { body: { phone, code } }), 'phone verify');
  return phone;
}

/** Login with the fixed demo credentials, else sign the account up. */
async function ensureAccount(email, role, profile) {
  const login = await req('POST', '/v1/sbg/auth/login', { body: { email, password: PASSWORD } });
  if (login.ok) return login.data;
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
  const tokA1 = a1.token.access_token;
  const tokA2 = a2.token.access_token;
  say(`shop  Mama Sarah Shop   ${a1.did}`);
  say(`shop  Riverside Corner  ${a2.did}`);

  // DRAFT → KYC_PENDING → APPROVED_UNFUNDED (wallet minted) → deposit → ACTIVE with money.
  for (const [did, tok, label] of [
    [a1.did, tokA1, 'Mama Sarah Shop'],
    [a2.did, tokA2, 'Riverside Corner'],
  ]) {
    const rec = need(await req('GET', `/v1/sbg/agents/${encodeURIComponent(did)}`, { token: tok }), 'agent read');
    if (rec.status === 'DRAFT' || rec.status === 'KYC_PENDING') {
      if (rec.status === 'DRAFT') {
        need(
          await req('POST', `/v1/sbg/agents/${encodeURIComponent(did)}/submit-kyc`, {
            token: tok,
            body: { idCopyRef: 'id.jpg', tradingLicenceRef: 'licence.jpg', shopPhotoRefs: ['shop-front.jpg'] },
          }),
          `kyc ${label}`,
        );
      }
      need(await req('POST', `/v1/sbg/agents/${encodeURIComponent(did)}/kyc-decision`, { token: op, body: { approve: true, by: 'seed' } }), `approve ${label}`);
      need(await req('POST', `/v1/sbg/agents/${encodeURIComponent(did)}/deposit`, { token: tok }), `deposit ${label}`);
      say(`activated: ${label}`);
    }
    const gate = need(await req('GET', `/v1/sbg/agents/${encodeURIComponent(did)}/can-transact`, { token: tok }), 'gate');
    if ((gate.balance ?? 0) < 20) {
      need(await req('POST', `/v1/sbg/agents/${encodeURIComponent(did)}/top-up`, { token: tok, body: { amount: 60 } }), 'top-up');
      say(`wallet topped up: ${label}`);
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
    need(
      await req('POST', `/v1/sbg/fleet/managers/${mgr.did}/submit-kyc`, {
        token: op,
        body: { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'tol.pdf', ownerIdRef: 'id.jpg', proofOfAddressRef: 'poa.pdf' },
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
  say(`fleet Kilima Logistics   sign-in code ${fleetCode}`);

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
    // Papers in → KYC_PENDING; the decision stays with GLOS ops so the fleet app shows "GLOS checking".
    await req('POST', `/v1/sbg/fleet/drivers/${encodeURIComponent(grace.did)}/submit-kyc`, {
      token: fm,
      body: { idCopyRef: 'grace-id.jpg', licenceCopyRef: 'grace-licence.jpg' },
    });
  }
  say(`drivers Amos K. (badge ${amos.badgeId ?? '—'}) · Grace M. (papers with GLOS)`);

  // Handover resolves the badge only for a COUPLED driver on a corridor — put Amos on shift.
  const corridorZAB = need(await req('GET', '/v1/sbg/corridors', { token: op }), 'corridors').find(
    (c) => c.originZone === 'Z-A' && c.destZone === 'Z-B',
  );
  const assignments = need(await req('GET', '/v1/sbg/fleet/assignments?status=active', { token: fm }), 'assignments');
  if (!assignments.some((x) => x.driverDid === amos.did)) {
    need(
      await req('POST', `/v1/sbg/fleet/drivers/${encodeURIComponent(amos.did)}/couple`, {
        token: fm,
        body: { vehicleId: bike.vehicleId, corridorId: corridorZAB.corridorId },
      }),
      'couple amos',
    );
    say(`Amos coupled to ${bike.plate} on ${corridorZAB.name}`);
  }
  void van;

  /* ------------------------------------------------------------ parcels --- */
  const accept = async (n, opts = {}) => {
    const id = `DEMO-${stamp}-${n}`;
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
          dropoffPhotoRef: `${id}-dropoff.jpg`,
        },
      }),
      `accept ${id}`,
    );
    return p;
  };

  const p1 = await accept(1);
  const p2 = await accept(2, { size: 'S' });
  say(`parcels waiting for the bus at Mama Sarah: ${p1.parcelId}, ${p2.parcelId}`);

  const p3 = await accept(3);
  need(
    await req('POST', '/v1/sbg/parcels/handover', { token: tokA1, body: { agentDid: a1.did, driverBadgeId: amos.badgeId, parcelIds: [p3.parcelId] } }),
    'handover p3',
  );
  say(`parcel on the bus with Amos: ${p3.parcelId} (track ${p3.trackingKey})`);

  const p6 = await accept(6, { size: 'L' });
  need(
    await req('POST', '/v1/sbg/parcels/handover', { token: tokA1, body: { agentDid: a1.did, driverBadgeId: amos.badgeId, parcelIds: [p6.parcelId] } }),
    'handover p6',
  );
  const arrived = need(
    await req('POST', `/v1/sbg/parcels/${encodeURIComponent(p6.parcelId)}/arrive`, { token: tokA2, body: { destAgentDid: a2.did } }),
    'arrive p6',
  );
  const p6Now = need(await req('GET', `/v1/sbg/parcels/${encodeURIComponent(p6.parcelId)}`, { token: tokA2 }), 'read p6');
  say(`parcel ready to collect at Riverside: ${p6.parcelId} — pickup code ${arrived.otp}${p6Now.binSlot ? ` · shelf ${p6Now.binSlot}` : ''}`);

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
  need(await req('POST', `/v1/sbg/totes/${encodeURIComponent(bag.code)}/load`, { token: tokA1, body: { driverBadgeId: amos.badgeId } }), 'load bag');
  need(await req('POST', `/v1/sbg/mdps/${encodeURIComponent(hubRow.mdpId)}/drop-bag`, { token: tokHub, body: { code: bag.code } }), 'drop bag');
  const sorted = need(
    await req('POST', `/v1/sbg/mdps/${encodeURIComponent(hubRow.mdpId)}/sort`, { token: tokHub, body: { parcelId: p5.parcelId } }),
    'sort p5',
  );
  say(`hub floor: ${p4.parcelId} waiting to sort · ${p5.parcelId} sorted into ${sorted.toteCode} → ${sorted.nextDestination.label}`);

  /* -------------------------------------------------------------- sheet --- */
  out.push('', '='.repeat(64), '  SEEBUYGET DEMO — SIGN-IN SHEET', '='.repeat(64));
  out.push('  Agent app   /agent/   agent1@sbg.test / seebuyget   (Mama Sarah Shop)');
  out.push('                        agent2@sbg.test / seebuyget   (Riverside Corner)');
  out.push('  Hub app     /mdp/     hub@sbg.test    / seebuyget   (Central Sort)');
  out.push(`  Fleet app   /fleet/   sign-in code ${fleetCode}            (Kilima Logistics)`);
  out.push(`  Driver app  /driver/  driver ID ${amos.did}`);
  out.push('  Send app    /send/    no sign-in needed');
  out.push('-'.repeat(64));
  out.push(`  Handover demo   ${p1.parcelId}, ${p2.parcelId} wait for badge ${amos.badgeId}`);
  out.push(`  Release demo    ${p3.parcelId} is On_Bus at Riverside (mark arrived)`);
  out.push(`  Pickup demo     ${p6.parcelId} — code ${arrived.otp}${p6Now.binSlot ? ` · shelf ${p6Now.binSlot}` : ''}`);
  out.push(`  Track demo      ${p6.trackingKey} (ready) · ${p3.trackingKey} (on the bus)`);
  out.push(`  Hub sort demo   ${p4.parcelId} queued · bag ${sorted.toteCode} ready to load`);
  out.push('='.repeat(64));
  say(out.join('\n'));
};

run().catch((e) => die(String(e?.stack ?? e)));

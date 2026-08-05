/**
 * Vendor shipment-history seeder — gives a vendor enough varied shipments to exercise the register
 * (search / filter / paginate / multi-select / export) WITHOUT re-seeding the whole demo world, and
 * without depending on the rest of it. Run it after the backend is on the current branch:
 *
 *   node scripts/seed-vendor-history.mjs                 (backend on :3000)
 *   VENDOR_SECRET=whsec_… HISTORY_N=60 node scripts/seed-vendor-history.mjs
 *
 * Self-sufficient: it reuses the demo "Nairobi Threads" vendor + two open PUDOs when they exist, and
 * otherwise CREATES them (a fresh vendor, and fresh fully-onboarded shops), so it works on an empty
 * backend too. It then mints a batch that alternates origin/destination between two shops (so the
 * per-PUDO filter has real options), with rotating products, buyers, sizes and order-refs; funds the
 * store and settles half the unpaid ones (so the Paid filter shows both sides); and intakes a chunk
 * best-effort (so a few sit "At the drop-off shop"). Every step is resilient — a failure is skipped.
 */
const API = process.env.SBG_API ?? 'http://localhost:3000';
const VENDOR_SECRET = process.env.VENDOR_SECRET ?? 'whsec_demo_nairobi_threads';
const HISTORY_N = Number(process.env.HISTORY_N ?? 44);
const PASSWORD = 'seebuyget';
const stamp = Date.now().toString(36).slice(-5).toUpperCase();

const say = (s) => console.log(s);
const die = (s) => {
  console.error(`\nHISTORY SEED FAILED: ${s}`);
  process.exit(1);
};

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
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

const HOURS = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '07:30', close: '20:30' }]));
const agentProfile = (shopName, zone, lat, lng) => ({
  agent: {
    shopName,
    fullName: `${shopName} Keeper`,
    nationalId: `NID-${shopName.replace(/\s+/g, '')}-${stamp}`,
    mobile: `+2547${Math.floor(10000000 + Math.random() * 89999999)}`,
    deviceImei: `IMEI-${shopName.replace(/\s+/g, '')}-${stamp}`,
    zone,
    landmark: 'Near the market',
    location: { lat, lng },
    pricePerParcel: 1.3,
    shelf: { rows: 4, cols: 5 },
    openingHours: HOURS,
    requirements: { androidVersion: 13, reliablePower: true, tradingLicence: `TL-${shopName.replace(/\s+/g, '')}`, criminalRecordClear: true },
  },
});

const run = async () => {
  say(`Seeding vendor history against ${API} (batch ${stamp})…\n`);
  const op = need(await req('POST', '/v1/auth/token', { body: { role: 'operator' } }), 'operator mint').access_token;

  /* ---- vendor: reuse the demo store if the secret opens it, else register a fresh one ---------- */
  let vendorId = null;
  let vendorName = null;
  let tokV = null;
  const known = (await req('GET', '/v1/sbg/vendors', { token: op })).data?.find((v) => v.name === 'Nairobi Threads');
  if (known) {
    const li = await req('POST', '/v1/sbg/vendors/login', { body: { vendorId: known.vendorId, secret: VENDOR_SECRET } });
    if (li.ok) {
      vendorId = known.vendorId;
      vendorName = known.name;
      tokV = li.data.token.access_token;
    }
  }
  if (!tokV) {
    const name = known ? `Nairobi Threads ${stamp}` : 'Nairobi Threads';
    const reg = need(await req('POST', '/v1/sbg/vendors', { body: { name, country: 'KE', address: 'Biashara St 12', location: { lat: -1.284, lng: 36.824 }, secret: VENDOR_SECRET } }), 'vendor register');
    const li = need(await req('POST', '/v1/sbg/vendors/login', { body: { vendorId: reg.vendorId, secret: VENDOR_SECRET } }), 'vendor login');
    vendorId = reg.vendorId;
    vendorName = name;
    tokV = li.token.access_token;
  }
  say(`vendor ${vendorName} (${vendorId})`);

  /* ---- PUDOs: use two open shops if present, else onboard two fresh ones ----------------------- */
  const activate = async (label, zone, lat, lng) => {
    const email = `pudo-${label.replace(/\s+/g, '').toLowerCase()}-${stamp}@sbg.test`;
    const phone = await verifiedPhone();
    const acct = need(await req('POST', '/v1/sbg/auth/signup', { body: { role: 'pudo', email, password: PASSWORD, phone, profile: agentProfile(label, zone, lat, lng) } }), `signup ${label}`);
    const did = acct.did;
    const tok = acct.token.access_token;
    need(await req('POST', `/v1/sbg/agents/${encodeURIComponent(did)}/submit-kyc`, { token: tok, body: { idCopyRef: 'id.jpg', tradingLicenceRef: 'licence.jpg', shopPhotoRefs: ['shop.jpg'] } }), `kyc ${label}`);
    need(await req('POST', `/v1/sbg/agents/${encodeURIComponent(did)}/kyc-decision`, { token: op, body: { approve: true, by: 'seed' } }), `approve ${label}`);
    need(await req('POST', `/v1/sbg/agents/${encodeURIComponent(did)}/deposit`, { token: tok }), `deposit ${label}`);
    await req('POST', `/v1/sbg/agents/${encodeURIComponent(did)}/top-up`, { token: tok, body: { amount: 60 } });
    return { did, shopName: label, zone };
  };
  let open = ((await req('GET', '/v1/sbg/network/points')).data ?? []).filter((p) => p.openState === 'open');
  if (open.length < 2) {
    say('fewer than two open PUDOs — onboarding a fresh pair…');
    const mk1 = await activate('Mama Sarah Shop', 'Z-A', -1.2864, 36.8172);
    const mk2 = await activate('Riverside Corner', 'Z-B', -1.3021, 36.8456);
    // a corridor so the two directions route
    const cors = (await req('GET', '/v1/sbg/corridors', { token: op })).data ?? [];
    for (const [o, d] of [['Z-A', 'Z-B'], ['Z-B', 'Z-A']]) {
      if (!cors.some((c) => c.originZone === o && c.destZone === d)) await req('POST', '/v1/sbg/corridors', { token: op, body: { name: `${o} → ${d}`, originZone: o, destZone: d } });
    }
    open = [mk1, mk2];
  }
  const [A, B] = open;
  say(`PUDOs: ${A.shopName} (${A.zone}) · ${B.shopName} (${B.zone})`);

  // A best-effort agent actor token per shop, so intakes can mark parcels "At the drop-off shop".
  const agentTok = {};
  for (const p of [A, B]) {
    const t = await req('POST', '/v1/auth/token', { body: { role: 'pudo', did: p.did, tenant: p.did, type: 'client_credentials' } });
    if (t.ok && t.data?.access_token) agentTok[p.did] = t.data.access_token;
  }

  /* ---- the shipment history ------------------------------------------------------------------- */
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
  const SIZES = [
    [{ l: 18, w: 12, h: 6 }, 0.4],
    [{ l: 30, w: 20, h: 10 }, 1.6],
    [{ l: 42, w: 30, h: 18 }, 3.5],
  ];

  const history = [];
  for (let i = 0; i < HISTORY_N; i++) {
    const [firstname, mobile] = BUYERS[i % BUYERS.length];
    const [dims, kg] = SIZES[i % SIZES.length];
    const [origin, dest] = i % 2 === 0 ? [A, B] : [B, A]; // alternate → the per-PUDO filter takes BOTH shops
    const ref = `SO-${stamp}-${String(i + 1).padStart(3, '0')}`;
    const r = await req('POST', '/v1/sbg/inbound/orders', {
      token: tokV,
      body: {
        vendorId,
        originPudoDid: origin.did,
        destPudoDid: dest.did,
        buyerMobile: mobile,
        buyerEmail: `${firstname}@example.com`,
        externalOrderId: ref,
        dimensionsCm: dims,
        weightKg: kg,
        contentPhotoRef: `${ref}-contents.jpg`,
        routeMode: i % 3 === 0 ? 'flexible' : 'locked',
        items: PRODUCTS[i % PRODUCTS.length],
        subtotal: 20 + (i % 7) * 8,
      },
    });
    if (!r.ok || !r.data?.parcel) continue; // a diverted/blocked mint is simply skipped
    history.push({ parcelId: r.data.parcel.parcelId, paid: Boolean(r.data.paid), originDid: origin.did });
  }
  say(`minted ${history.length}/${HISTORY_N} shipments`);
  if (history.length === 0) die('no parcels minted — check routing/corridors between the two PUDOs');

  // Fund the store, then settle HALF the still-unpaid ones so the Paid filter has both sides.
  await req('POST', `/v1/sbg/vendors/${vendorId}/top-up`, { token: tokV, body: { amount: 3000 } });
  const unpaid = history.filter((h) => !h.paid);
  for (let k = 0; k < Math.floor(unpaid.length / 2); k++) {
    const s = await req('POST', `/v1/sbg/parcels/${encodeURIComponent(unpaid[k].parcelId)}/settle`, { token: tokV });
    if (s.ok) unpaid[k].paid = true;
  }

  // Intake ~65% (→ At the drop-off shop) with the origin shop's token, best-effort; the rest stay Created.
  let intook = 0;
  for (let i = 0; i < history.length; i++) {
    if (i % 20 >= 13) continue; // ~35% stay Created
    const h = history[i];
    const tok = agentTok[h.originDid];
    if (!tok) continue;
    const t = await req('POST', `/v1/sbg/parcels/${encodeURIComponent(h.parcelId)}/intake`, { token: tok, body: { agentDid: h.originDid } });
    if (t.ok) intook++;
  }

  const paid = history.filter((h) => h.paid).length;
  say('');
  say('='.repeat(60));
  say(`  Vendor register is ready: ${vendorName}`);
  say(`  Store ID   ${vendorId}`);
  say(`  Secret     ${VENDOR_SECRET}`);
  say(`  Shipments  ${history.length} new  ·  ${paid} paid / ${history.length - paid} unpaid  ·  ${intook} at the shop`);
  say(`  Sign in    /vendor/  with the Store ID + Secret above`);
  say(`  Try        search "denim" or a buyer number · Filters (PUDO/paid/status) · pages · tick + Export`);
  say('='.repeat(60));
};

run().catch((e) => die(String(e?.stack ?? e)));

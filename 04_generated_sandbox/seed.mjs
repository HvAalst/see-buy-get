// GLOS PUDO — demo seed. Populates a running backend with enough data to click through every surface:
// PUDO agents, an MDP hub, a vendor + inbound order, an ACTIVE fleet manager (with a sign-in code),
// vehicles + drivers, a driver on shift (with a GPS position), and a claimed outbound bag (cargo in
// motion). Prints the URLs to open. Run the backend first (`npm run dev`), then `npm run seed`.

const API = process.env.GLOS_API || 'http://localhost:3000/v1';
const FRONT = process.env.GLOS_FRONT || 'http://localhost:4173';
// ≥10h/day average across open days (the Ch-18 eligibility floor) — keep every open day at 10h.
const DAY = { open: '08:00', close: '18:00' };
const HOURS = { mon: DAY, tue: DAY, wed: DAY, thu: DAY, fri: DAY, sat: DAY, sun: null };
const rnd = () => Math.random().toString(16).slice(2, 8);

let token;
async function tok() {
  if (token) return token;
  const r = await fetch(`${API}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sub: 'seed', type: 'client_credentials' }) });
  if (!r.ok) throw new Error(`auth ${r.status}`);
  token = (await r.json()).access_token;
  return token;
}
async function call(method, path, body) {
  const t = await tok();
  const r = await fetch(`${API}/pudo${path}`, { method, headers: { Authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${data.message || ''}`);
  return data;
}
const post = (p, b) => call('POST', p, b);

async function onboardAgent(shop, zone, lat, lng) {
  const u = rnd();
  const a = await post('/agents', { shopName: shop, zone, location: { lat, lng }, landmark: 'near the market', shelf: { rows: 3, cols: 3 }, openingHours: HOURS, fullName: `${shop} owner`, nationalId: `ID-${u}`, mobile: `+2547${u}`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: `TL-${u}`, criminalRecordClear: true } });
  await post(`/agents/${a.did}/submit-kyc`, { idCopyRef: 'id.jpg', tradingLicenceRef: 'lic.pdf', shopPhotoRefs: ['shop.jpg'] });
  await post(`/agents/${a.did}/kyc-decision`, { approve: true });
  await post(`/agents/${a.did}/top-up`, { amount: 50 });
  return a;
}

async function main() {
  // 0. reachability
  try { await tok(); } catch { throw new Error(`Can't reach the backend at ${API}. Start it first: npm run dev`); }
  const u = rnd();
  console.log('\nSeeding GLOS PUDO demo data…\n');

  // 1. PUDO agents (two zones) + an MDP hub serving the destination zone
  const origin = await onboardAgent('Mama Sarah Shop', 'NorthTown', -1.22, 36.81);
  const dest = await onboardAgent('Eastleigh Kiosk', 'EastTown', -1.27, 36.95);
  const westlands = await onboardAgent('Westlands Dukawalla', 'NorthTown', -1.26, 36.80);
  const hub = await post('/mdps', { name: 'East Sort Hub', zones: ['EastTown'], location: { lat: -1.25, lng: 36.9 } });
  console.log(`  ✓ agents: ${origin.shopName} (NorthTown), ${dest.shopName} (EastTown), ${westlands.shopName} (NorthTown)`);
  console.log(`  ✓ MDP hub: ${hub.name}`);

  // 2. vendor + a spread of inbound orders across every status (so the merchant console is populated).
  //    Needs a corridor + a (legacy) driver to move parcels origin → dest.
  const vendor = await post('/vendors', { name: 'ACME Online', callbackUrl: 'https://acme.example/glos/webhook', address: '12 Biashara Street', location: { lat: -1.24, lng: 36.84 }, country: 'KE', shippingPolicy: { mode: 'capped', freeOverSubtotal: 50, buyerContributionCap: 3 } });
  await post(`/vendors/${vendor.vendorId}/top-up`, { amount: 100 }); // prepay the per-country daughter company → shipments are ParcelPaid
  // Open-data participant pricing (visible to everyone — competition pressure).
  await call('PATCH', `/agents/${origin.did}/pricing`, { price: 0.5 }); await call('PATCH', `/agents/${dest.did}/pricing`, { price: 0.6 }); await call('PATCH', `/agents/${westlands.did}/pricing`, { price: 0.45 });
  await call('PATCH', `/mdps/${hub.mdpId}/pricing`, { price: 0.3 });
  const corridor = await post('/corridors', { name: 'North→East', originZone: 'NorthTown', destZone: 'EastTown' });
  const van = await post('/drivers', { driverDid: `did:glos:invan-${u}`, name: 'Inbound Van', corridorId: corridor.corridorId });
  const badge = van.badgeId;
  // A 1×1 transparent PNG data URL — stands in for a real content photo (dispute baseline).
  const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  let oi = 0;
  const order = async () => { oi += 1; return post('/inbound/orders', { vendorId: vendor.vendorId, externalOrderId: `ORD-${u}-${oi}`, originPudoDid: origin.did, destPudoDid: dest.did, buyerMobile: `+25470${oi}`, buyerEmail: `buyer${oi}@example.com`, dimensionsCm: { l: 40, w: 30, h: 20 }, weightKg: 4, contentPhotoRef: photo, subtotal: oi % 2 ? 28 : 60, items: [{ name: 'Goods', qty: oi }] }); };
  const intake = (p) => post(`/parcels/${p.parcel.parcelId}/intake`, { agentDid: origin.did });
  const toBus = (p) => post('/parcels/handover', { agentDid: origin.did, driverBadgeId: badge, parcelIds: [p.parcel.parcelId] });
  const shelve = (p) => post(`/parcels/${p.parcel.parcelId}/shelve`, { agentDid: dest.did });

  await order();                                                                 // Created
  const oB = await order(); await intake(oB);                                    // At_PUDO
  const oC = await order(); await intake(oC); await toBus(oC); await shelve(oC); // Ready_For_Pickup
  const oD = await order(); await intake(oD); await toBus(oD); await shelve(oD);
  await post(`/parcels/${oD.parcel.parcelId}/collect-confirm`, { agentDid: dest.did, collectionCode: oD.parcel.collectionCode }); // Delivered
  const oE = await order(); await intake(oE); await toBus(oE); await shelve(oE);
  await post(`/parcels/${oE.parcel.parcelId}/dispute`, { agentDid: dest.did, reason: 'Box arrived damaged', photoProofRef: 'damage.jpg' }); // Disputed
  // Two buyer checkout selections waiting in the console's incoming-orders inbox (from the embedded node).
  await post(`/vendors/${vendor.vendorId}/checkout`, { destPudoDid: dest.did, buyerEmail: 'amina@example.com', externalOrderId: `WEB-${u}-1`, subtotal: 32, items: [{ name: 'Headphones', qty: 1 }], source: 'node' });
  await post(`/vendors/${vendor.vendorId}/checkout`, { destPudoDid: westlands.did, buyerEmail: 'kevin@example.com', externalOrderId: `WEB-${u}-2`, subtotal: 75, items: [{ name: 'Sneakers', qty: 1 }], source: 'node' });
  console.log(`  ✓ vendor ${vendor.name}: ${oi} orders across Created / At_PUDO / Ready / Delivered / Disputed + 2 incoming checkout selections + signed callbacks`);

  // 3. fleet manager — onboard → KYC → vet → bond → ACTIVE (capture the sign-in code)
  const m = await post('/fleet/managers', { companyName: 'Rift Valley Logistics', tradingName: 'Rift Logistics', contactPhone: `+25411${u}`, contactEmail: 'ops@rift.example', ownerFullName: 'Grace Mwangi', ownerNationalId: `MGR-${u}`, depotAddress: '7 Depot Road, Industrial Area', location: { lat: -1.31, lng: 36.85 }, requirements: { businessRegistrationNo: `BRN-${u}`, transportOperatorLicence: `TOL-${u}`, taxId: `TAX-${u}`, declaredFleetSize: 6 } });
  await post(`/fleet/managers/${m.did}/submit-kyc`, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.jpg', proofOfAddressRef: 'addr.pdf' });
  await post(`/fleet/managers/${m.did}/kyc-decision`, { approve: true, by: 'seed' });
  const active = await post(`/fleet/managers/${m.did}/bond`, {});
  console.log(`  ✓ fleet manager: ${active.companyName} — ACTIVE, sign-in code \x1b[1m${active.loginCode}\x1b[0m`);

  // 4. vehicles (own IDs, dashboard QR) under the manager
  const moto = await post('/vehicles', { plate: `KMC-${u}`, vehicleClass: 'motorcycle', ownerName: 'Rift Logistics', ownerType: 'fleet_owned', managerDid: m.did });
  const reefer = await post('/vehicles', { plate: `KBZ-${u}`, vehicleClass: 'truck', truckSubtype: 'refrigerated', ownerName: 'Rift Logistics', ownerType: 'fleet_owned', documents: { registrationPhotoRef: 'reg.jpg', factoryId: `VIN-${u}` }, managerDid: m.did });
  // Open-data per-km rates set by the fleet — a spread so a flexible quote reserves the ceiling + rebates the rest.
  await call('PATCH', `/vehicles/${moto.vehicleId}/pricing`, { price: 0.06 });
  await call('PATCH', `/vehicles/${reefer.vehicleId}/pricing`, { price: 0.14 });
  console.log(`  ✓ vehicles: ${moto.plate} (motorcycle, QR ${moto.qr}, 0.06/km), ${reefer.plate} (reefer ${reefer.capacityKg}kg, 0.14/km, verified ${reefer.verified})`);

  // 5. drivers under the manager — a light bike courier (instant) + a heavy truck driver (vetted)
  const boda = await post('/drivers/onboard', { displayName: 'Boda Sam', fullName: 'Samuel Otieno', nationalId: `DRV-${u}A`, mobile: `+254722${u}`, licenceClasses: ['bike', 'motorcycle'], managerDid: m.did });
  const future = new Date(Date.now() + 730 * 86_400_000).toISOString();
  const trucker = await post('/drivers/onboard', { displayName: 'Trucker Joy', fullName: 'Joy Wambui', nationalId: `DRV-${u}B`, mobile: `+254733${u}`, licenceClasses: ['car', 'truck'], licenceNumber: `DL-${u}`, licenceExpiresAt: future, criminalRecordClear: true, managerDid: m.did });
  await post(`/fleet/drivers/${trucker.did}/submit-kyc`, { idCopyRef: 'id.jpg', licenceCopyRef: 'dl.jpg' });
  await post(`/fleet/drivers/${trucker.did}/kyc-decision`, { approve: true, by: 'seed' });
  console.log(`  ✓ drivers: ${boda.displayName} (light, ${boda.badgeId}), Trucker Joy (heavy, vetted)`);

  // 6. Boda starts a shift by scanning the moto's dashboard QR
  await post(`/fleet/drivers/${boda.did}/start-session`, { vehicleQr: moto.qr });

  // 7. an outbound tote at the origin PUDO, bound for the hub, released to the marketplace
  const bag = await post(`/agents/${origin.did}/totes`, {});
  await post(`/totes/${bag.code}/assign`, { destinationNodeId: hub.mdpId, destinationLabel: hub.name });
  for (let i = 0; i < 3; i += 1) {
    const pid = `OUT-${u}-${i}`;
    await post('/parcels/accept', { agentDid: origin.did, parcelId: pid, size: 'M', destZone: 'EastTown', senderMobile: '+254700', receiverMobile: '+254711', dropoffPhotoRef: 'drop.jpg', paymentMode: 'prepaid' });
    await post(`/totes/${bag.code}/fill`, { parcelId: pid });
  }
  await post(`/totes/${bag.code}/release`, {});
  console.log(`  ✓ outbound bag ${bag.code} (3 parcels) released for claim → ${hub.name}`);

  // 8. Boda finds work on his route, claims the bag (cargo in motion + a GPS position on the dashboard)
  const sug = await post(`/fleet/drivers/${boda.did}/suggest-work`, { from: { lat: -1.22, lng: 36.81 }, to: { lat: -1.27, lng: 36.95 } });
  if (sug.offers?.length) { await post(`/dispatch/offers/${sug.offers[0].offerId}/claim`, {}); console.log(`  ✓ ${boda.displayName} claimed ${sug.offers[0].weightKg}kg → on the live fleet map`); }

  // 9. MDP sort queue: an inbound bag arrives at the hub + is emptied → parcels waiting to be sorted.
  const feeder = await post(`/agents/${origin.did}/totes`, {});
  await post(`/totes/${feeder.code}/assign`, { destinationNodeId: hub.mdpId, destinationLabel: hub.name });
  for (let i = 0; i < 4; i += 1) {
    const o = await order();
    await intake(o);
    await post(`/totes/${feeder.code}/fill`, { parcelId: o.parcel.parcelId });
  }
  await post(`/totes/${feeder.code}/load`, { driverBadgeId: badge });
  await post(`/mdps/${hub.mdpId}/drop-bag`, { code: feeder.code });
  await post(`/mdps/${hub.mdpId}/totes`, {});
  await post(`/mdps/${hub.mdpId}/totes`, {});
  console.log(`  ✓ MDP ${hub.name}: 4 parcels dropped + waiting to be sorted, 2 empty totes`);

  // --- summary ---
  const line = (label, url) => console.log(`  ${label.padEnd(26)} ${url}`);
  console.log('\n\x1b[1m✓ Seed complete. Open the launcher and click through:\x1b[0m\n');
  line('Launcher (start here)', `${FRONT}/index.html`);
  line('Agent app', `${FRONT}/agent.html?agent=${origin.did}`);
  line('Driver app (Boda)', `${FRONT}/driver.html?driver=${boda.did}`);
  line('MDP worker app', `${FRONT}/mdp.html?mdp=${hub.mdpId}`);
  line('Merchant console', `${FRONT}/vendor.html?vendor=${vendor.vendorId}`);
  line('Checkout node (buyer)', `${FRONT}/checkout.html?vendor=${vendor.vendorId}&subtotal=42`);
  line('Track a parcel (key)', `${FRONT}/index.html   → track key: ${oC.parcel.trackingKey}`);
  line('Fleet console (manager)', `${FRONT}/fleet.html   → sign in: ${active.loginCode}`);
  line('Fleet console (operator)', `${FRONT}/fleet.html?ops=1`);
  line('PUDO control tower', `${FRONT}/pudo-tower.html`);
  console.log('');
}

main().catch((e) => { console.error(`\n✗ Seed failed: ${e.message}\n`); process.exitCode = 1; });

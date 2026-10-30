import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ContactCardService } from '../src/modules/pudo/contact-card.service';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';
import { ImportService } from '../src/modules/pudo/import.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { AGREED } from './agreed';

/**
 * THE DIRECTORY (the user, 2026-10-30: "a directory much similar to that of fiata.org but in our own style"). Read by
 * anybody without an account; by country, alphabetical, never ranked. A company is in it once two of our staff checked
 * its papers and it forwards, clears or runs a depot; a fleet once it is active. What a firm says of itself stands beside
 * what we have seen, and its contact is only what it chose to show. A firm takes itself off, and on again — staff never.
 */
describe('the directory, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let setupKey = '';
  let amina = '';
  let brian = '';
  const tag = Math.random().toString(36).slice(2, 7);
  let seq = 0;
  const pdf = (label: string) => `data:application/pdf;base64,${Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`).toString('base64')}`;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

  async function aStaff(name: string): Promise<string> {
    const made = await http().post('/v1/sbg/operators').set(bearer(setupKey)).send({ email: `${name}-dir-${tag}@sbg.test`, name: `${name} ${tag}` }).expect(201);
    return (await http().post('/v1/sbg/operators/login').send({ email: made.body.email, password: made.body.temporaryPassword }).expect(201)).body.token.access_token;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    setupKey = (await http().post('/v1/auth/token').send({ role: 'operator' })).body.access_token;
    amina = await aStaff('amina');
    brian = await aStaff('brian');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  /** A business set up by its owner, in Kenya. */
  /** A person signed in by phone and email. */
  async function aPerson(): Promise<{ token: string; phone: string }> {
    seq += 1;
    const phone = `+2547${digits()}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `dir-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const token = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    return { token, phone };
  }

  async function aBusiness(name: string, activities: string[], country = 'KE'): Promise<{ token: string; entityId: string; name: string }> {
    const person = (await aPerson()).token;
    const made = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${name} ${tag}`, country, registrationNo: `DIR-${digits()}`, activities, yourName: 'Wanjiku' }).expect(201)).body;
    return { token: made.token.access_token, entityId: made.business.entityId, name: made.business.name };
  }

  /** Its papers checked by two of our staff — the moment its public page, and its line in the directory, exist. */
  async function checked(b: { token: string; entityId: string }): Promise<void> {
    const docs: string[] = [];
    for (const kind of ['certificate_of_incorporation', 'representative_id']) docs.push((await http().post(`/v1/sbg/entities/${b.entityId}/documents`).set(bearer(b.token)).send({ kind, title: kind, dataUrl: pdf(`${b.entityId}-${kind}`) }).expect(201)).body.documentId);
    await http().post('/v1/sbg/business/me/check').set(bearer(b.token)).expect(201);
    for (const id of docs) await http().post(`/v1/sbg/entities/${b.entityId}/documents/${id}/verify`).set(bearer(amina)).send({}).expect(201);
    await http().post(`/v1/sbg/businesses/${b.entityId}/approve`).set(bearer(amina)).send({}).expect(201);
    await http().post(`/v1/sbg/businesses/${b.entityId}/approve`).set(bearer(brian)).send({}).expect(201);
  }

  /** A load posted by a business; delivered (by `carrier` where given) when `delivered`. */
  async function aLoad(token: string, delivered: boolean, carrierDid?: string): Promise<string> {
    const posted = (
      await http()
        .post('/v1/sbg/dispatch/freight')
        .set(bearer(token))
        .send({ description: 'Cement, 40 bags', pickupLocation: { lat: -1.42, lng: 36.95 }, pickupLabel: 'Athi River works', destLabel: 'Ruiru yard', destLocation: { lat: -1.15, lng: 36.96 }, weightKg: 2000, packaging: 'bagged', packages: 40, pickupCountry: 'KE', destCountry: 'KE' })
        .expect(201)
    ).body;
    if (delivered) {
      const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
      const at = new Date().toISOString();
      store.set(posted.freightId, { ...store.get(posted.freightId), status: 'delivered', claimedBy: `did:glos:drv-dir-${tag}`, claimedAt: at, pickedUpAt: at, deliveredAt: at, proofOfDelivery: { receiverName: 'Grace at the yard', at }, ...(carrierDid ? { carrierDid } : {}) });
    }
    return posted.freightId;
  }

  const kenya = async () => (await http().get('/v1/sbg/directory/KE').expect(200)).body as { name: string; entries: Array<{ handle: string; name: string; since: string; kinds: string[]; words?: string; says?: { clears: string[]; places: string[] }; seen: Record<string, number>; checks: Array<{ paper: string; what: string; at: string }>; contact?: Record<string, string> }>; basis: string };
  const ours = async () => (await kenya()).entries.filter((e) => e.name.endsWith(tag));

  it('lists checked forwarders, clearing agents and depots by country, alphabetically — their words beside what we saw — and a firm may leave', async () => {
    const zebra = await aBusiness('Zebra Forwarders', ['expeditor']);
    const acacia = await aBusiness('Acacia Clearing', ['clearing_agent']);
    const depot = await aBusiness('Mombasa Empty Depot', ['depot']);
    const unchecked = await aBusiness('Unchecked Forwarders', ['expeditor']);
    const shipper = await aBusiness('Only A Shipper', ['shipper']);
    for (const b of [zebra, acacia, depot, shipper]) await checked(b);

    // Read without an account; alphabetical; nobody unchecked, nobody who does none of the listed work.
    const listed = await ours();
    expect(listed.map((e) => e.name)).toEqual([acacia.name, depot.name, zebra.name]);
    expect(listed.map((e) => e.kinds)).toEqual([['clearing_agent'], ['depot'], ['forwarder']]);
    const z = listed.find((e) => e.name === zebra.name)!;
    expect(z.handle).toMatch(/^zebra-forwarders/);
    // The checks are named with their dates, never scored.
    expect(z.checks.map((c) => c.what).sort()).toEqual(['certificate of incorporation', 'representative id']);
    expect(z.checks.map((c) => c.paper).sort()).toEqual(['certificate_of_incorporation', 'representative_id']);
    expect(z.checks[0].at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(z.seen).toEqual({});
    expect(z.since).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // A paper not yet checked is not named among the checks.
    await http().post(`/v1/sbg/entities/${zebra.entityId}/documents`).set(bearer(zebra.token)).send({ kind: 'licence', title: 'Freight forwarding licence', dataUrl: pdf(`${zebra.entityId}-licence`) }).expect(201);
    // Nor a container's paper, checked though it is: it belongs to one consignment, not to who the firm is.
    const packing = (await http().post(`/v1/sbg/entities/${zebra.entityId}/documents`).set(bearer(zebra.token)).send({ kind: 'packing_list', title: 'Packing list', dataUrl: pdf(`${zebra.entityId}-packing`) }).expect(201)).body.documentId;
    await http().post(`/v1/sbg/entities/${zebra.entityId}/documents/${packing}/verify`).set(bearer(amina)).send({}).expect(201);
    // What we saw of a forwarder: the loads it posted that were delivered — counted, not the ones still open.
    await aLoad(zebra.token, true);
    await aLoad(zebra.token, false);
    const z2 = (await ours()).find((e) => e.name === zebra.name)!;
    expect(z2.seen).toEqual({ arranged: 1 });
    expect(z2.checks.map((c) => c.what).sort()).toEqual(['certificate of incorporation', 'representative id']);
    expect((await kenya()).basis).toMatch(/alphabetical order\. Not a ranking/);
    const index = (await http().get('/v1/sbg/directory').expect(200)).body as { countries: Array<{ country: string; name: string; total: number; forwarder: number; clearing_agent: number; depot: number; haulier: number }> };
    expect(index.countries.find((c) => c.country === 'KE')).toMatchObject({ name: 'Kenya', forwarder: expect.any(Number), clearing_agent: expect.any(Number), depot: expect.any(Number) });
    // Its counts are the country page's own, kind by kind.
    const all = (await kenya()).entries;
    expect(index.countries.find((c) => c.country === 'KE')).toMatchObject({ total: all.length, forwarder: all.filter((e) => e.kinds.includes('forwarder')).length, clearing_agent: all.filter((e) => e.kinds.includes('clearing_agent')).length, depot: all.filter((e) => e.kinds.includes('depot')).length, haulier: all.filter((e) => e.kinds.includes('haulier')).length });
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect((await http().get('/v1/sbg/directory/KEN')).status).toBe(400);

    // Its own line, and its own contact entry — said as its own; an owner's to change, never staff's.
    const mine = (await http().post('/v1/sbg/business/me/directory').set(bearer(zebra.token)).send({ listed: true, words: 'Air and sea forwarding from Nairobi, door to door.' }).expect(201)).body;
    expect(mine).toMatchObject({ listed: true, eligible: true, country: 'KE', kinds: ['forwarder'], words: 'Air and sea forwarding from Nairobi, door to door.' });
    expect((await http().post('/v1/sbg/business/me/directory').set(bearer(setupKey)).send({ listed: false })).status).toBe(403);
    const booker = await aPerson();
    await http().post('/v1/sbg/business/me/members').set(bearer(zebra.token)).send({ phone: booker.phone, name: 'Bekele Booker', role: 'booker' }).expect(201);
    const invite = (await http().get('/v1/sbg/business/mine').set(bearer(booker.token)).expect(200)).body.items.find((i: { entityId: string }) => i.entityId === zebra.entityId);
    await http().post(`/v1/sbg/business/invitations/${invite.memberId}/accept`).set(bearer(booker.token)).expect(201);
    const bookerBiz = (await http().post(`/v1/sbg/business/${zebra.entityId}/session`).set(bearer(booker.token)).expect(201)).body.token.access_token as string;
    expect((await http().get('/v1/sbg/business/me/directory').set(bearer(bookerBiz)).expect(200)).body).toMatchObject({ listed: true, words: 'Air and sea forwarding from Nairobi, door to door.' });
    expect((await http().post('/v1/sbg/business/me/directory').set(bearer(bookerBiz)).send({ listed: false })).status).toBe(403);
    app.get(ContactCardService).set(zebra.entityId, { phone: '+254 700 111 222', email: 'desk@zebra.example', website: 'https://zebra.example' }, 'Wanjiku');
    expect((await ours()).find((e) => e.name === zebra.name)).toMatchObject({ words: 'Air and sea forwarding from Nairobi, door to door.', contact: { phone: '+254 700 111 222', email: 'desk@zebra.example', website: 'https://zebra.example' } });

    // A clearing agent: what it says it clears beside what we saw of it — appointed on an import.
    app.get(ImportService).setOffer(acacia.entityId, { specialisms: ['vehicles'], places: ['Mombasa'], words: 'Vehicles at Mombasa, ten years.' }, 'Juma');
    const importer = await aBusiness('Thika Motors', ['importer']);
    const made = (await http().post('/v1/sbg/imports').set(bearer(importer.token)).send({ goodsDescription: 'Pickups, 2', originCountry: 'JP', destCountry: 'KE', destPort: 'Mombasa' }).expect(201)).body;
    await http().post(`/v1/sbg/imports/${made.importId}/appoint`).set(bearer(importer.token)).send({ agentEntityId: acacia.entityId }).expect(201);
    expect((await ours()).find((e) => e.name === acacia.name)).toMatchObject({ says: { clears: ['vehicles'], places: ['Mombasa'] }, words: 'Vehicles at Mombasa, ten years.', seen: { appointed: 1, cleared: 0 } });
    const second = (await http().post('/v1/sbg/imports').set(bearer(importer.token)).send({ goodsDescription: 'Tyres', originCountry: 'CN', destCountry: 'KE', destPort: 'Mombasa' }).expect(201)).body;
    await http().post(`/v1/sbg/imports/${second.importId}/appoint`).set(bearer(importer.token)).send({ agentEntityId: depot.entityId }).expect(201);
    expect((await ours()).find((e) => e.name === depot.name)).toMatchObject({ kinds: ['clearing_agent', 'depot'], seen: { appointed: 1, cleared: 0 } });

    // Off the directory — and on again.
    expect((await http().post('/v1/sbg/business/me/directory').set(bearer(zebra.token)).send({ listed: false }).expect(201)).body).toMatchObject({ listed: false, why: 'You took your business off the directory.', words: 'Air and sea forwarding from Nairobi, door to door.' });
    expect((await ours()).map((e) => e.name)).not.toContain(zebra.name);
    // Its line saved alone leaves it off.
    expect((await http().post('/v1/sbg/business/me/directory').set(bearer(zebra.token)).send({ words: 'Air and sea forwarding from Nairobi, door to door.' }).expect(201)).body.listed).toBe(false);
    await http().post('/v1/sbg/business/me/directory').set(bearer(zebra.token)).send({ listed: true }).expect(201);
    expect((await ours()).find((e) => e.name === zebra.name)?.words).toBe('Air and sea forwarding from Nairobi, door to door.');
    // An empty line clears it — and a clearing agent's own offer words show where it wrote no line of its own.
    expect((await http().post('/v1/sbg/business/me/directory').set(bearer(zebra.token)).send({ listed: true, words: '  ' }).expect(201)).body.words).toBeUndefined();
    expect((await ours()).find((e) => e.name === zebra.name)?.words).toBeUndefined();
    await http().post('/v1/sbg/business/me/directory').set(bearer(acacia.token)).send({ listed: true, words: 'Cars and machinery,   cleared at Mombasa.' }).expect(201);
    expect((await ours()).find((e) => e.name === acacia.name)?.words).toBe('Cars and machinery, cleared at Mombasa.');

    // Why a firm is not shown, in its own view.
    expect((await http().get('/v1/sbg/business/me/directory').set(bearer(unchecked.token)).expect(200)).body).toMatchObject({ listed: false, eligible: false, why: 'Your business is shown once two of our staff have checked its papers.' });
    await http().patch('/v1/sbg/business/me').set(bearer(zebra.token)).send({ name: `Zebra Forwarding ${tag}` }).expect(200);
    expect((await ours()).map((e) => e.name).filter((n) => n.startsWith('Zebra'))).toEqual([]);
    expect((await http().get('/v1/sbg/business/me/directory').set(bearer(zebra.token)).expect(200)).body).toMatchObject({ listed: false, eligible: false, why: 'Your business is shown once two of our staff have checked its papers.' });

    const notListed = (await http().get('/v1/sbg/business/me/directory').set(bearer(shipper.token)).expect(200)).body;
    expect(notListed).toMatchObject({ listed: false, eligible: false, kinds: [] });
    expect(notListed.why).toMatch(/^The directory lists forwarders, clearing agents, container depots and hauliers/);
  }, 120_000);

  it('an active fleet is a haulier, showing only the contact it ticks; a fleet still being checked is not shown', async () => {
    const managers = app.get(FleetManagerService);
    const n = digits();
    const register = (name: string) => {
      const m = managers.register({
        companyName: `${name} ${tag}`, contactPhone: `+2548${digits()}1`.slice(0, 13), ownerFullName: 'O O', ownerNationalId: `MGR-DIR-${digits()}`, location: { lat: -1.2921, lng: 36.8219 },
        requirements: { businessRegistrationNo: `BRN-DIR-${digits()}`, transportOperatorLicence: `TOL-DIR-${digits()}`, taxId: `TAX-DIR-${digits()}` },
      });
      return m;
    };
    const rift = register('Baobab Haulage');
    managers.submitKyc(rift.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(rift.did, true);
    managers.recordBond(rift.did);
    const pending = register('Pending Haulage');
    expect(n).toBeTruthy();
    const office = (await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: rift.did, tenant: rift.did, type: 'client_credentials' }).expect(201)).body.access_token;
    const other = (await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: pending.did, tenant: pending.did, type: 'client_credentials' }).expect(201)).body.access_token;

    const entry = async () => (await ours()).find((e) => e.name === `Baobab Haulage ${tag}`);
    expect(managers.get(rift.did).status).toBe('ACTIVE');
    // Among the companies, alphabetically — a fleet is not put after them.
    expect((await ours()).map((e) => e.name)).toEqual([`Acacia Clearing ${tag}`, `Baobab Haulage ${tag}`, `Mombasa Empty Depot ${tag}`]);
    expect(await entry()).toMatchObject({ kinds: ['haulier'], seen: {}, checks: [{ paper: 'fleet_papers', what: 'business registration, operator licence and the owner’s identity, put on record', at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }] });
    const sender = await aBusiness('Cement Sender', ['shipper']);
    await aLoad(sender.token, true, rift.did);
    expect((await entry())!.seen).toEqual({ delivered: 1 });
    expect((await entry())!.contact).toBeUndefined();
    expect((await ours()).map((e) => e.name)).not.toContain(`Pending Haulage ${tag}`);
    expect((await http().get(`/v1/sbg/fleet/managers/${pending.did}/directory`).set(bearer(other)).expect(200)).body).toMatchObject({ eligible: false, why: 'Your fleet is shown once our staff have checked its papers and it is active.' });

    // Its line and the contact it ticks — the fleet office's to say: not staff's, not another fleet's.
    const path = `/v1/sbg/fleet/managers/${rift.did}/directory`;
    expect((await http().post(path).set(bearer(office)).send({ listed: true, email: 'not-an-email' })).status).toBe(400);
    expect((await http().post(path).set(bearer(setupKey)).send({ listed: true })).status).toBe(403);
    expect((await http().post(path).set(bearer(other)).send({ listed: true })).status).toBe(403);
    await http().get(path).set(bearer(setupKey)).expect(200);
    const said = (await http().post(path).set(bearer(office)).send({ listed: true, words: 'Flatbeds and box trucks, Nairobi to Kampala.', phone: '+254 711 000 333', website: 'https://rift.example' }).expect(201)).body;
    expect(said).toMatchObject({ listed: true, country: 'KE', words: 'Flatbeds and box trucks, Nairobi to Kampala.', contact: { phone: '+254 711 000 333', website: 'https://rift.example' } });
    expect(await entry()).toMatchObject({ words: 'Flatbeds and box trucks, Nairobi to Kampala.', contact: { phone: '+254 711 000 333', website: 'https://rift.example' } });
    expect((await entry())!.contact!.email).toBeUndefined();
    // The country's marker: the middle of its firms' pins, rounded — never one firm's own spot.
    const ke = ((await http().get('/v1/sbg/directory').expect(200)).body.countries as Array<{ country: string; at?: { lat: number; lng: number } }>).find((c) => c.country === 'KE')!;
    expect(ke.at).toEqual({ lat: -1.3, lng: 36.8 });

    expect((await http().post(path).set(bearer(office)).send({ listed: true, website: 'rift.example' })).status).toBe(400);
    expect((await http().post(path).set(bearer(office)).send({ listed: false }).expect(201)).body).toMatchObject({ listed: false, why: 'You took your fleet off the directory.', words: 'Flatbeds and box trucks, Nairobi to Kampala.', contact: { phone: '+254 711 000 333', website: 'https://rift.example' } });
    expect(await entry()).toBeUndefined();
    expect((await http().post(path).set(bearer(office)).send({ website: 'https://rift.example' }).expect(201)).body.listed).toBe(false);
    await http().post(path).set(bearer(office)).send({ listed: true, phone: '' }).expect(201);
    expect(await entry()).toMatchObject({ words: 'Flatbeds and box trucks, Nairobi to Kampala.', contact: { website: 'https://rift.example' } });
    expect((await entry())!.contact!.phone).toBeUndefined();
  }, 60_000);

  it('inside the apps: the firms to choose, each with its id; a business asks a haulier for a contract — once a week, ten a day', async () => {
    const managers = app.get(FleetManagerService);
    const aFleet = (name: string, active = true) => {
      const m = managers.register({
        companyName: `${name} ${tag}`, contactPhone: `+2548${digits()}1`.slice(0, 13), ownerFullName: 'O O', ownerNationalId: `MGR-ASK-${digits()}`, location: { lat: -1.28, lng: 36.82 },
        requirements: { businessRegistrationNo: `BRN-ASK-${digits()}`, transportOperatorLicence: `TOL-ASK-${digits()}`, taxId: `TAX-ASK-${digits()}` },
      });
      if (active) {
        managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
        managers.decideKyc(m.did, true);
        managers.recordBond(m.did);
      }
      return m;
    };
    const fleetToken = async (did: string) => (await http().post('/v1/auth/token').send({ role: 'fleet_manager', did, tenant: did, type: 'client_credentials' }).expect(201)).body.access_token as string;

    // A company that only SAID what it clears is a clearing agent too — as the agent finder always had it.
    const offerOnly = await aBusiness('Offer Only Agents', ['shipper']);
    await checked(offerOnly);
    app.get(ImportService).setOffer(offerOnly.entityId, { specialisms: ['perishables'], places: ['JKIA'] }, 'Ruth');
    const hiddenAgent = await aBusiness('Hidden Clearing', ['clearing_agent']);
    await checked(hiddenAgent);
    await http().post('/v1/sbg/business/me/directory').set(bearer(hiddenAgent.token)).send({ listed: false }).expect(201);
    const asker = await aBusiness('Asking Importer', ['importer', 'clearing_agent']);
    await checked(asker);

    const choose = async (token: string, kind: string) => (await http().get(`/v1/sbg/directory/choose?kind=${kind}`).set(bearer(token)).expect(200)).body as { items: Array<{ id: string; name: string; kinds: string[]; askedAt?: string; handle: string }>; basis: string };
    const named = (items: Array<{ name: string }>) => items.map((i) => i.name).filter((n) => n.endsWith(tag));
    const agents = await choose(asker.token, 'clearing_agent');
    // Never itself; never one that took itself off; every country; alphabetical; the basis said.
    expect(named(agents.items)).toContain(offerOnly.name);
    expect(named(agents.items)).not.toContain(hiddenAgent.name);
    expect(named(agents.items)).not.toContain(asker.name);
    expect(named(agents.items)).toEqual([...named(agents.items)].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    expect(agents.basis).toMatch(/alphabetical order\. Not a ranking/);
    expect(agents.items.find((i) => i.name === offerOnly.name)).toMatchObject({ id: offerOnly.entityId, kinds: ['clearing_agent'], says: { clears: ['perishables'], places: ['JKIA'] } });
    // Our staff see every firm, the asking one included; nobody signed out does.
    expect(named((await choose(setupKey, 'clearing_agent')).items)).toContain(asker.name);
    expect((await http().get('/v1/sbg/directory/choose?kind=clearing_agent')).status).toBe(401);
    expect((await http().get('/v1/sbg/directory/choose?kind=pilot').set(bearer(asker.token))).status).toBe(400);
    expect((await http().get('/v1/sbg/directory/choose').set(bearer(asker.token))).status).toBe(400);
    // Several kinds at once.
    const both = await choose(asker.token, 'forwarder,clearing_agent');
    expect(named(both.items)).toEqual(expect.arrayContaining([offerOnly.name]));
    expect(both.items.every((i) => i.kinds.includes('forwarder') || i.kinds.includes('clearing_agent'))).toBe(true);
    // The id is what an appointment names.
    const made = (await http().post('/v1/sbg/imports').set(bearer(asker.token)).send({ goodsDescription: 'Avocados, chilled', originCountry: 'TZ', destCountry: 'KE', destPort: 'Mombasa' }).expect(201)).body;
    await http().post(`/v1/sbg/imports/${made.importId}/appoint`).set(bearer(asker.token)).send({ agentEntityId: agents.items.find((i) => i.name === offerOnly.name)!.id }).expect(201);

    // A haulier, found and asked. Its bell says who asks, where to read who it is, and what to do — nothing is agreed.
    const kudu = aFleet('Kudu Haulage');
    const pending = aFleet('Pending Kudu', false);
    const hauliers = await choose(asker.token, 'haulier');
    expect(hauliers.items.find((i) => i.name === `Kudu Haulage ${tag}`)).toMatchObject({ id: kudu.did, kinds: ['haulier'] });
    expect(hauliers.items.find((i) => i.name === `Kudu Haulage ${tag}`)!.askedAt).toBeUndefined();
    const asked = (await http().post(`/v1/sbg/business/me/directory/ask/${kudu.did}`).set(bearer(asker.token)).expect(201)).body;
    expect(asked).toMatchObject({ fleetName: `Kudu Haulage ${tag}`, askedAt: expect.stringMatching(/^\d{4}-/) });
    const bell = (await http().get('/v1/sbg/notifications/inbox').set(bearer(await fleetToken(kudu.did))).expect(200)).body;
    const told = ((bell.items ?? bell) as Array<{ kind: string; title: string; body: string }>).find((n) => n.kind === 'contract_asked');
    const askerHandle = agents.items.length ? (await http().get('/v1/sbg/business/me/directory').set(bearer(asker.token)).expect(200)).body.handle : '';
    expect(told?.title).toBe(`${asker.name} asks to carry under a contract with you`);
    expect(told?.body).toContain(`, in Kenya, found you in the logistics directory`);
    expect(told?.body).toContain(`@${askerHandle}`);
    expect(told?.body).toContain('Orders › Contracts');
    expect(told?.body).toContain(`it is offered to ${asker.name} in its app, and an owner there accepts it — no code. Nothing is agreed until then.`);
    expect((await choose(asker.token, 'haulier')).items.find((i) => i.name === `Kudu Haulage ${tag}`)!.askedAt).toBe(asked.askedAt);
    // Once a week — refused before anything is written.
    const again = await http().post(`/v1/sbg/business/me/directory/ask/${kudu.did}`).set(bearer(asker.token));
    expect(again.status).toBe(400);
    expect(again.body.detail).toMatch(/^You asked Kudu Haulage .* on \d{4}-\d{2}-\d{2}\. You can ask again from \d{4}-\d{2}-\d{2}\.$/);
    // Only a haulier in the directory; only an owner; only a business our staff checked.
    expect((await http().post(`/v1/sbg/business/me/directory/ask/${pending.did}`).set(bearer(asker.token))).status).toBe(404);
    expect((await http().post('/v1/sbg/business/me/directory/ask/did:glos:nobody').set(bearer(asker.token))).status).toBe(404);
    const shy = aFleet('Shy Haulage');
    await http().post(`/v1/sbg/fleet/managers/${shy.did}/directory`).set(bearer(await fleetToken(shy.did))).send({ listed: false }).expect(201);
    expect((await http().post(`/v1/sbg/business/me/directory/ask/${shy.did}`).set(bearer(asker.token))).status).toBe(404);
    const unchecked = await aBusiness('Unchecked Asker', ['shipper']);
    expect((await http().post(`/v1/sbg/business/me/directory/ask/${kudu.did}`).set(bearer(unchecked.token))).status).toBe(400);
    const booker = await aPerson();
    await http().post('/v1/sbg/business/me/members').set(bearer(asker.token)).send({ phone: booker.phone, name: 'Bea Booker', role: 'booker' }).expect(201);
    const invite = (await http().get('/v1/sbg/business/mine').set(bearer(booker.token)).expect(200)).body.items.find((i: { entityId: string }) => i.entityId === asker.entityId);
    await http().post(`/v1/sbg/business/invitations/${invite.memberId}/accept`).set(bearer(booker.token)).expect(201);
    const bookerBiz = (await http().post(`/v1/sbg/business/${asker.entityId}/session`).set(bearer(booker.token)).expect(201)).body.token.access_token as string;
    const other = aFleet('Other Haulage');
    expect((await http().post(`/v1/sbg/business/me/directory/ask/${other.did}`).set(bearer(bookerBiz))).status).toBe(403);
    expect((await http().post(`/v1/sbg/business/me/directory/ask/${other.did}`).set(bearer(setupKey))).status).toBe(403);
    // Ten hauliers a day.
    for (let i = 0; i < 9; i += 1) await http().post(`/v1/sbg/business/me/directory/ask/${aFleet(`Day Haulage ${i}`).did}`).set(bearer(asker.token)).expect(201);
    const eleventh = await http().post(`/v1/sbg/business/me/directory/ask/${other.did}`).set(bearer(asker.token));
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.detail).toBe('You asked 10 hauliers today. Ask more tomorrow.');

    // On the map once one of its own places has a pin.
    expect((await http().get('/v1/sbg/business/me/directory').set(bearer(asker.token)).expect(200)).body.onMap).toBe(false);
    await http().post(`/v1/sbg/entities/${asker.entityId}/sites`).set(bearer(asker.token)).send({ kind: 'delivery', name: 'Thika Road warehouse', location: { lat: -1.22, lng: 36.89 } }).expect(201);
    expect((await http().get('/v1/sbg/business/me/directory').set(bearer(asker.token)).expect(200)).body.onMap).toBe(true);
    expect((await http().get(`/v1/sbg/fleet/managers/${kudu.did}/directory`).set(bearer(await fleetToken(kudu.did))).expect(200)).body.onMap).toBe(true);
  }, 120_000);

  it('a haulier asked records a contract offered to the business that asked: accepted or declined in its app, each side told', async () => {
    const managers = app.get(FleetManagerService);
    const m = managers.register({
      companyName: `Eland Haulage ${tag}`, contactPhone: `+2548${digits()}1`.slice(0, 13), ownerFullName: 'O O', ownerNationalId: `MGR-OFF-${digits()}`, location: { lat: -1.28, lng: 36.82 },
      requirements: { businessRegistrationNo: `BRN-OFF-${digits()}`, transportOperatorLicence: `TOL-OFF-${digits()}`, taxId: `TAX-OFF-${digits()}` },
    });
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    const office = (await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    const shipper = await aBusiness('Offered Shipper', ['shipper']);
    await checked(shipper);
    const stranger = await aBusiness('Stranger Shipper', ['shipper']);
    await checked(stranger);
    const contracts = `/v1/sbg/fleet/managers/${m.did}/contracts`;
    const bellOf = async (token: string, kind: string) => (((await http().get('/v1/sbg/notifications/inbox').set(bearer(token)).expect(200)).body.items ?? []) as Array<{ kind: string; title: string; body: string }>).filter((n) => n.kind === kind);

    // Offered only to a business that asked.
    expect((await http().post(contracts).set(bearer(office)).send({ shipperName: shipper.name, askedBy: shipper.entityId })).status).toBe(400);
    await http().post(`/v1/sbg/business/me/directory/ask/${m.did}`).set(bearer(shipper.token)).expect(201);
    const offered = (await http().post(contracts).set(bearer(office)).send({ shipperName: shipper.name, reference: 'SEASON-26', startsOn: '2026-11-01', endsOn: '2027-03-31', askedBy: shipper.entityId }).expect(201)).body;
    expect(offered.shipper).toMatchObject({ name: shipper.name, offeredTo: shipper.entityId });
    expect(offered.shipper.entityId).toBeUndefined();
    // The business is told in its bell, and sees it under Carriers — not yet one of its contracts.
    const told = await bellOf(shipper.token, 'contract_offered');
    expect(told[0]?.title).toBe(`Eland Haulage ${tag} offers you a carriage contract`);
    expect(told[0]?.body).toBe(`You asked Eland Haulage ${tag} for a contract through the logistics directory, and it recorded one with you, reference SEASON-26, from 2026-11-01 until 2027-03-31. Accept it under Carriers to send it loads straight away, or decline it. Nothing is linked until an owner accepts.`);
    const list = (await http().get('/v1/sbg/business/me/contracts').set(bearer(shipper.token)).expect(200)).body;
    expect(list.offers.map((c: { contractId: string }) => c.contractId)).toEqual([offered.contractId]);
    expect(list.items).toEqual([]);
    // Nobody else answers it: another business, a booker, our staff.
    expect((await http().post(`/v1/sbg/business/me/contracts/${offered.contractId}/accept`).set(bearer(stranger.token))).status).toBe(404);
    expect((await http().get('/v1/sbg/business/me/contracts').set(bearer(stranger.token)).expect(200)).body.offers).toEqual([]);
    const booker = await aPerson();
    await http().post('/v1/sbg/business/me/members').set(bearer(shipper.token)).send({ phone: booker.phone, name: 'Ben Booker', role: 'booker' }).expect(201);
    const invite = (await http().get('/v1/sbg/business/mine').set(bearer(booker.token)).expect(200)).body.items.find((i: { entityId: string }) => i.entityId === shipper.entityId);
    await http().post(`/v1/sbg/business/invitations/${invite.memberId}/accept`).set(bearer(booker.token)).expect(201);
    const bookerBiz = (await http().post(`/v1/sbg/business/${shipper.entityId}/session`).set(bearer(booker.token)).expect(201)).body.token.access_token as string;
    expect((await http().post(`/v1/sbg/business/me/contracts/${offered.contractId}/accept`).set(bearer(bookerBiz))).status).toBe(403);
    expect((await http().post(`/v1/sbg/business/me/contracts/${offered.contractId}/decline`).set(bearer(bookerBiz))).status).toBe(403);
    expect((await http().post(`/v1/sbg/business/me/contracts/${offered.contractId}/accept`).set(bearer(setupKey))).status).toBe(403);

    // Accepted by an owner: linked, no code; the fleet told.
    const accepted = (await http().post(`/v1/sbg/business/me/contracts/${offered.contractId}/accept`).set(bearer(shipper.token)).expect(201)).body;
    expect(accepted.shipper).toMatchObject({ name: shipper.name, entityId: shipper.entityId, linkedBy: 'Wanjiku' });
    expect(accepted.shipper.offeredTo).toBeUndefined();
    expect((await bellOf(office, 'contract_answered'))[0]).toMatchObject({ title: `${shipper.name} accepted your contract`, body: `${shipper.name} accepted the carriage contract SEASON-26 you offered it. Its orders under it now come straight to you.` });
    const after = (await http().get('/v1/sbg/business/me/contracts').set(bearer(shipper.token)).expect(200)).body;
    expect(after.items.map((c: { contractId: string }) => c.contractId)).toEqual([offered.contractId]);
    expect(after.offers).toEqual([]);
    expect((await http().post(`/v1/sbg/business/me/contracts/${offered.contractId}/accept`).set(bearer(shipper.token))).status).toBe(404);

    // Another, declined: the fleet keeps it, unlinked, and is told.
    const second = (await http().post(contracts).set(bearer(office)).send({ shipperName: shipper.name, askedBy: shipper.entityId }).expect(201)).body;
    const declined = (await http().post(`/v1/sbg/business/me/contracts/${second.contractId}/decline`).set(bearer(shipper.token)).expect(201)).body;
    expect(declined.shipper.offeredTo).toBeUndefined();
    expect(declined.shipper.entityId).toBeUndefined();
    expect(declined.shipper.declinedAt).toMatch(/^\d{4}-/);
    expect((await bellOf(office, 'contract_answered')).map((n) => n.title)).toContain(`${shipper.name} declined your contract`);
    expect((await http().post(`/v1/sbg/business/me/contracts/${second.contractId}/accept`).set(bearer(shipper.token))).status).toBe(404);
    // One the fleet ended before it was answered cannot be accepted.
    const third = (await http().post(contracts).set(bearer(office)).send({ shipperName: shipper.name, askedBy: shipper.entityId }).expect(201)).body;
    await http().post(`${contracts}/${third.contractId}/end`).set(bearer(office)).send({}).expect(201);
    expect((await http().get('/v1/sbg/business/me/contracts').set(bearer(shipper.token)).expect(200)).body.offers).toEqual([]);
    const late = await http().post(`/v1/sbg/business/me/contracts/${third.contractId}/accept`).set(bearer(shipper.token));
    expect(late.status).toBe(400);
    expect(late.body.detail).toBe(`Eland Haulage ${tag} ended this contract before you answered`);
  }, 120_000);

  it('searches every country at once: every word found somewhere on the entry, accents and case aside, alphabetical', async () => {
    const dar = await aBusiness('Kilwa Clearing', ['clearing_agent'], 'TZ');
    await checked(dar);
    app.get(ImportService).setOffer(dar.entityId, { specialisms: ['perishables'], places: ['Dar es Salaam'], words: 'Fish and fruit through the port, since 2011.' }, 'Neema');
    const search = async (query: string) => (await http().get(`/v1/sbg/directory/search?${query}`).expect(200)).body as { entries: Array<{ name: string; country: string; kinds: string[] }>; total: number; basis: string };
    const ours = (r: { entries: Array<{ name: string }> }) => r.entries.map((e) => e.name).filter((n) => n.endsWith(tag));

    // Without signing in; by name across countries, alphabetical.
    const all = await search(`q=${tag}`);
    expect(ours(all)).toContain(dar.name);
    expect(ours(all)).toEqual([...ours(all)].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    expect(new Set(all.entries.filter((e) => e.name.endsWith(tag)).map((e) => e.country))).toEqual(new Set(['KE', 'TZ']));
    expect(all.basis).toMatch(/alphabetical order\. Not a ranking/);
    // By what it says it clears, where, its own words, its country's name — every word must be found.
    expect(ours(await search(`q=perishables+${tag}`))).toEqual([dar.name, `Offer Only Agents ${tag}`]);
    expect(ours(await search(`q=SALAAM+${tag}`))).toEqual([dar.name]);
    expect(ours(await search(`q=fish+fruit+${tag}`))).toEqual([dar.name]);
    expect(ours(await search(`q=tanzania+${tag}`))).toEqual([dar.name]);
    expect(ours(await search(`q=Tanzan%C3%ADa+${tag}`))).toEqual([dar.name]);
    expect(ours(await search(`q=fish+mombasa+${tag}`))).toEqual([]);
    // By what it does, alone or with words; a haulier is found by "haulier".
    expect((await search('kind=haulier')).entries.every((e) => e.kinds.includes('haulier'))).toBe(true);
    expect(ours(await search(`kind=clearing_agent&q=${tag}`))).toContain(dar.name);
    expect(ours(await search(`kind=depot&q=kilwa+${tag}`))).toEqual([]);
    expect(ours(await search(`q=haulier+baobab+${tag}`))).toEqual([`Baobab Haulage ${tag}`]);
    // A firm that took itself off is not found.
    await http().post('/v1/sbg/business/me/directory').set(bearer(dar.token)).send({ listed: false }).expect(201);
    expect(ours(await search(`q=kilwa+${tag}`))).toEqual([]);
    // Something to look for is asked; what a firm does is one of four.
    expect((await http().get('/v1/sbg/directory/search')).status).toBe(400);
    expect((await http().get('/v1/sbg/directory/search?q=%20%20')).status).toBe(400);
    expect((await http().get('/v1/sbg/directory/search?kind=pilot')).status).toBe(400);
  }, 120_000);
});

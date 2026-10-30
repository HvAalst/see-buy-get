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

  async function aBusiness(name: string, activities: string[]): Promise<{ token: string; entityId: string; name: string }> {
    const person = (await aPerson()).token;
    const made = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${name} ${tag}`, country: 'KE', registrationNo: `DIR-${digits()}`, activities, yourName: 'Wanjiku' }).expect(201)).body;
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
    expect(mine).toMatchObject({ listed: true, eligible: true, kinds: ['forwarder'], words: 'Air and sea forwarding from Nairobi, door to door.' });
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
    expect(said).toMatchObject({ listed: true, words: 'Flatbeds and box trucks, Nairobi to Kampala.', contact: { phone: '+254 711 000 333', website: 'https://rift.example' } });
    expect(await entry()).toMatchObject({ words: 'Flatbeds and box trucks, Nairobi to Kampala.', contact: { phone: '+254 711 000 333', website: 'https://rift.example' } });
    expect((await entry())!.contact!.email).toBeUndefined();
    // The country's marker: the middle of its firms' pins, rounded — never one firm's own spot.
    const ke = ((await http().get('/v1/sbg/directory').expect(200)).body.countries as Array<{ country: string; at?: { lat: number; lng: number } }>).find((c) => c.country === 'KE')!;
    expect(ke.at).toEqual({ lat: -1.3, lng: 36.8 });

    expect((await http().post(path).set(bearer(office)).send({ listed: true, website: 'rift.example' })).status).toBe(400);
    expect((await http().post(path).set(bearer(office)).send({ listed: false }).expect(201)).body).toMatchObject({ listed: false, why: 'You took your fleet off the directory.', words: 'Flatbeds and box trucks, Nairobi to Kampala.', contact: { phone: '+254 711 000 333', website: 'https://rift.example' } });
    expect(await entry()).toBeUndefined();
    await http().post(path).set(bearer(office)).send({ listed: true, phone: '' }).expect(201);
    expect(await entry()).toMatchObject({ words: 'Flatbeds and box trucks, Nairobi to Kampala.', contact: { website: 'https://rift.example' } });
    expect((await entry())!.contact!.phone).toBeUndefined();
  }, 60_000);
});

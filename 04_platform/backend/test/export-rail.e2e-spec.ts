import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AGREED } from './agreed';

/**
 * THE RAILWAY’S NOTE ON AN EXPORT (the user, 2026-10-28: "for now we hold the note but we should be able to see whether it
 * is valid"). Where the box goes to the port by rail, the railway issues the note; the exporter, or its clearing agent, keeps
 * it — checked against the law of its lane and matched to the box. Its own file: each sign-up asks an email code, and a
 * file may ask twenty in fifteen minutes.
 */
describe('the railway’s note on an export, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const H = 3_600_000;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    operator = (await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token;
  });

  afterAll(async () => {
    await app?.close();
  });

  /** A tea exporter in Nairobi, with its warehouse, the Mombasa terminal and the empty depot on its list of places. */
  async function anExporter(activities: string[] = ['shipper'], called = 'Kericho Tea'): Promise<{ token: string; entityId: string; name: string; loading: string; terminal: string; depot: string }> {
    const phone = `+2547${digits()}5`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `export-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    const made = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${called} ${digits()}`, country: 'KE', registrationNo: `EXP-${digits()}`, activities, yourName: 'Wanjiku' }).expect(201)).body;
    const token = made.token.access_token as string;
    const entityId = made.business.entityId as string;
    const site = async (kind: string, name: string, location: { lat: number; lng: number }) => (await http().post(`/v1/sbg/entities/${entityId}/sites`).set(bearer(token)).send({ kind, name, location }).expect(201)).body.siteId as string;
    return {
      token,
      entityId,
      name: made.business.name as string,
      loading: await site('loading', 'Kericho warehouse', { lat: -1.32, lng: 36.85 }),
      terminal: await site('port', 'Kipevu container terminal', { lat: -4.05, lng: 39.65 }),
      depot: await site('port', 'Embakasi empty depot', { lat: -1.31, lng: 36.9 }),
    };
  }

  const booking = (cutoff: number) => ({ reference: `MBA${digits()}`, bookedWith: 'forwarder', partyName: 'Pwani Forwarders', vessel: 'MSC Nairobi', voyage: '044E', gateCutoffAt: new Date(cutoff).toISOString(), vgmCutoffAt: new Date(cutoff - 2 * H).toISOString(), emptyReleaseRef: 'REL-7781' });

  it('the railway’s note: held with what is printed on it, checked against the law of its lane, matched to the box — and kept when replaced', async () => {
    const x = await anExporter();
    const agent = await anExporter(['clearing_agent'], 'Pwani Clearing');
    const made = (await http().post('/v1/sbg/exports').set(bearer(x.token)).send({ goodsDescription: 'Black tea, 640 sacks', originCountry: 'KE', destCountry: 'NL', loadingPort: 'Mombasa', containerType: '22G1', booking: booking(Date.now() + 72 * H), loadingSiteId: x.loading, terminalSiteId: x.terminal }).expect(201)).body;
    const path = `/v1/sbg/exports/${made.exportId}`;
    await http().post(`${path}/container`).set(bearer(x.token)).send({ containerNo: 'MSCU1234566' }).expect(201);
    const today = new Date().toISOString().slice(0, 10);
    // By the SGR from Nairobi to the port: Kenya Railways' own conditions — no rail convention reaches Kenya.
    const asKenya = ['from', 'takenOverOn', 'goods', 'packing', 'marks', 'packages', 'mass', 'consignor', 'consignee', 'to', 'charges', 'documents'];
    const note = { railway: 'krc', from: { name: 'Nairobi Inland Container Depot', country: 'KE' }, to: { name: 'Mombasa Port Reitz', country: 'KE' }, noteNumber: 'KRC-SGR-44120', madeOutOn: today, load: 'container', printed: asKenya, containerNo: 'MSCU 123456-6' };

    // What the lane asks is told before anything is held: the check writes nothing.
    const draft = (await http().post('/v1/sbg/rail/check').set(bearer(x.token)).send({ railway: 'krc', from: 'KE', to: 'KE', madeOutOn: today, load: 'container', printed: [] }).expect(201)).body;
    expect(draft).toMatchObject({ regime: 'national', complete: false });
    expect(draft.asked).toEqual(expect.arrayContaining(['consignorSigned', 'mass', 'consignee']));
    expect((await http().get('/v1/sbg/rail/railways').set(bearer(x.token)).expect(200)).body.items.find((r: { key: string }) => r.key === 'krc')).toMatchObject({ name: 'Kenya Railways', particularsChecked: true });

    // Staff keep nothing in its name; a stranger is told there is no such export; nothing nobody can find again is held.
    expect((await http().post(`${path}/rail`).set(bearer(operator)).send(note)).status).toBe(403);
    expect((await http().post(`${path}/rail`).set(bearer(agent.token)).send(note)).status).toBe(404);
    expect((await http().post(`${path}/rail`).set(bearer(x.token)).send({ ...note, noteNumber: undefined })).body.detail).toBe('Attach the railway’s note, or give its number');
    expect((await http().post(`${path}/rail`).set(bearer(x.token)).send({ ...note, railway: 'nowhere' })).status).toBe(404);

    const held = (await http().post(`${path}/rail`).set(bearer(x.token)).send(note).expect(201)).body.rail;
    // Not signed by the consignor (Conditions cl. 7): not complete, and what that costs if nothing was declared.
    expect(held.check.findings).toEqual([{ key: 'consignorSigned', rule: 'Conditions cl. 7', kind: 'missing' }]);
    expect(held.check.complete).toBe(false);
    expect(held.check.limits.join(' ')).toMatch(/KSh 20,000/);
    // The box's number as printed agrees with ours.
    expect(held.matches).toEqual([{ field: 'containerNo', printed: 'MSCU1234566', ours: 'MSCU1234566', agrees: true }]);

    // Appointed, the agent — who often books the train — may give a new note by its number; the one replaced is kept.
    await http().post(`${path}/agent`).set(bearer(x.token)).send({ agentEntityId: agent.entityId }).expect(201);
    expect((await http().post(`${path}/rail`).set(bearer(agent.token)).send({ ...note, documentId: 'doc_x' })).status).toBe(400);
    const again = (await http().post(`${path}/rail`).set(bearer(agent.token)).send({ ...note, printed: [...asKenya, 'consignorSigned'], containerNo: 'MSCU1234567' }).expect(201)).body;
    expect(again.rail).toMatchObject({ replaced: 1, check: { complete: true } });
    // A digit wrong on the rail note is caught where road and rail meet: it is not the box we are moving.
    expect(again.rail.matches[0]).toMatchObject({ field: 'containerNo', printed: 'MSCU1234567', agrees: false });
    expect(again.consignment.formerRail).toHaveLength(1);
    expect(again.consignment.formerRail[0].noteNumber).toBe('KRC-SGR-44120');
  });
});

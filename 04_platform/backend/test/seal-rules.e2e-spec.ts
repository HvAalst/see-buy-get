import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { EntityService } from '../src/foundation/entity/entity.service';
import { AGREED } from './agreed';

/**
 * WHERE A SEAL IS REQUIRED, EACH COUNTRY DECIDES (the user, round 38: "Each country decides") — through the booted
 * application. A country's company says it requires a seal on loads taken over in its country that cross a border, or on
 * container legs; such a load is not taken over until its shipper has written one, and the shipper and the driver are told
 * whose rule it is. A load the rule does not cover, or a company that has not decided, asks nothing.
 */
describe('a seal where the country requires one, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  let operator = '';

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

  async function aShipper(): Promise<string> {
    const n = digits();
    const phone = `+2547${n}6`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `seal-rule-${n}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token as string;
    const made = await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `Seal Rule Goods ${n}`, country: 'KE', registrationNo: `REG-SR-${n}`, activities: ['shipper'], yourName: 'Achieng' }).expect(201);
    return made.body.token.access_token as string;
  }
  const photo = async (token: string) =>
    (await http().post('/v1/sbg/media').set(bearer(token)).send({ kind: 'seal', dataUrl: `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`seal:${digits()}`)]).toString('base64')}` }).expect(201)).body.mediaId as string;

  it('a load the country requires a seal on is not taken over until its shipper has written one — and only that load', async () => {
    const kenya = app.get(EntityService).forJurisdiction('KE')!;
    const rules = `/v1/sbg/entities/${kenya.entityId}/seal-rules`;
    expect((await http().get(rules).set(bearer(operator)).expect(200)).body).toEqual({ entityId: kenya.entityId, crossBorder: false, containers: false });
    const shipper = await aShipper();
    // Not the shipper's to set, nor anybody else's but the company's people and staff.
    await http().post(rules).set(bearer(shipper)).send({ crossBorder: true, containers: false }).expect(403);
    await http().post(rules).set(bearer(operator)).send({ crossBorder: 'yes' }).expect(400);

    const post = async (destCountry: string) => {
      const posted = (
        await http()
          .post('/v1/sbg/dispatch/freight')
          .set(bearer(shipper))
          .send({ description: 'Clay bricks', pickupLocation: { lat: -1.33, lng: 36.87 }, pickupLabel: 'Jenga yard', destLabel: 'Depot', destLocation: { lat: 0.31, lng: 32.58 }, weightKg: 900, packaging: 'palletised', packages: 2, pickupCountry: 'KE', destCountry })
          .expect(201)
      ).body;
      // The commercial invoice is asked first; here the shipper's own paper travels, so the seal is what is asked next.
      if (destCountry !== 'KE') await http().post(`/v1/sbg/dispatch/freight/${posted.freightId}/commercial-invoice/own-paper`).set(bearer(shipper)).send({ travels: true }).expect(201);
      return posted.freightId as string;
    };
    const abroad = await post('UG');
    const home = await post('KE');
    const dispatch = app.get(DispatchService);
    const driverDid = 'did:glos:seal-rule-driver';
    for (const id of [abroad, home]) Object.assign(dispatch.requireFreightPublic(id), { status: 'claimed', claimedBy: driverDid });
    const takeOver = (id: string) => {
      try {
        dispatch.pickupFreight(id, driverDid, {});
        return 'taken';
      } catch (e) {
        return (e as { code?: string }).code;
      }
    };
    // Undecided, nothing is asked: the next thing a pickup asks is the safety check.
    expect(takeOver(abroad)).toBe('SAFETY_CHECK_INCOMPLETE');

    // Kenya's company decides: a seal on every load taken over in Kenya that crosses a border. Kept with who said so.
    expect((await http().post(rules).set(bearer(operator)).send({ crossBorder: true, containers: false }).expect(201)).body).toEqual({ entityId: kenya.entityId, crossBorder: true, containers: false });
    expect(app.get(EntityService).changes(kenya.entityId, 1)[0]).toMatchObject({ what: 'sealRules', from: 'no seal required', to: 'a seal on loads that cross a border' });
    expect((await http().get(`/v1/sbg/entities/${kenya.entityId}/pricing`).set(bearer(operator)).expect(200)).body.sealRules).toEqual({ crossBorder: true, containers: false });

    // The load abroad: not taken over, and everybody told whose rule it is. The load at home: nothing asked.
    expect(takeOver(abroad)).toBe('SEAL_REQUIRED');
    expect(dispatch.claimsFor(driverDid).find((c) => c.ref === abroad)?.sealMissing).toMatch(new RegExp(`${kenya.name} requires a seal on a load that crosses a border`));
    expect((await http().get(`/v1/sbg/dispatch/freight/${abroad}/seals`).set(bearer(shipper)).expect(200)).body.required).toEqual({ why: 'crossBorder', company: kenya.name });
    expect(takeOver(home)).toBe('SAFETY_CHECK_INCOMPLETE');
    expect(dispatch.claimsFor(driverDid).find((c) => c.ref === home)?.sealMissing).toBeUndefined();
    expect((await http().get(`/v1/sbg/dispatch/freight/${home}/seals`).set(bearer(shipper)).expect(200)).body.required).toBeUndefined();

    // Sealed by its shipper: taken over as far as the seal goes, and the driver no longer told it is missing.
    await http().post(`/v1/sbg/dispatch/freight/${abroad}/seals`).set(bearer(shipper)).send({ number: 'KE 4040-1', sealClass: 'H', appliedBy: 'sender', photos: { loadedOpen: await photo(shipper), closedWithSeal: await photo(shipper), sealCloseUp: await photo(shipper) } }).expect(201);
    expect(takeOver(abroad)).toBe('SAFETY_CHECK_INCOMPLETE');
    expect(dispatch.claimsFor(driverDid).find((c) => c.ref === abroad)?.sealMissing).toBeUndefined();

    // A container leg, when the company says so too.
    Object.assign(dispatch.requireFreightPublic(home), { containerNo: 'MSKU1234565' });
    expect(takeOver(home)).toBe('SAFETY_CHECK_INCOMPLETE');
    await http().post(rules).set(bearer(operator)).send({ crossBorder: true, containers: true }).expect(201);
    expect(takeOver(home)).toBe('SEAL_REQUIRED');
    expect((await http().get(`/v1/sbg/dispatch/freight/${home}/seals`).set(bearer(shipper)).expect(200)).body.required).toEqual({ why: 'container', company: kenya.name });

    // Taken back: saved as no seal required, and the change says so; saving it again is not a decision.
    await http().post(rules).set(bearer(operator)).send({ crossBorder: false, containers: false }).expect(201);
    expect(takeOver(home)).toBe('SAFETY_CHECK_INCOMPLETE');
    const before = app.get(EntityService).changes(kenya.entityId, 20).length;
    await http().post(rules).set(bearer(operator)).send({ crossBorder: false, containers: false }).expect(201);
    expect(app.get(EntityService).changes(kenya.entityId, 20)).toHaveLength(before);
  });
});

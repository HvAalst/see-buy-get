import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { declared } from './declared';
import { PresenceService } from '../src/foundation/presence/presence.service';

/**
 * A COUNTRY'S OWN MONEY WHERE NO COMPANY OF OURS STANDS YET (the owner, 2026-10-30, signing up a hub in the
 * Netherlands: "it says that my hub sort fee is KES 0.40 — we must settle for EURO"). A hub's fee and a shop's float
 * and price are said in the money of the company that contracts them; before there is one, in the money of the country
 * they stand in — never the network's. Through the booted application, in Luxembourg: a euro country no other test
 * opens, taking sign-ups as the Netherlands was, and put back as it was found.
 */
describe('a hub and a shop where no company of ours stands are shown their country’s money, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  let staff: Record<string, string> = {};
  let before: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    staff = bearer((await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token);
    const presence = app.get(PresenceService);
    before = presence.resolve('LU').level;
    // Taking sign-ups, as the owner's Netherlands was: no company of ours there, nothing moves yet.
    presence.set({ jurisdiction: 'LU', level: 'coming', by: 'country-money test' });
  }, 60_000);

  afterAll(async () => {
    if (before) app?.get(PresenceService).set({ jurisdiction: 'LU', level: before as never, by: 'country-money test, putting it back' });
    await app?.close();
  });

  const hubIn = async (country: string, location: { lat: number; lng: number }) => {
    const u = digits();
    const hub = (await http().post('/v1/sbg/mdps').set(staff).send({ name: `Sorteer ${u}`, zones: [`S${country}${u}`], country, location }).expect(201)).body as { did: string; mdpId: string };
    declared(app, 'hub', hub.did);
    const token = bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: hub.did }).expect(201)).body.access_token);
    const own = ((await http().get('/v1/sbg/mdps').set(token).expect(200)).body as Array<{ did: string; currency?: string; pricePerParcel?: number }>).find((m) => m.did === hub.did)!;
    return own;
  };

  it('a hub in a euro country with no company of ours is shown its fee in euros; one in Kenya, where our company is, in shillings', async () => {
    const lux = await hubIn('LU', { lat: 49.61, lng: 6.13 });
    expect(lux.currency).toBe('EUR');
    expect(lux.pricePerParcel).toEqual(expect.any(Number));
    expect((await hubIn('KE', { lat: -1.3, lng: 36.9 })).currency).toBe('KES');
  });

  it('a shop in a euro country with no company of ours keeps its float and its price in euros', async () => {
    const u = digits();
    const hours = { open: '08:00', close: '18:00' };
    const did = (
      await http()
        .post('/v1/sbg/agents')
        .set(staff)
        .send({
          shopName: `Butték ${u}`, zone: `Lux${u}`, country: 'LU', location: { lat: 49.61, lng: 6.13 }, landmark: 'bij de markt', shelf: { rows: 3, cols: 3 },
          openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: null },
          fullName: 'Sanne Winkel', nationalId: `ID-LU-${u}`, mobile: `+3526${u}1`, deviceImei: `IMEI-LU-${u}`,
          requirements: { androidVersion: 13, reliablePower: true, tradingLicence: `KVK-${u}`, criminalRecordClear: true },
        })
        .expect(201)
    ).body.did as string;
    const shop = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const own = (await http().get(`/v1/sbg/agents/${did}`).set(shop).expect(200)).body as { currency: string; parcelPrice: number };
    expect(own.currency).toBe('EUR');
    expect(own.parcelPrice).toEqual(expect.any(Number));
  });
});

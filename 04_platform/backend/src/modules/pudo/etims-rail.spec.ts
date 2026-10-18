import { chooseEtimsRail, etimsConfigFromEnv, etimsMissing, KraEtimsRail, SandboxEtimsRail, type EtimsConfig } from './etims-rail.adapter';

/**
 * KRA's OSCU over the wire — driven by a fake fetch, so not one request in this file can reach KRA (the user, 2026-10-18:
 * not registered yet, nothing sent to KRA).
 */
describe('eTIMS rail', () => {
  const config: EtimsConfig = { env: 'sandbox', bhfId: '00', deviceSerial: 'SBG-KE-01', item: { itemCd: 'KE3NTU0000001', itemClsCd: '7810220000' }, taxable: 'gross' };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const INIT_OK = { resultCd: '000', resultMsg: 'It is succeeded', data: { info: { tin: 'P051234567X', bhfId: '00', sdcId: 'KRACU0100000001', mrcNo: 'WIS01000150', cmcKey: 'f0b9831bd2334874b7ec815e40347bc4' } } };
  // KRA's own sample answer, trailing spaces in its keys and all.
  const SALE_OK = { resultCd: '000', resultMsg: 'It is succeeded', data: { 'curRcptNo ': '1', 'totRcptNo ': '1', intrlData: 'EAHSAV6ECUUXSY6PCCJYAUP6MI', rcptSign: 'QUII27MATATSHFRB', sdcDateTime: '20210502115145' } };

  function fakeKra(...answers: Array<Response | Error>) {
    const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    const http = (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      const next = answers.shift();
      if (!next) throw new Error('no more answers');
      if (next instanceof Error) throw next;
      return next;
    }) as unknown as typeof fetch;
    return { http, calls };
  }

  it('sets the device up once, then records with its key in the headers — and reads KRA’s receipt', async () => {
    const kra = fakeKra(json(200, INIT_OK), json(200, SALE_OK), json(200, { ...SALE_OK, data: { ...SALE_OK.data, 'curRcptNo ': '2' } }));
    const rail = new KraEtimsRail(config, kra.http);
    const first = await rail.record('P051234567X', { invcNo: 1 });
    expect(first).toEqual({ recorded: { curRcptNo: 1, totRcptNo: 1, intrlData: 'EAHSAV6ECUUXSY6PCCJYAUP6MI', rcptSign: 'QUII27MATATSHFRB', sdcDateTime: '20210502115145', sdcId: 'KRACU0100000001', mrcNo: 'WIS01000150' } });
    await rail.record('P051234567X', { invcNo: 2 });
    expect(kra.calls.map((c) => c.url)).toEqual([
      'https://etims-api-sbx.kra.go.ke/etims-api/selectInitOsdcInfo',
      'https://etims-api-sbx.kra.go.ke/etims-api/saveTrnsSalesOsdc',
      'https://etims-api-sbx.kra.go.ke/etims-api/saveTrnsSalesOsdc',
    ]);
    expect(kra.calls[0].body).toEqual({ tin: 'P051234567X', bhfId: '00', dvcSrlNo: 'SBG-KE-01' });
    expect(kra.calls[1].headers).toMatchObject({ tin: 'P051234567X', bhfId: '00', cmcKey: 'f0b9831bd2334874b7ec815e40347bc4' });
  });

  it('tells "KRA already has it", "KRA refused it" and "no answer" apart', async () => {
    const kra = fakeKra(json(200, INIT_OK), json(200, { resultCd: '994', resultMsg: 'There is an overlapped Data' }), json(200, { resultCd: '910', resultMsg: 'Request parameter error' }), json(503, {}), new Error('socket hang up'), json(200, { resultCd: '999', resultMsg: 'There is an unknown error' }));
    const rail = new KraEtimsRail(config, kra.http);
    expect(await rail.record('P051234567X', {})).toEqual({ already: 'There is an overlapped Data', code: '994' });
    expect(await rail.record('P051234567X', {})).toEqual({ refused: 'Request parameter error (910)', code: '910' });
    expect(await rail.record('P051234567X', {})).toHaveProperty('unknown');
    expect(await rail.record('P051234567X', {})).toHaveProperty('unknown');
    expect(await rail.record('P051234567X', {})).toHaveProperty('unknown');
  });

  it('a device KRA set up before (902) asks for its key, rather than guessing one', async () => {
    const kra = fakeKra(json(200, { resultCd: '902', resultMsg: 'This device is installed' }));
    const answer = await new KraEtimsRail(config, kra.http).record('P051234567X', {});
    expect(answer).toMatchObject({ code: '902' });
    expect((answer as { refused: string }).refused).toMatch(/GLOS_ETIMS_CMC_KEY/);
    // Given it, nothing is asked of KRA before the sale.
    const known = fakeKra(json(200, SALE_OK));
    await new KraEtimsRail({ ...config, known: { cmcKey: 'k', sdcId: 'KRACU0100000001', mrcNo: 'WIS01000150' } }, known.http).record('P051234567X', {});
    expect(known.calls.map((c) => c.url)).toEqual(['https://etims-api-sbx.kra.go.ke/etims-api/saveTrnsSalesOsdc']);
  });

  it('is set up only by the environment, says what a half set-up lacks, and a laptop’s own KRA is refused on a server', () => {
    expect(etimsConfigFromEnv({})).toBeNull();
    expect(etimsConfigFromEnv({ GLOS_ETIMS_DEVICE_SERIAL: 'X' })).toBeNull();
    expect(etimsMissing({ GLOS_ETIMS_DEVICE_SERIAL: 'X' })).toEqual(['GLOS_ETIMS_ITEM_CODE', 'GLOS_ETIMS_ITEM_CLASS']);
    expect(etimsConfigFromEnv({ GLOS_ETIMS_DEVICE_SERIAL: 'X', GLOS_ETIMS_ITEM_CODE: 'I', GLOS_ETIMS_ITEM_CLASS: 'C', GLOS_ETIMS_ENV: 'production', GLOS_ETIMS_TAXABLE: 'net' })).toEqual({
      env: 'production',
      bhfId: '00',
      deviceSerial: 'X',
      item: { itemCd: 'I', itemClsCd: 'C' },
      taxable: 'net',
      host: undefined,
    });
    const was = process.env.GLOS_ENV;
    process.env.GLOS_ENV = 'production';
    try {
      expect(() => new KraEtimsRail({ ...config, host: 'http://localhost:9999' })).toThrow(/outside a sandbox/);
      // A live server with nothing set up has no rail: invoices wait.
      expect(chooseEtimsRail({})).toBeNull();
    } finally {
      if (was === undefined) delete process.env.GLOS_ENV;
      else process.env.GLOS_ENV = was;
    }
    expect(chooseEtimsRail({})).toBeInstanceOf(SandboxEtimsRail);
  });

  it('the stand-in answers SANDBOX, in order only, and holds what it recorded', async () => {
    const standIn = new SandboxEtimsRail();
    const one = await standIn.record('P051234567X', { invcNo: 1 });
    expect(one).toMatchObject({ recorded: { sdcId: 'SANDBOX', sandbox: true, curRcptNo: 1 } });
    expect((one as { recorded: { rcptSign: string; intrlData: string } }).recorded.rcptSign).toHaveLength(16);
    expect((one as { recorded: { rcptSign: string; intrlData: string } }).recorded.intrlData).toHaveLength(26);
    expect(await standIn.record('P051234567X', { invcNo: 3 })).toMatchObject({ code: '910' });
    expect(await standIn.record('P051234567X', { invcNo: 1 })).toMatchObject({ code: '994' });
    expect(await standIn.record('P051234567X', { invcNo: 2, rcptTyCd: 'R' })).toMatchObject({ code: '910' });
  });
});

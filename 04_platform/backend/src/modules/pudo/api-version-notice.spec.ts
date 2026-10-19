import { lastValueFrom, of } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import { API_VERSIONS, ApiVersionInterceptor, checkSchedules, type ApiVersion } from '../../foundation/http/api-versions';
import { ApiVersionNoticeService } from './api-version-notice.service';
import type { CompanyKeyService } from './company-key.service';
import type { EntityService } from '../../foundation/entity/entity.service';
import type { BusinessService } from './business.service';
import type { FleetManagerService } from './fleet-manager.service';
import type { MailService } from '../../foundation/mail/mail.service';
import type { NotificationService } from './notification.service';

/**
 * A VERSION OF THE API STOPS ONLY WITH A YEAR'S NOTICE (the user, round 12: "A year, with notice"): the schedule the code
 * carries keeps the promise; the answers say which version, and once one is set to stop, when; every company holding a
 * live key is told when it is announced and a month before it stops, each once.
 */
describe('a version of the API stops only with notice', () => {
  const DAY = 86_400_000;
  const announced = Date.parse('2027-01-01T00:00:00Z');
  const retiring: ApiVersion = { version: '1', releasedAt: '2026-10-19', announcedAt: new Date(announced).toISOString(), retiresAt: new Date(announced + 400 * DAY).toISOString() };

  it('keeps the promise in the schedule the code carries, and names a schedule that would break it', () => {
    expect(checkSchedules(API_VERSIONS)).toEqual([]);
    expect(checkSchedules([retiring])).toEqual([]);
    expect(checkSchedules([{ ...retiring, retiresAt: new Date(announced + 180 * DAY).toISOString() }])).toEqual(['v1 stops less than 365 days after it was announced']);
    expect(checkSchedules([{ version: '1', releasedAt: '2026-10-19', retiresAt: '2028-01-01' }])).toEqual(['v1 has a day it stops but none it was announced']);
  });

  function call(versions: readonly ApiVersion[], url = '/v1/sbg/api/fleet/orders') {
    const headers: Record<string, string> = {};
    const ctx = { switchToHttp: () => ({ getResponse: () => ({ setHeader: (k: string, v: string) => (headers[k] = v) }), getRequest: () => ({ originalUrl: url }) }) } as unknown as ExecutionContext;
    const run = async () => lastValueFrom(new ApiVersionInterceptor(versions).intercept(ctx, { handle: () => of('answered') }));
    return { headers, run };
  }

  it('says which version answered; once one is set to stop, says when; after that, refuses', async () => {
    const plain = call(API_VERSIONS);
    expect(await plain.run()).toBe('answered');
    expect(plain.headers).toEqual({ 'x-sbg-api-version': '1' });

    const soon = call([{ ...retiring, retiresAt: new Date(Date.now() + 400 * DAY).toISOString(), announcedAt: new Date(Date.now() - DAY).toISOString() }]);
    expect(await soon.run()).toBe('answered');
    expect(soon.headers['Sunset']).toMatch(/GMT$/);
    expect(soon.headers['Deprecation']).toMatch(/^@\d+$/);

    const gone = call([{ ...retiring, announcedAt: new Date(Date.now() - 500 * DAY).toISOString(), retiresAt: new Date(Date.now() - DAY).toISOString() }]);
    await expect(gone.run()).rejects.toMatchObject({ code: 'API_VERSION_RETIRED' });
  });

  it('tells every company holding a live key when it is announced and a month before it stops — each once, by email and in its bell', async () => {
    let holders = [
      { kind: 'business' as const, id: 'ent_biz' },
      { kind: 'fleet' as const, id: 'did:glos:fleet-a' },
    ];
    const keys = { holders: () => holders } as unknown as CompanyKeyService;
    const entities = { find: (id: string) => (id === 'ent_biz' ? { name: 'Abebe Import', did: 'did:glos:biz', business: {} } : undefined) } as unknown as EntityService;
    const businesses = { ownerAddresses: () => [{ address: 'owner@abebe.example', name: 'Abebe' }] } as unknown as BusinessService;
    const managers = {
      get: (did: string) => {
        if (did === 'did:glos:fleet-a') return { companyName: 'Pwani Hauliers', did, contactEmail: 'office@pwani.example' };
        if (did === 'did:glos:fleet-b') return { companyName: 'No Email Fleet', did };
        throw new Error('unknown');
      },
    } as unknown as FleetManagerService;
    const mails: Array<{ to: string; stage: string }> = [];
    const mail = { send: (_t: string, to: { address: string }, p: { stage: string }) => void mails.push({ to: to.address, stage: p.stage }) } as unknown as MailService;
    const bells: Array<{ did: string; stage: string }> = [];
    const notifications = { notify: async (did: string, n: { data: { stage: string } }) => void bells.push({ did, stage: n.data.stage }) } as unknown as NotificationService;
    const notices = new ApiVersionNoticeService(keys, entities, businesses, managers, mail, notifications);

    // Before it is announced: nothing.
    expect(await notices.sweep(announced - DAY, [retiring])).toBe(0);
    // Announced: each company once, however often it looks.
    expect(await notices.sweep(announced + DAY, [retiring])).toBe(2);
    expect(await notices.sweep(announced + 2 * DAY, [retiring])).toBe(0);
    expect(mails).toEqual([
      { to: 'owner@abebe.example', stage: 'announced' },
      { to: 'office@pwani.example', stage: 'announced' },
    ]);
    // A company whose first live key comes later is told then; one with no email still hears it in its bell.
    holders = [...holders, { kind: 'fleet', id: 'did:glos:fleet-b' }];
    expect(await notices.sweep(announced + 100 * DAY, [retiring])).toBe(1);
    expect(bells.map((b) => b.did)).toEqual(['did:glos:biz', 'did:glos:fleet-a', 'did:glos:fleet-b']);
    // A month before it stops: each once more.
    const monthBefore = Date.parse(retiring.retiresAt!) - 29 * DAY;
    expect(await notices.sweep(monthBefore, [retiring])).toBe(3);
    expect(await notices.sweep(monthBefore + DAY, [retiring])).toBe(0);
    expect(mails.filter((m) => m.stage === 'month').map((m) => m.to)).toEqual(['owner@abebe.example', 'office@pwani.example']);
    // Once it has stopped there is nothing left to say.
    expect(await notices.sweep(Date.parse(retiring.retiresAt!) + DAY, [retiring])).toBe(0);
  });
});

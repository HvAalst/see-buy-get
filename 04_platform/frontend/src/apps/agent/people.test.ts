import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { actLine, canRemove, peopleApi, staffLine } from './people';

describe('the people at the counter', () => {
  it('says where each person stands, by the number they were added by', () => {
    expect(staffLine({ state: 'working', phoneEnds: '678' }, t)).toBe('Works the counter · number ending 678');
    expect(staffLine({ state: 'invited', phoneEnds: '678' }, t)).toBe('Added · has not said yes yet');
    expect(canRemove({ state: 'working' })).toBe(true);
    expect(canRemove({ state: 'removed' })).toBe(false);
  });

  it('says who did what at the counter: a person by name, the shop’s own sign-in as the owner', () => {
    expect(actLine({ at: '', act: 'took a parcel in', ref: 'KAUNTA-1', by: 'Wanjiru', staff: true }, t)).toBe('Wanjiru took a parcel in · KAUNTA-1');
    expect(actLine({ at: '', act: 'handed parcels to the bus', by: 'the owner', staff: false }, t)).toBe('You handed parcels to the bus');
  });

  it('asks the shop’s own routes', async () => {
    const seen: string[] = [];
    const get = (async (path: string) => (seen.push(`GET ${path}`), { data: [], error: null })) as never;
    const post = (async (path: string, body: unknown) => (seen.push(`POST ${path} ${JSON.stringify(body)}`), { data: {}, error: null })) as never;
    const api = peopleApi(get, post);
    await api.add(' +254712000111 ', ' Wanjiru ');
    await api.remove('ssm_1');
    await api.log();
    expect(seen).toEqual(['POST /v1/sbg/shop/staff {"phone":"+254712000111","name":"Wanjiru"}', 'POST /v1/sbg/shop/staff/ssm_1/remove {}', 'GET /v1/sbg/shop/counter-log']);
  });

  it('asks a hub’s own routes for a hub’s people, and says where they stand in a hub’s words', async () => {
    const seen: string[] = [];
    const get = (async (path: string) => (seen.push(`GET ${path}`), { data: [], error: null })) as never;
    const post = (async (path: string, body: unknown) => (seen.push(`POST ${path} ${JSON.stringify(body)}`), { data: {}, error: null })) as never;
    const api = peopleApi(get, post, 'hub');
    await api.list();
    await api.add('+254712000222', 'Otieno');
    await api.remove('ssm_2');
    await api.log();
    expect(seen).toEqual(['GET /v1/sbg/hub/staff', 'POST /v1/sbg/hub/staff {"phone":"+254712000222","name":"Otieno"}', 'POST /v1/sbg/hub/staff/ssm_2/remove {}', 'GET /v1/sbg/hub/floor-log']);
    expect(staffLine({ state: 'working', phoneEnds: '222' }, t, 'mdp.people.state')).toBe('Works the floor · number ending 222');
  });
});

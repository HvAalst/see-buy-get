import { lastValueFrom, defer } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import { API_RULE_CHANGES, checkRuleSchedules, lastNoticeAt, ruleRefuses, type ApiRuleChange } from './api-rules';
import { API_VERSIONS, ApiVersionInterceptor } from './api-versions';

/**
 * 2026-11-03 — A NEW RULE INSIDE A VERSION COMES WITH NOTICE (the user: "Notice first, build now"): 90 days, 30 for a safety
 * rule; until then a company's system is answered as before, with the rule named in a header; a person in an app is
 * refused from the day it ships.
 */
describe('a new rule inside a version of the API', () => {
  const DAY = 86_400_000;
  const now = Date.parse('2027-01-10T00:00:00Z');
  const rule: ApiRuleChange = { id: 'packages-required', version: '1', summary: 'A load is refused without the number of its packages.', announcedAt: '2027-01-01T00:00:00Z', enforcedFrom: '2027-04-01T00:00:00Z' };
  const safety: ApiRuleChange = { id: 'seal-required', version: '1', summary: 'A sealed load is refused without its seal number.', announcedAt: '2027-01-01T00:00:00Z', enforcedFrom: '2027-01-31T00:00:00Z', safety: true };

  it('keeps the promise in the list the code carries, and names a schedule that would break it', () => {
    expect(checkRuleSchedules(API_RULE_CHANGES, API_VERSIONS)).toEqual([]);
    expect(checkRuleSchedules([rule, safety], API_VERSIONS)).toEqual([]);
    expect(checkRuleSchedules([{ ...rule, enforcedFrom: '2027-02-01T00:00:00Z' }], API_VERSIONS)).toEqual(['packages-required refuses less than 90 days after it was announced']);
    expect(checkRuleSchedules([{ ...safety, enforcedFrom: '2027-01-20T00:00:00Z' }], API_VERSIONS)).toEqual(['seal-required refuses less than 30 days after it was announced']);
    expect(checkRuleSchedules([{ ...rule, version: '9' }], API_VERSIONS)).toEqual(['packages-required names version 9, which does not exist']);
    expect(checkRuleSchedules([rule, rule], API_VERSIONS)).toEqual(['packages-required is listed twice']);
    // In force from release is allowed only for what shipped before the promise, when no company was connected.
    expect(checkRuleSchedules([{ ...rule, fromRelease: true, announcedAt: '2027-01-01', enforcedFrom: '2027-01-01' }], API_VERSIONS)).toEqual(['packages-required is in force from release, but came after the notice promise (2026-11-03)']);
  });

  it('the second notice is a month before an ordinary rule refuses, a week before a safety rule', () => {
    expect(lastNoticeAt(rule)).toBe(Date.parse(rule.enforcedFrom) - 30 * DAY);
    expect(lastNoticeAt(safety)).toBe(Date.parse(safety.enforcedFrom) - 7 * DAY);
  });

  it('refuses a person in an app from the day it ships', () => {
    expect(ruleRefuses('packages-required', now, [rule])).toBe(true);
    expect(() => ruleRefuses('no-such-rule', now, [rule])).toThrow(/write it in API_RULE_CHANGES first/);
  });

  function call(work: () => unknown) {
    const headers: Record<string, string> = {};
    const ctx = { switchToHttp: () => ({ getResponse: () => ({ setHeader: (k: string, v: string) => (headers[k] = v) }), getRequest: () => ({ originalUrl: '/v1/sbg/api/business/loads' }) }) } as unknown as ExecutionContext;
    const run = async () => lastValueFrom(new ApiVersionInterceptor(API_VERSIONS).intercept(ctx, { handle: () => defer(async () => work()) }));
    return { headers, run };
  }

  it('answers a company’s system as before until the rule is in force, and names it in the answer', async () => {
    const before = call(async () => {
      await new Promise((r) => setTimeout(r, 1)); // across an await, as a real handler is
      return ruleRefuses('packages-required', now, [rule]) ? 'refused' : 'answered';
    });
    expect(await before.run()).toBe('answered');
    expect(before.headers['Sbg-Rule-Change']).toBe('packages-required; enforced-from=2027-04-01');
    expect(before.headers['x-sbg-api-version']).toBe('1');

    const after = call(() => (ruleRefuses('packages-required', Date.parse('2027-04-01T00:00:00Z'), [rule]) ? 'refused' : 'answered'));
    expect(await after.run()).toBe('refused');
    expect(after.headers['Sbg-Rule-Change']).toBeUndefined();

    // A call that meets no rule says nothing about one.
    const plain = call(() => 'answered');
    expect(await plain.run()).toBe('answered');
    expect(plain.headers['Sbg-Rule-Change']).toBeUndefined();
  });

  it('the rule already in force — dangerous goods without a UN number — refuses a system too: it shipped before any company connected', () => {
    const dg = API_RULE_CHANGES.find((r) => r.id === 'dangerous-goods-un-number')!;
    expect(dg).toMatchObject({ fromRelease: true, safety: true });
    expect(ruleRefuses('dangerous-goods-un-number')).toBe(true);
  });
});

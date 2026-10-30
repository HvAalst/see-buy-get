import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { EMPTY_JOIN, ROLES } from './logic';
import { JoinScreen } from './screens/JoinScreen';

/*
 * THE CODE STEP OF SIGNING UP ON THE FRONT PAGE (found 2026-10-30, the owner walking the live site with a stand-in code):
 * it drew four boxes, widening to six only once more than four digits were in — and the box takes no more than it shows,
 * so a six-digit code could never be typed. Every code the server sends a phone has six digits.
 */
describe('typing the code, signing up', () => {
  for (const role of ROLES) {
    it(`gives six boxes for the code, signing up as ${role.id}`, () => {
      const state = { role, step: 'code', form: { ...EMPTY_JOIN, phone: '+31600000000' }, busy: null, countries: [], countriesState: 'idle', issuedCode: null } as never;
      const html = renderToString(<JoinScreen state={state} actions={{} as never} />);
      expect(html).toContain('id="otp"');
      expect(html).toMatch(/id="otp"[^>]*maxlength="6"/i);
      expect((html.match(/class="codebox[ "]/g) ?? []).length).toBe(6);
    });
  }
});

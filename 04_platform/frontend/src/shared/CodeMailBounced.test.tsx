import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from './i18n';
import { CodeMailBounced } from './CodeMailBounced';

/*
 * 2026-11-16 — THE CODE EMAIL CAME BACK (the owner: "a bounce deserves a notice"): beside a load's code, its poster reads
 * that the email did not arrive, where it went, that they can give the code on themselves — and sends it elsewhere.
 */
describe('a code email that came back', () => {
  it('says so, names where it went, and offers another address — on the phone and in the console', () => {
    for (const look of ['app', 'console'] as const) {
      const html = renderToString(<CodeMailBounced look={look} to="achieng@exmaple.com" onSend={() => undefined} />);
      expect(html).toContain(t('nowWith.bounced.title'));
      expect(html).toContain(t('nowWith.bounced.detail', { to: 'achieng@exmaple.com' }));
      expect(html).toContain(t('nowWith.bounced.label'));
      expect(html).toContain(t('nowWith.bounced.send'));
      expect(html).toContain('type="email"');
    }
  });

  it('the button waits for an address', () => {
    const html = renderToString(<CodeMailBounced look="console" to="achieng@exmaple.com" onSend={() => undefined} />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Send the code there/);
  });
});

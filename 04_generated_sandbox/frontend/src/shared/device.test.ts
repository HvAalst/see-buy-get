import { describe, expect, it } from 'vitest';
import { channelUrl } from './device';

describe('invite channel deep-links (S28)', () => {
  const t = { text: 'Join Hans on SeeBuyGet', url: 'https://x.test/send/?invite=abc', tel: '+254 700 123 456', email: 'a@b.test' };

  it('opens WhatsApp straight to the contact, digits only, message prefilled', () => {
    const u = channelUrl('whatsapp', t)!;
    expect(u).toContain('wa.me/254700123456'); // + and spaces stripped
    expect(decodeURIComponent(u)).toContain('Join Hans on SeeBuyGet https://x.test/send/?invite=abc');
  });

  it('falls back to WhatsApp with no recipient when there is no number', () => {
    expect(channelUrl('whatsapp', { text: 'hi', url: 'u' })).toContain('wa.me/?text=');
  });

  it('builds SMS / email / telegram links', () => {
    expect(channelUrl('sms', t)).toMatch(/^sms:254700123456\?body=/);
    expect(channelUrl('email', t)).toMatch(/^mailto:a@b\.test\?subject=/);
    expect(channelUrl('telegram', t)).toContain('t.me/share/url?url=');
  });

  it('returns null for copy / system (handled without a deep link)', () => {
    expect(channelUrl('copy', t)).toBeNull();
    expect(channelUrl('system', t)).toBeNull();
  });
});

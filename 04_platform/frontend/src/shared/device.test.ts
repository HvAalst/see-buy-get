import { describe, expect, it } from 'vitest';
import { channelsFor, channelUrl, countryOfLocale } from './device';

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

describe('share SeeBuyGet: the apps, in the order people use them where they live (2026-11-01)', () => {
  const t = { text: 'Join Amina on SeeBuyGet', url: 'https://x.test/?invite=abc' };

  it('puts WhatsApp first across most BRICS countries, Telegram first in Ethiopia, Iran and Russia, WeChat alone in China', () => {
    for (const c of ['BR', 'IN', 'ZA', 'EG', 'AE', 'ID', 'KE', 'UG', 'NL']) expect(channelsFor(c)[0]).toBe('whatsapp');
    for (const c of ['ET', 'IR', 'RU']) expect(channelsFor(c)[0]).toBe('telegram');
    expect(channelsFor('ru')).toEqual(expect.arrayContaining(['vk', 'viber']));
    expect(channelsFor('CN')[0]).toBe('wechat');
    expect(channelsFor('CN')).not.toContain('whatsapp');
    // An unknown country gets the common order, and every list ends with copying the link.
    expect(channelsFor(undefined)[0]).toBe('whatsapp');
    for (const c of ['CN', 'RU', 'ET', 'KE', '']) expect(channelsFor(c)[channelsFor(c).length - 1]).toBe('copy');
  });

  it("reads a country off the phone's language only where it names one", () => {
    expect(countryOfLocale('en-KE')).toBe('KE');
    expect(countryOfLocale('zh-Hans-CN')).toBe('CN');
    expect(countryOfLocale('pt_BR')).toBe('BR');
    expect(countryOfLocale('en')).toBeUndefined();
    expect(countryOfLocale(undefined)).toBeUndefined();
  });

  it('builds the VK and Viber links, and leaves WeChat to the clipboard', () => {
    expect(channelUrl('vk', t)).toBe(`https://vk.com/share.php?url=${encodeURIComponent(t.url)}&title=${encodeURIComponent(t.text)}`);
    expect(channelUrl('viber', t)).toMatch(/^viber:\/\/forward\?text=/);
    expect(decodeURIComponent(channelUrl('viber', t)!)).toContain(t.url);
    expect(channelUrl('wechat', t)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { directChannel, inviteUrl, shareTokenOf } from './ShareSheet';

describe('share SeeBuyGet: the link (2026-11-01)', () => {
  it('opens the front page with the sharer’s token, or the bare front page when there is none', () => {
    expect(inviteUrl('https://sbg.test', 'a b')).toBe('https://sbg.test/?invite=a%20b');
    expect(inviteUrl('https://sbg.test', null)).toBe('https://sbg.test/');
  });

  it('reuses the link made for sharing, never a contact’s own invite', () => {
    expect(shareTokenOf({ invites: [{ token: 'for-jane', channels: ['whatsapp'] }, { token: 'mine', channels: ['share'] }] })).toBe('mine');
    expect(shareTokenOf({ invites: [{ token: 'for-jane', channels: ['whatsapp'] }] })).toBeNull();
    expect(shareTokenOf(null)).toBeNull();
  });

  it('messages a picked contact on WhatsApp where it leads, else by text message', () => {
    expect(directChannel(['whatsapp', 'telegram'])).toBe('whatsapp');
    expect(directChannel(['telegram', 'whatsapp'])).toBe('sms');
    expect(directChannel(['wechat', 'sms'])).toBe('sms');
  });
});

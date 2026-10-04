import { BusinessClientService } from './business-client.service';
import { clientRefOf } from './business-client.types';

/**
 * B4 — AN EXPEDITOR'S CLIENTS. The user, 2026-10-04: the expeditor is the shipper's agent, so the client is the sender
 * on the note. What has to hold here is that each business's book is its own, and that a client who has gone quiet
 * still names what was sent for them.
 */
describe('an expeditor’s book of clients', () => {
  it('keeps each business’s clients to that business, and says nothing about anybody else’s', () => {
    const book = new BusinessClientService();
    const mine = book.add('biz-et-abyssinia', { name: 'Yirgacheffe Union', country: 'et', contactPhone: '+251911000111' }, 'Hana');
    expect(mine).toMatchObject({ name: 'Yirgacheffe Union', country: 'ET', contactPhone: '+251911000111', createdBy: 'Hana' });
    expect(book.require('biz-et-abyssinia', mine.clientId).name).toBe('Yirgacheffe Union');
    expect(() => book.require('biz-et-rival', mine.clientId)).toThrow(/No such client/);
    expect(book.list('biz-et-rival')).toEqual([]);
  });

  it('refuses a nameless client, an unknown country and the same client twice', () => {
    const book = new BusinessClientService();
    expect(() => book.add('b', { name: ' ' }, 'H')).toThrow(/client’s name/);
    expect(() => book.add('b', { name: 'X', country: 'ZZ' }, 'H')).toThrow(/not a country/);
    book.add('b', { name: 'Sidama Coffee', country: 'ET' }, 'H');
    expect(() => book.add('b', { name: 'sidama coffee', country: 'ET' }, 'H')).toThrow(/already in your book/);
    // The same name in another country is another client.
    expect(book.add('b', { name: 'Sidama Coffee', country: 'KE' }, 'H').country).toBe('KE');
  });

  it('archives rather than deletes, and an archived client is sent for by nobody until brought back', () => {
    const book = new BusinessClientService();
    const c = book.add('b', { name: 'Gone Quiet PLC' }, 'H');
    book.setArchived('b', c.clientId, true, 'H');
    expect(book.list('b')).toEqual([]);
    expect(book.list('b', { archived: true })).toHaveLength(1);
    expect(() => book.require('b', c.clientId)).toThrow(/archived/);
    book.setArchived('b', c.clientId, false, 'H');
    expect(book.require('b', c.clientId).archivedAt).toBeUndefined();
  });

  it('stamps a copy on the load, so renaming the client later does not rewrite who the sender was', () => {
    const book = new BusinessClientService();
    const c = book.add('b', { name: 'Old Name Ltd', country: 'ET', address: 'Hawassa' }, 'H');
    const stamped = clientRefOf(c);
    book.update('b', c.clientId, { name: 'New Name Ltd' });
    expect(stamped).toEqual({ clientId: c.clientId, name: 'Old Name Ltd', country: 'ET', address: 'Hawassa' });
  });
});

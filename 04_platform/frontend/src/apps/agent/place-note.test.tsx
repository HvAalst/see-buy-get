import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { PlaceNote } from './screens/AcceptScreen';
import { placeOf } from './useAgentApp';

/*
 * 2026-11-05 — PRE-DROP-OFF: a parcel taken in is told where it goes (the owner: "the open bag for its next stop, or a shelf
 * slot") — as the server placed it, never guessed by the app.
 */
describe('where a parcel just taken in goes', () => {
  it('the open bag for its next stop comes first', () => {
    const place = placeOf({ goesInBag: { code: 'BAG-7', label: 'Westlands Hub' }, originSlot: 'Red-2' });
    expect(place).toEqual({ bag: { code: 'BAG-7', label: 'Westlands Hub' } });
    const html = renderToString(<PlaceNote place={place} />);
    expect(html).toContain(t('agent.accept.placeBag', { code: 'BAG-7' }));
    expect(html).toContain(t('agent.accept.placeBagDetail', { place: 'Westlands Hub' }));
  });

  it('else its shelf slot, until it is bagged or handed on', () => {
    const html = renderToString(<PlaceNote place={placeOf({ originSlot: 'Green-3' })} />);
    expect(html).toContain(t('agent.accept.placeSlot', { slot: 'Green-3' }));
    expect(html).toContain(t('agent.accept.placeSlotDetail'));
  });

  it('nothing said where the server gave it neither — a full shelf, or a parcel shelved to be collected here', () => {
    expect(placeOf({})).toBeUndefined();
    expect(placeOf(null)).toBeUndefined();
    expect(renderToString(<PlaceNote place={undefined} />)).toBe('');
  });
});

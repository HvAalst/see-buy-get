import { describe, expect, it } from 'vitest';
import { EMPTY_PARCEL, parcelPriceGaps, parcelSendGaps, parcelSize, parcelStage, sendBody, shopChoices, type ParcelForm } from './parcels';

const t = ((key: string) => key) as never;

/**
 * A BUSINESS'S PARCELS (the user, 2026-10-29: "Billed to the business"; "A prepaid balance"). The form prices a parcel once
 * both shops and the four measurements are in, sends it only with a receiver and a photo, and sends the price it showed;
 * the list says where each stands in the sender's words.
 */
describe('a business’s parcels', () => {
  const full: ParcelForm = { ...EMPTY_PARCEL, originDid: 'did:a', destDid: 'did:b', receiver: '0712 345 678', l: '30', w: '20', h: '15', kg: '2,5', photoRef: 'med_1' };

  it('prices once both shops and the measurements are in — a comma is a decimal point — and never one shop at both ends', () => {
    expect(parcelSize(full)).toEqual({ l: 30, w: 20, h: 15, kg: 2.5 });
    expect(parcelPriceGaps(full, t)).toEqual([]);
    expect(parcelPriceGaps({ ...full, kg: '' }, t)).toEqual(['business.parcels.gap.size']);
    expect(parcelPriceGaps({ ...full, h: '0' }, t)).toEqual(['business.parcels.gap.size']);
    expect(parcelPriceGaps({ ...full, destDid: 'did:a' }, t)).toEqual(['business.parcels.gap.sameShop']);
    expect(parcelPriceGaps(EMPTY_PARCEL, t)).toEqual(['business.parcels.gap.from', 'business.parcels.gap.to', 'business.parcels.gap.size']);
  });

  it('sends only with somebody to collect it and a photo of what is inside — and with the price it showed', () => {
    expect(parcelSendGaps(full, t)).toEqual([]);
    expect(parcelSendGaps({ ...full, receiver: '0712' }, t)).toEqual(['business.parcels.gap.receiver']);
    expect(parcelSendGaps({ ...full, photoRef: '' }, t)).toEqual(['business.parcels.gap.photo']);
    expect(sendBody(full, 612.5)).toEqual({ originPudoDid: 'did:a', destPudoDid: 'did:b', receiverMobile: '0712 345 678', dimensionsCm: { l: 30, w: 20, h: 15 }, weightKg: 2.5, contentPhotoRef: 'med_1', routeMode: 'flexible', expectedTotal: 612.5 });
    expect(sendBody({ ...full, fragile: true, reference: ' INV-9 ' }, undefined)).toMatchObject({ fragile: true, reference: 'INV-9' });
    expect(sendBody({ ...full, photoRef: '' }, 1)).toBeNull();
  });

  it('offers the shops taking new parcels in the business’s own country, by name', () => {
    const shops = [
      { did: '1', shopName: 'Zebra Shop', zone: 'Z', country: 'KE' },
      { did: '2', shopName: 'Addis Corner', zone: 'A', country: 'ET' },
      { did: '3', shopName: 'Amani Duka', zone: 'B', country: 'KE' },
      { did: '4', shopName: 'Held Shop', zone: 'C', country: 'KE', takesNew: false },
    ];
    expect(shopChoices(shops, 'KE').map((s) => s.did)).toEqual(['3', '1']);
  });

  it('says where a parcel stands in the sender’s words: unpaid first, then hand in, on its way, ready, collected', () => {
    expect(parcelStage({ status: 'Created', paid: false })).toBe('unpaid');
    expect(parcelStage({ status: 'Created', paid: true })).toBe('to_hand_in');
    expect(parcelStage({ status: 'On_Bus', paid: true })).toBe('on_its_way');
    expect(parcelStage({ status: 'At_MDP', paid: true })).toBe('on_its_way');
    expect(parcelStage({ status: 'Ready_For_Pickup', paid: true })).toBe('to_collect');
    expect(parcelStage({ status: 'Delivered', paid: true })).toBe('collected');
    expect(parcelStage({ status: 'Voided', paid: true })).toBe('called_off');
    expect(parcelStage({ status: 'Lost', paid: true })).toBe('problem');
  });
});

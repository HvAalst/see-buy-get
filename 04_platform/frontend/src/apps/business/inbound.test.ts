import { describe, expect, it } from 'vitest';
import { codeOf, inboundState, inboundTitle, trackingPathOf } from './inbound';
import { loadGaps, sectionsFor } from './logic';

describe('inbound, reading A, in the Business app', () => {
  it('shows Coming in to a business that receives goods, and to nobody who said it does not', () => {
    expect(sectionsFor(['receiver'])).toContain('inbound');
    expect(sectionsFor(['shipper'])).not.toContain('inbound');
  });

  it('says where a load coming in stands in one word', () => {
    expect(['available', 'scheduled', 'ordered'].map((status) => inboundState({ status }))).toEqual(['booked', 'booked', 'booked']);
    expect(['claimed', 'in_transit', 'delivered', 'cancelled'].map((status) => inboundState({ status }))).toEqual(['carrier', 'on_its_way', 'delivered', 'withdrawn']);
  });

  it('calls it by the receiver’s own order number where the supplier gave one, else by what it is', () => {
    expect(inboundTitle({ reference: 'PO-7781', description: 'Cement, 400 bags' })).toEqual({ kind: 'order', text: 'PO-7781' });
    expect(inboundTitle({ description: 'Cement, 400 bags' })).toEqual({ kind: 'goods', text: 'Cement, 400 bags' });
  });

  it('reads a code however it was written down, and nothing that cannot be one', () => {
    expect(['7kq3-px9m', '7KQ3 PX9M', ' 7KQ3PX9M '].map(codeOf)).toEqual(['7KQ3-PX9M', '7KQ3-PX9M', '7KQ3-PX9M']);
    expect(codeOf('7KQ3')).toBeNull();
    expect(trackingPathOf({ trackingKey: 'T-AB12' })).toBe('/send/?track=T-AB12');
    expect(trackingPathOf({})).toBeNull();
  });

  it('takes a receiving point found by its code as where a load goes, instead of a place of its own', () => {
    const form = { description: 'Cement', fromSiteId: 'site_1', toSiteId: '', weightKg: '200' };
    expect(loadGaps(form)).toEqual(['toSiteId']);
    expect(loadGaps({ ...form, receivingPoint: '7KQ3-PX9M' })).toEqual([]);
  });
});

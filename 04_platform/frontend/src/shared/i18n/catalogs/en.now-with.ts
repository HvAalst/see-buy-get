/**
 * 2026-11-15 — WHO HAS IT NOW (plan R1), said alike by the Send app, the Business app and the Shop app: a shop or a hub by
 * its name; on the road the company carrying it and the kind of vehicle. Each of those apps adds these words itself.
 */
export const enNowWith = {
  'nowWith.shop': 'Now with {name}, a collection shop',
  'nowWith.shopUnnamed': 'Now at a collection shop',
  'nowWith.hub': 'Now at {name}, a sorting hub',
  'nowWith.hubUnnamed': 'Now at a sorting hub',
  'nowWith.carrier': 'On the road with {name}, by {vehicle}',
  'nowWith.carrierNoVehicle': 'On the road with {name}',
  'nowWith.carrierUnnamed': 'On the road',
  'nowWith.taken': 'Taken by {name}, by {vehicle}: not picked up yet',
  'nowWith.takenNoVehicle': 'Taken by {name}: not picked up yet',
  'nowWith.takenUnnamed': 'A driver has taken it: not picked up yet',
  'nowWith.sender': 'Still with the sender',
  'nowWith.since': 'since {time}',
  'nowWith.vehicle.bike': 'bike',
  'nowWith.vehicle.motorcycle': 'motorbike',
  'nowWith.vehicle.tuktuk': 'tuk-tuk',
  'nowWith.vehicle.car': 'car',
  'nowWith.vehicle.van': 'van',
  'nowWith.vehicle.bus': 'bus',
  'nowWith.vehicle.truck': 'truck',
  'nowWith.vehicle.generic': 'vehicle',
  // 2026-11-15 — "It arrived", confirmed: the sender spoke to the receiver themselves.
  'nowWith.arrived.ask': 'Only if the person receiving it has it, and you spoke to them yourself, not only to the driver. The driver can then deliver without the code.',
  'nowWith.arrived.who': 'Who has it: {who}',
  'nowWith.arrived.tick': 'I spoke to the receiver myself, and they have it',
  'nowWith.arrived.confirm': 'Yes, it arrived',
  'nowWith.arrived.cancel': 'Not yet',
  // 2026-11-16 — the email with a load's code to its receiver came back: the poster sends it to another address.
  'nowWith.bounced.title': 'The email with the code did not arrive',
  'nowWith.bounced.detail': 'It came back from {to}. Give the code to the person receiving it yourself, or send it to another address.',
  'nowWith.bounced.label': 'Another email address',
  'nowWith.bounced.send': 'Send the code there',
  'nowWith.bounced.sent': 'The code is on its way to {to}.',
} as const;

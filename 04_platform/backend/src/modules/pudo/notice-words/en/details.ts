/**
 * 2026-11-27 — the pieces inside notices that were still English words written by our code (the owner: "fix as recommended"):
 * where on a load something was found, a reason the system gives, a delivery window, a vehicle's class, a service's due line,
 * a courier unnamed, what keeps air cargo in the shed, why a bag could not be given to a driver, and the summary of a rule of
 * the API. English, word for word what each notice said before; the other languages beside it (../<lang>/details.ts).
 */
export const EN_DETAILS = {
  'dispatch.loadHeld.where.pickup': 'at pickup',
  'dispatch.loadHeld.where.road': 'on the road',
  'dispatch.loadHeld.where.delivery': 'at delivery',
  'dispatch.cancelled.reason.collectedAtShop': 'its parcel was collected at the shop',
  'dispatch.window.before': 'before {to}',
  'dispatch.window.from': 'from {from}',

  'vehicle.class.bike': 'bike',
  'vehicle.class.motorcycle': 'motorcycle',
  'vehicle.class.tuktuk': 'tuktuk',
  'vehicle.class.car': 'car',
  'vehicle.class.van': 'van',
  'vehicle.class.bus': 'bus',
  'vehicle.class.truck': 'truck',

  'dispatch2.serviceDue.line.overdueDay': 'Service overdue: it was due by {day}',
  'dispatch2.serviceDue.line.overdueKm': 'Service overdue: it was due at {due} km, and reads {km} km',
  'dispatch2.serviceDue.line.soon': 'Service due soon: {when}',
  'dispatch2.serviceDue.line.soonReads': 'Service due soon: {when} (it reads {km} km)',
  'dispatch2.serviceDue.byDay': 'by {day}',
  'dispatch2.serviceDue.atKm': 'at {km} km',
  'dispatch2.serviceDue.either': '{a} or {b}, whichever comes first',
  'dispatch2.breakdown.theCourier': 'The courier',

  'importer.list': '{a}, {b}',
  'importer.airGap.transit': 'the transit release at customs in {country}',
  'importer.airGap.customs': 'the customs release',
  'importer.airGap.agency': 'the release by {agency}',
  'importer.airGap.deliveryOrder': 'the handler’s delivery order',
  'importer.airGap.charges': 'the handler’s charges paid',
  'importer.airArrival.office.customsKE': 'Customs verification (KRA)',

  'idDispute.slot': '{from} to {to}',

  'pickupAhead.refused.reason.noVehicle': 'They are no longer on a vehicle',
  'pickupAhead.refused.reason.status': 'The bag is {status}',
  'pickupAhead.refused.reason.hubDown': 'Its hub is down',
  'pickupAhead.refused.reason.tooHeavy': 'It weighs {kg} kg, more than their vehicle has left',
  'pickupAhead.refused.reason.noPlace': 'Their vehicle has no bag place left',
  'pickupAhead.refused.reason.cannotCarry': 'Their vehicle cannot carry what is in it',
  'bag.status.free': 'free',
  'bag.status.filling': 'filling',
  'bag.status.claimed': 'claimed',
  'bag.status.in_transit': 'in_transit',

  'apiVersionNotice.rule.summary.dangerous-goods-un-number': 'A load of dangerous goods (chemical, biological or flammable) is refused without its UN number, proper shipping name and class.',
  'apiVersionNotice.rule.summary.vehicle-energy': 'A vehicle is registered with what it runs on (energy: petrol, diesel, electric, hybrid, gas, or pedal for a bicycle).',
  'apiVersionNotice.rule.summary.declaration-each-line': 'A security declaration is signed with each of its lines ticked (confirmed: the number of every line, from 0).',
  'apiVersionNotice.rule.summary.ro-bg-fiscal-codes': 'A load taken over or delivered in Romania carries the UIT code of RO e-Transport, and in Bulgaria the UTN of goods with high fiscal risk, or the sender\'s word that none is needed and why (fiscalCodes).',
  'apiVersionNotice.rule.summary.ro-bg-fiscal-indemnity': 'A load with a UIT or UTN code, or a reason for none, carries the sender\'s certification that they are accurate (fiscalCodes.indemnity: true).',

  'dispatch.roadRefusal.none': 'This bag goes to another country, and no road route there is on: nobody carries it yet',
  'dispatch.roadRefusal.otherFleet': 'This bag goes on the route from {from} to {to}: only {fleet}’s drivers carry it',
  'dispatch.coldClash': 'This truck already carries a load kept at {otherMin} to {otherMax} °C; this one must be kept at {min} to {max} °C. One body keeps one temperature: deliver that load first, or this one goes on another truck.',
  'declaration.refused.you.missing': 'You have not signed your security declaration: nothing new is taken on until you have. It is signed in {where}, on the home screen',
  'declaration.refused.you.lapsed': 'You have not signed your security declaration again this year: nothing new is taken on until you have. It is signed in {where}, on the home screen',
  'declaration.refused.you.outdated': 'You have not signed the new wording of your security declaration: nothing new is taken on until you have. It is signed in {where}, on the home screen',
  'declaration.refused.fleet.missing': 'Your fleet has not signed its security declaration: nothing new is taken on until it has. It is signed in {where}, on the home screen',
  'declaration.refused.fleet.lapsed': 'Your fleet has not signed its security declaration again this year: nothing new is taken on until it has. It is signed in {where}, on the home screen',
  'declaration.refused.fleet.outdated': 'Your fleet has not signed the new wording of its security declaration: nothing new is taken on until it has. It is signed in {where}, on the home screen',
  'declaration.where.driver': 'the Driver app',
  'declaration.where.fleet': 'the Fleet app',
} as const;

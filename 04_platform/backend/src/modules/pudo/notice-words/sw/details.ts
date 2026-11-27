import type { EN_DETAILS } from '../en/details';

export const SW_DETAILS: Record<keyof typeof EN_DETAILS, string> = {
  'dispatch.loadHeld.where.pickup': 'wakati wa kuchukua',
  'dispatch.loadHeld.where.road': 'barabarani',
  'dispatch.loadHeld.where.delivery': 'wakati wa kukabidhi',
  'dispatch.cancelled.reason.collectedAtShop': 'kifurushi chake kilichukuliwa dukani',
  'dispatch.window.before': 'kabla ya {to}',
  'dispatch.window.from': 'kuanzia {from}',

  'vehicle.class.bike': 'baiskeli',
  'vehicle.class.motorcycle': 'pikipiki',
  'vehicle.class.tuktuk': 'tuktuk',
  'vehicle.class.car': 'gari dogo',
  'vehicle.class.van': 'gari dogo la mizigo',
  'vehicle.class.bus': 'basi',
  'vehicle.class.truck': 'lori',

  'dispatch2.serviceDue.line.overdueDay': 'Huduma imechelewa: ilipaswa kufanyika kufikia {day}',
  'dispatch2.serviceDue.line.overdueKm': 'Huduma imechelewa: ilipaswa kufanyika kwa {due} km, na sasa inasoma {km} km',
  'dispatch2.serviceDue.line.soon': 'Huduma inakaribia: {when}',
  'dispatch2.serviceDue.line.soonReads': 'Huduma inakaribia: {when} (inasoma {km} km)',
  'dispatch2.serviceDue.byDay': 'kufikia {day}',
  'dispatch2.serviceDue.atKm': 'kwa {km} km',
  'dispatch2.serviceDue.either': '{a} au {b}, lolote litakalotangulia',
  'dispatch2.breakdown.theCourier': 'Msafirishaji',

  'importer.list': '{a}, {b}',
  'importer.airGap.transit': 'kuachiliwa kwa mzigo wa njiani (transit) forodhani nchini {country}',
  'importer.airGap.customs': 'kuachiliwa na forodha',
  'importer.airGap.agency': 'kuachiliwa na {agency}',
  'importer.airGap.deliveryOrder': 'hati ya kukabidhi ya msimamizi wa shehena',
  'importer.airGap.charges': 'ada za msimamizi wa shehena zilizolipwa',
  'importer.airArrival.office.customsKE': 'Uhakiki wa Forodha (KRA)',

  'idDispute.slot': '{from} hadi {to}',

  'pickupAhead.refused.reason.noVehicle': 'Hawako tena kwenye gari',
  'pickupAhead.refused.reason.status': 'Hali ya mfuko: {status}',
  'pickupAhead.refused.reason.hubDown': 'Kituo chake hakifanyi kazi',
  'pickupAhead.refused.reason.tooHeavy': 'Una uzito wa {kg} kg, zaidi ya kilichobaki kwenye gari lao',
  'pickupAhead.refused.reason.noPlace': 'Gari lao halina nafasi ya mfuko iliyobaki',
  'pickupAhead.refused.reason.cannotCarry': 'Gari lao haliwezi kubeba kilichomo',
  'bag.status.free': 'haujatumika',
  'bag.status.filling': 'bado unajazwa',
  'bag.status.claimed': 'umechukuliwa na dereva',
  'bag.status.in_transit': 'uko njiani',

  'apiVersionNotice.rule.summary.dangerous-goods-un-number': 'Mzigo wa bidhaa hatari (kemikali, kibiolojia au zinazowaka) hukataliwa bila nambari yake ya UN, jina sahihi la usafirishaji na daraja.',
  'apiVersionNotice.rule.summary.vehicle-energy': 'Gari husajiliwa pamoja na kinacholiendesha (energy: petroli, dizeli, umeme, mseto, gesi, au kanyagio kwa baiskeli).',
  'apiVersionNotice.rule.summary.declaration-each-line': 'Tamko la usalama husainiwa huku kila mstari wake ukiwa umetiwa alama (confirmed: nambari ya kila mstari, kuanzia 0).',
  'apiVersionNotice.rule.summary.ro-bg-fiscal-codes': 'Mzigo uliochukuliwa au kukabidhiwa Romania hubeba msimbo wa UIT wa RO e-Transport, na Bulgaria UTN ya bidhaa zenye hatari kubwa ya kodi, au neno la mtumaji kwamba hakuna kinachohitajika na sababu (fiscalCodes).',
  'apiVersionNotice.rule.summary.ro-bg-fiscal-indemnity': 'Mzigo wenye msimbo wa UIT au UTN, au sababu ya kutokuwa nao, hubeba uthibitisho wa mtumaji kwamba ni sahihi (fiscalCodes.indemnity: true).',
};

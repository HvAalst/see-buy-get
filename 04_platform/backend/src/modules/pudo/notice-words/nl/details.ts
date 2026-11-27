import type { EN_DETAILS } from '../en/details';

export const NL_DETAILS: Record<keyof typeof EN_DETAILS, string> = {
  'dispatch.loadHeld.where.pickup': 'bij het ophalen',
  'dispatch.loadHeld.where.road': 'onderweg',
  'dispatch.loadHeld.where.delivery': 'bij het afleveren',
  'dispatch.cancelled.reason.collectedAtShop': 'het pakket is in de winkel opgehaald',
  'dispatch.window.before': 'vóór {to}',
  'dispatch.window.from': 'vanaf {from}',

  'vehicle.class.bike': 'fiets',
  'vehicle.class.motorcycle': 'motor',
  'vehicle.class.tuktuk': 'tuktuk',
  'vehicle.class.car': 'auto',
  'vehicle.class.van': 'bestelbus',
  'vehicle.class.bus': 'bus',
  'vehicle.class.truck': 'vrachtwagen',

  'dispatch2.serviceDue.line.overdueDay': 'Onderhoudsbeurt te laat: die had uiterlijk {day} gedaan moeten zijn',
  'dispatch2.serviceDue.line.overdueKm': 'Onderhoudsbeurt te laat: die had bij {due} km gedaan moeten zijn, en de teller staat op {km} km',
  'dispatch2.serviceDue.line.soon': 'Onderhoudsbeurt binnenkort: {when}',
  'dispatch2.serviceDue.line.soonReads': 'Onderhoudsbeurt binnenkort: {when} (de teller staat op {km} km)',
  'dispatch2.serviceDue.byDay': 'uiterlijk {day}',
  'dispatch2.serviceDue.atKm': 'bij {km} km',
  'dispatch2.serviceDue.either': '{a} of {b}, wat het eerst komt',
  'dispatch2.breakdown.theCourier': 'De koerier',

  'importer.list': '{a}, {b}',
  'importer.airGap.transit': 'de transitvrijgave bij de douane in {country}',
  'importer.airGap.customs': 'de vrijgave door de douane',
  'importer.airGap.agency': 'de vrijgave door {agency}',
  'importer.airGap.deliveryOrder': 'de leveringsopdracht van de afhandelaar',
  'importer.airGap.charges': 'de betaalde kosten van de afhandelaar',
  'importer.airArrival.office.customsKE': 'Douanecontrole (KRA)',

  'idDispute.slot': '{from} tot {to}',

  'pickupAhead.refused.reason.noVehicle': 'Ze zitten niet meer op een voertuig',
  'pickupAhead.refused.reason.status': 'De zak is {status}',
  'pickupAhead.refused.reason.hubDown': 'De hub ligt stil',
  'pickupAhead.refused.reason.tooHeavy': 'Hij weegt {kg} kg, meer dan er op hun voertuig nog bij kan',
  'pickupAhead.refused.reason.noPlace': 'Hun voertuig heeft geen plek voor een zak meer',
  'pickupAhead.refused.reason.cannotCarry': 'Hun voertuig kan niet vervoeren wat erin zit',
  'bag.status.free': 'niet in gebruik',
  'bag.status.filling': 'nog in vulling',
  'bag.status.claimed': 'door een bestuurder genomen',
  'bag.status.in_transit': 'onderweg',

  'apiVersionNotice.rule.summary.dangerous-goods-un-number': 'Een lading gevaarlijke stoffen (chemisch, biologisch of brandbaar) wordt geweigerd zonder UN-nummer, juiste vervoersnaam en klasse.',
  'apiVersionNotice.rule.summary.vehicle-energy': 'Een voertuig wordt geregistreerd met waarop het rijdt (energy: benzine, diesel, elektrisch, hybride, gas, of pedalen voor een fiets).',
  'apiVersionNotice.rule.summary.declaration-each-line': 'Een beveiligingsverklaring wordt ondertekend met elke regel afgevinkt (confirmed: het nummer van elke regel, vanaf 0).',
  'apiVersionNotice.rule.summary.ro-bg-fiscal-codes': 'Een lading die in Roemenië wordt overgenomen of afgeleverd, draagt de UIT-code van RO e-Transport, en in Bulgarije de UTN van goederen met een hoog fiscaal risico, of het woord van de afzender dat er geen nodig is en waarom (fiscalCodes).',
  'apiVersionNotice.rule.summary.ro-bg-fiscal-indemnity': 'Een lading met een UIT- of UTN-code, of een reden waarom die er niet is, draagt de verklaring van de afzender dat ze juist zijn (fiscalCodes.indemnity: true).',
};

import type { EN_DETAILS } from '../en/details';

export const BG_DETAILS: Record<keyof typeof EN_DETAILS, string> = {
  'dispatch.loadHeld.where.pickup': 'при вземането',
  'dispatch.loadHeld.where.road': 'на пътя',
  'dispatch.loadHeld.where.delivery': 'при доставката',
  'dispatch.cancelled.reason.collectedAtShop': 'пратката му е взета от магазина',
  'dispatch.window.before': 'преди {to}',
  'dispatch.window.from': 'от {from}',

  'vehicle.class.bike': 'велосипед',
  'vehicle.class.motorcycle': 'мотоциклет',
  'vehicle.class.tuktuk': 'тук-тук',
  'vehicle.class.car': 'автомобил',
  'vehicle.class.van': 'бус',
  'vehicle.class.bus': 'автобус',
  'vehicle.class.truck': 'камион',

  'dispatch2.serviceDue.line.overdueDay': 'Просрочено обслужване: е трябвало да бъде направено до {day}',
  'dispatch2.serviceDue.line.overdueKm': 'Просрочено обслужване: е трябвало да бъде направено при {due} km, а километражът показва {km} km',
  'dispatch2.serviceDue.line.soon': 'Наближава обслужване: {when}',
  'dispatch2.serviceDue.line.soonReads': 'Наближава обслужване: {when} (километражът показва {km} km)',
  'dispatch2.serviceDue.byDay': 'до {day}',
  'dispatch2.serviceDue.atKm': 'при {km} km',
  'dispatch2.serviceDue.either': '{a} или {b}, което настъпи първо',
  'dispatch2.breakdown.theCourier': 'Превозвачът',

  'importer.list': '{a}, {b}',
  'importer.airGap.transit': 'транзитното освобождаване от митницата в {country}',
  'importer.airGap.customs': 'митническото освобождаване',
  'importer.airGap.agency': 'освобождаването от {agency}',
  'importer.airGap.deliveryOrder': 'нареждането за доставка от обработващия товара',
  'importer.airGap.charges': 'платените такси на обработващия товара',
  'importer.airArrival.office.customsKE': 'Митническа проверка (KRA)',

  'idDispute.slot': '{from} до {to}',

  'pickupAhead.refused.reason.noVehicle': 'Те вече не са на превозно средство',
  'pickupAhead.refused.reason.status': 'Торбата е {status}',
  'pickupAhead.refused.reason.hubDown': 'Нейният хъб не работи',
  'pickupAhead.refused.reason.tooHeavy': 'Тежи {kg} kg, повече от оставащото в превозното им средство',
  'pickupAhead.refused.reason.noPlace': 'Превозното им средство няма останало място за торба',
  'pickupAhead.refused.reason.cannotCarry': 'Превозното им средство не може да превози това, което е в нея',
  'bag.status.free': 'неизползвана',
  'bag.status.filling': 'още се пълни',
  'bag.status.claimed': 'взета от шофьор',
  'bag.status.in_transit': 'на път',

  'apiVersionNotice.rule.summary.dangerous-goods-un-number': 'Товар с опасни стоки (химически, биологични или запалими) се отказва без своя UN номер, правилно наименование за превоз и клас.',
  'apiVersionNotice.rule.summary.vehicle-energy': 'Превозно средство се регистрира с това, на което работи (energy: бензин, дизел, електричество, хибрид, газ или педали за велосипед).',
  'apiVersionNotice.rule.summary.declaration-each-line': 'Декларация за сигурност се подписва с отметнат всеки неин ред (confirmed: номерът на всеки ред, от 0).',
  'apiVersionNotice.rule.summary.ro-bg-fiscal-codes': 'Товар, поет или доставен в Румъния, носи кода UIT на RO e-Transport, а в България UTN на стоки с висок фискален риск, или заявлението на подателя, че такъв не е нужен, и защо (fiscalCodes).',
  'apiVersionNotice.rule.summary.ro-bg-fiscal-indemnity': 'Товар с код UIT или UTN, или с причина за липсата им, носи удостоверението на подателя, че са верни (fiscalCodes.indemnity: true).',
};

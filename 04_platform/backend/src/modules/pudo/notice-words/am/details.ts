import type { EN_DETAILS } from '../en/details';

export const AM_DETAILS: Record<keyof typeof EN_DETAILS, string> = {
  'dispatch.loadHeld.where.pickup': 'በመውሰጃው ላይ',
  'dispatch.loadHeld.where.road': 'በመንገድ ላይ',
  'dispatch.loadHeld.where.delivery': 'በማድረሻው ላይ',
  'dispatch.cancelled.reason.collectedAtShop': 'ጥቅሉ በሱቁ ተወስዷል',
  'dispatch.window.before': 'ከ{to} በፊት',
  'dispatch.window.from': 'ከ{from} ጀምሮ',

  'vehicle.class.bike': 'ብስክሌት',
  'vehicle.class.motorcycle': 'ሞተር ሳይክል',
  'vehicle.class.tuktuk': 'ባጃጅ',
  'vehicle.class.car': 'መኪና',
  'vehicle.class.van': 'ቫን',
  'vehicle.class.bus': 'አውቶቡስ',
  'vehicle.class.truck': 'የጭነት መኪና',

  'dispatch2.serviceDue.line.overdueDay': 'አገልግሎቱ ዘግይቷል፦ እስከ {day} ድረስ መደረግ ነበረበት',
  'dispatch2.serviceDue.line.overdueKm': 'አገልግሎቱ ዘግይቷል፦ በ{due} ኪ.ሜ መደረግ ነበረበት፤ አሁን {km} ኪ.ሜ ያሳያል',
  'dispatch2.serviceDue.line.soon': 'አገልግሎት ሊደርስ ነው፦ {when}',
  'dispatch2.serviceDue.line.soonReads': 'አገልግሎት ሊደርስ ነው፦ {when} ({km} ኪ.ሜ ያሳያል)',
  'dispatch2.serviceDue.byDay': 'እስከ {day}',
  'dispatch2.serviceDue.atKm': 'በ{km} ኪ.ሜ',
  'dispatch2.serviceDue.either': '{a} ወይም {b}፣ የቀደመው',
  'dispatch2.breakdown.theCourier': 'አጓጓዡ',

  'importer.list': '{a}፣ {b}',
  'importer.airGap.transit': 'በ{country} ጉምሩክ የሚደረገው የትራንዚት መልቀቂያ',
  'importer.airGap.customs': 'የጉምሩክ መልቀቂያ',
  'importer.airGap.agency': 'በ{agency} የሚደረገው መልቀቂያ',
  'importer.airGap.deliveryOrder': 'የአስተናጋጁ የርክክብ ትዕዛዝ',
  'importer.airGap.charges': 'የተከፈለው የአስተናጋጁ ክፍያ',
  'importer.airArrival.office.customsKE': 'የጉምሩክ ማረጋገጫ (KRA)',

  'idDispute.slot': '{from} እስከ {to}',

  'pickupAhead.refused.reason.noVehicle': 'እነሱ ከእንግዲህ በተሽከርካሪ ላይ አይደሉም',
  'pickupAhead.refused.reason.status': 'ቦርሳው {status}',
  'pickupAhead.refused.reason.hubDown': 'ሃቡ አይሠራም',
  'pickupAhead.refused.reason.tooHeavy': '{kg} ኪ.ግ ይመዝናል፤ ከተሽከርካሪያቸው ቀሪ አቅም በላይ ነው',
  'pickupAhead.refused.reason.noPlace': 'ተሽከርካሪያቸው የቀረው የቦርሳ ቦታ የለውም',
  'pickupAhead.refused.reason.cannotCarry': 'ተሽከርካሪያቸው በውስጡ ያለውን መሸከም አይችልም',
  'bag.status.free': 'ጥቅም ላይ አይደለም',
  'bag.status.filling': 'አሁንም እየሞላ ነው',
  'bag.status.claimed': 'በሹፌር ተወስዷል',
  'bag.status.in_transit': 'በመንገድ ላይ ነው',

  'apiVersionNotice.rule.summary.dangerous-goods-un-number': 'አደገኛ ዕቃ (ኬሚካል፣ ባዮሎጂካል ወይም ተቀጣጣይ) ጭነት ያለ UN ቁጥሩ፣ ትክክለኛ የማጓጓዣ ስሙና ክፍሉ ውድቅ ይደረጋል።',
  'apiVersionNotice.rule.summary.vehicle-energy': 'ተሽከርካሪ የሚሠራበትን ነገር ይዞ ይመዘገባል (energy፦ ቤንዚን፣ ናፍጣ፣ ኤሌክትሪክ፣ ሃይብሪድ፣ ጋዝ፣ ወይም ለብስክሌት ፔዳል)።',
  'apiVersionNotice.rule.summary.declaration-each-line': 'የደህንነት መግለጫ እያንዳንዱ መስመሩ ምልክት ተደርጎበት ይፈረማል (confirmed፦ የእያንዳንዱ መስመር ቁጥር፣ ከ0 ጀምሮ)።',
  'apiVersionNotice.rule.summary.ro-bg-fiscal-codes': 'በሮማኒያ የተረከበ ወይም የደረሰ ጭነት የRO e-Transport UIT ኮድ ይይዛል፤ በቡልጋሪያ ደግሞ ከፍተኛ የግብር ስጋት ላላቸው ዕቃዎች UTN ይይዛል፤ ወይም አያስፈልግም የሚለውን የላኪውን ቃልና ምክንያቱን (fiscalCodes)።',
  'apiVersionNotice.rule.summary.ro-bg-fiscal-indemnity': 'የUIT ወይም UTN ኮድ ያለው ጭነት፣ ወይም ኮድ ያለመኖሩ ምክንያት ያለው ጭነት፣ ትክክል መሆናቸውን የላኪውን ማረጋገጫ ይይዛል (fiscalCodes.indemnity: true)።',
};

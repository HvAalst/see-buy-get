import type { EN_SAFETY } from '../en/safety';

export const AM_SAFETY: Record<keyof typeof EN_SAFETY, string> = {
  'accountSafety.pinLocked.title': 'PINዎ ተቆልፏል',
  'accountSafety.pinLocked.what': 'አንድ ሰው ለስልክ ቁጥርዎ የተሳሳተ PIN አምስት ጊዜ አስገብቷል፤ ስለዚህ አሁን ማንም በእሱ መግባት አይችልም።',
  'accountSafety.pinLocked.next': 'እንደገና ለመግባት ስልክዎን በኮድ አረጋግጠው አዲስ PIN ይምረጡ። እርስዎ ካልሆኑ፣ አንድ ሰው ቁጥርዎን ያውቃል፤ ማንም ሊገምተው የማይችል PIN ይምረጡ።',

  'accountSafety.pinReplaced.title': 'PINዎ ተተክቷል',
  'accountSafety.pinReplaced.what.newDevice': 'የ SeeBuyGet መለያዎ PIN ከዚህ በፊት ባልገባበት ስልክ ወይም አሳሽ ላይ ተተክቷል፤ ወደ ስልክ ቁጥርዎ በተላከ ኮድ እና ወደዚህ የኢሜይል አድራሻ በተላከ ኮድ። PINዎ አሁን እዚያ ብቻ ይሠራል።',
  'accountSafety.pinReplaced.what.known': 'የ SeeBuyGet መለያዎ PIN ወደ ስልክ ቁጥርዎ በተላከ ኮድ ከዚህ በፊት በገቡበት ስልክ ወይም አሳሽ ላይ ተተክቷል። PINዎ አሁን እዚያ ብቻ ይሠራል።',
  'accountSafety.pinReplaced.next': 'እርስዎ ከሆኑ፣ ምንም ማድረግ አያስፈልግም። እርስዎ ካልሆኑ፦ PINዎን ወዲያውኑ እንደገና ይተኩ (በመግቢያ ገጹ ላይ “PINዎን ረሱት?”) — ይህ ሌላውን ስልክና አሳሽ ሁሉ ያስወጣል — እና ቁጥርዎ ወደ ሌላ SIM ተዛውሮ እንደሆነ የሞባይል አገልግሎት ሰጪዎን ይጠይቁ።',

  'accountSafety.newDevice.title': 'አዲስ ስልክ ወይም አሳሽ PINዎን መጠቀም ይችላል',
  'accountSafety.newDevice.what': 'ወደ ስልክ ቁጥርዎ የተላከ ኮድ ከዚህ በፊት ወደ SeeBuyGet መለያዎ ባልገባ ስልክ ወይም አሳሽ ላይ ገብቷል። PINዎ አሁን እዚያም ይሠራል።',
  'accountSafety.newDevice.next': 'እርስዎ ከሆኑ፣ ምንም ማድረግ አያስፈልግም። እርስዎ ካልሆኑ፦ PINዎን ወዲያውኑ ይተኩ (በመግቢያ ገጹ ላይ “PINዎን ረሱት?”)። ይህ ሌላውን ስልክና አሳሽ ሁሉ ያስወጣል። ያለ PINዎ ማንም አይገባም — ነገር ግን አንድ ሰው ወደ ቁጥርዎ የሚላኩ መልዕክቶችን ማንበብ ይችላል።',

  'accountSafety.emailChanged.title': 'የመልሶ ማግኛ ኢሜይልዎ ተቀይሯል',
  'accountSafety.emailChanged.what': 'የ SeeBuyGet መለያዎ የኢሜይል አድራሻ አሁን {email} ነው። ይህ አድራሻ ማሳወቂያዎቹን ከእንግዲህ አይቀበልም።',
  'accountSafety.emailChanged.next': 'እርስዎ ካልሆኑ፣ ይግቡና PINዎን ወዲያውኑ ይቀይሩ፣ ከዚያም የመልሶ ማግኛ ኢሜይሉን እንደገና ያስገቡ።',

  'accountSafety.closed.title': 'መለያዎ ተዘግቷል',
  'accountSafety.closed.what': 'የ SeeBuyGet መለያዎ ተዘግቷል። ስምዎ፣ የመታወቂያ ቁጥርዎ፣ የስልክ ቁጥርዎ፣ ኢሜይልዎ እና የመታወቂያ ፎቶዎችዎ ተወግደዋል።',
  'accountSafety.closed.next': 'እርስዎ ካልሆኑ፣ ወዲያውኑ ከ SeeBuyGet እገዛ “የእኔ መረጃ፣ ወይም መለያዬን መዝጋት” ሥር ይጻፉልን።',

  'accountSafety.moveAsked.title': 'አንድ ሰው መለያዎ እንዲዛወር ጠይቋል',
  'accountSafety.moveAsked.what': 'አንድ ሰው የዚህን መለያ የስልክ ቁጥርና PIN እንደጠፋበት ለ SeeBuyGet ነግሮ መለያው በ {ends} ወደሚያልቅ ቁጥር እንዲዛወር ጠይቋል። ምንም ነገር ከመለወጡ በፊት ሁለት ሠራተኞች ማን እንደጠየቀ ያረጋግጣሉ።',
  'accountSafety.moveAsked.next': 'እርስዎ ከሆኑ፣ እዚህ ምንም ማድረግ አያስፈልግም። እርስዎ ካልሆኑ፦ በቁጥርዎና በPINዎ ወደ ማንኛውም የ SeeBuyGet መተግበሪያ ይግቡ — ይህ ብቻውን ያቆመዋል — ከዚያ ራስዎ ማቆም የሚችሉበትን ቅንብሮች ይክፈቱና አዲስ PIN ይምረጡ።',

  'accountSafety.moveRefused.title': 'መለያዎን የማዛወር ጥያቄ ተከልክሏል',
  'accountSafety.moveRefused.what': 'የ SeeBuyGet ሠራተኞች መለያዎን ወደ ሌላ የስልክ ቁጥር የማዛወር ጥያቄውን ተመልክተው ከልክለውታል። በመለያዎ ላይ ምንም አልተቀየረም።',
  'accountSafety.moveRefused.next': 'እርስዎ ካልጠየቁ፣ አዲስ PIN ይምረጡ፤ አንድ ሰው የስልክ ቁጥርዎን ያውቃል፤ መለያውንም ለመውሰድ ሞክሯል።',

  'mail.safety.subject': 'SeeBuyGet: {headline}',
  'mail.safety.when': 'መቼ',
  'mail.safety.until': 'መቀልበስ የሚቻለው እስከ',
  'mail.safety.whatToDo': 'ምን ማድረግ እንዳለብዎ',
  'mail.safety.help': 'ለመግባት እገዛ',
  'mail.safety.reason': 'ይህን ኢሜይል የሚደርስዎት የ SeeBuyGet መለያ የመልሶ ማግኛ አድራሻ ስለሆነ ነው። ሁልጊዜ እናሳውቅዎታለን — ይህ ኢሜይል ሊጠፋ አይችልም።',
  'mail.footer.noReply': 'እባክዎ አይመልሱ — ይህ አድራሻ አይነበብም።',
  'mail.footer.helpLead': 'ለመግባት እና ለመለያዎ እገዛ፦',
  'mail.footer.helpLink': 'የ SeeBuyGet እገዛ',
};

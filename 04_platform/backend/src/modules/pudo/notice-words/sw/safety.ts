import type { EN_SAFETY } from '../en/safety';

export const SW_SAFETY: Record<keyof typeof EN_SAFETY, string> = {
  'accountSafety.pinLocked.title': 'PIN yako ilifungwa',
  'accountSafety.pinLocked.what': 'Mtu aliandika PIN isiyo sahihi mara tano kwa nambari yako ya simu, kwa hiyo hakuna anayeweza kuingia nayo sasa.',
  'accountSafety.pinLocked.next': 'Ili kuingia tena, thibitisha simu yako kwa msimbo na uchague PIN mpya. Ikiwa si wewe, mtu anajua nambari yako: chagua PIN ambayo hawezi kuikisia.',

  'accountSafety.pinReplaced.title': 'PIN yako ilibadilishwa',
  'accountSafety.pinReplaced.what.newDevice': 'PIN ya akaunti yako ya SeeBuyGet ilibadilishwa kwenye simu au kivinjari ambacho hakikuwahi kuingia nayo, kwa msimbo uliotumwa kwa nambari yako ya simu na msimbo uliotumwa kwa anwani hii ya barua pepe. PIN yako sasa inafanya kazi huko tu.',
  'accountSafety.pinReplaced.what.known': 'PIN ya akaunti yako ya SeeBuyGet ilibadilishwa, kwa msimbo uliotumwa kwa nambari yako ya simu, kwenye simu au kivinjari ulichowahi kuingia nacho. PIN yako sasa inafanya kazi huko tu.',
  'accountSafety.pinReplaced.next': 'Ikiwa ni wewe, hakuna cha kufanya. Ikiwa si wewe: badilisha PIN yako tena mara moja (“Umesahau PIN yako?” kwenye skrini ya kuingia) — hilo linazuia kila simu na kivinjari kingine — na uulize mtandao wako wa simu kama nambari yako ilihamishiwa kwenye SIM nyingine.',

  'accountSafety.newDevice.title': 'Simu au kivinjari kipya kinaweza kutumia PIN yako',
  'accountSafety.newDevice.what': 'Msimbo uliotumwa kwa nambari yako ya simu uliandikwa kwenye simu au kivinjari ambacho hakikuwahi kuingia kwenye akaunti yako ya SeeBuyGet. PIN yako sasa inafanya kazi huko pia.',
  'accountSafety.newDevice.next': 'Ikiwa ni wewe, hakuna cha kufanya. Ikiwa si wewe: badilisha PIN yako mara moja (“Umesahau PIN yako?” kwenye skrini ya kuingia). Hilo linazuia kila simu na kivinjari kingine. Hakuna anayeingia bila PIN yako — lakini mtu anaweza kusoma ujumbe unaotumwa kwa nambari yako.',

  'accountSafety.emailChanged.title': 'Barua pepe yako ya kurejesha ilibadilishwa',
  'accountSafety.emailChanged.what': 'Anwani ya barua pepe ya akaunti yako ya SeeBuyGet sasa ni {email}. Anwani hii haipokei tena arifa zake.',
  'accountSafety.emailChanged.next': 'Ikiwa si wewe, ingia na ubadilishe PIN yako mara moja, kisha weka tena barua pepe ya kurejesha.',

  'accountSafety.closed.title': 'Akaunti yako ilifungwa',
  'accountSafety.closed.what': 'Akaunti yako ya SeeBuyGet ilifungwa. Jina lako, nambari ya kitambulisho, nambari ya simu, barua pepe na picha za kitambulisho vimeondolewa.',
  'accountSafety.closed.next': 'Ikiwa si wewe, tuandikie mara moja kupitia msaada wa SeeBuyGet, chini ya “Data yangu, au kufunga akaunti yangu”.',

  'accountSafety.moveAsked.title': 'Mtu aliomba akaunti yako ihamishwe',
  'accountSafety.moveAsked.what': 'Mtu aliiambia SeeBuyGet kwamba amepoteza nambari ya simu ya akaunti hii na PIN yake, na akaomba akaunti ihamishiwe kwenye nambari inayoishia na {ends}. Wafanyakazi wawili hukagua nani anaomba kabla ya chochote kubadilika.',
  'accountSafety.moveAsked.next': 'Ikiwa ni wewe, hakuna cha kufanya hapa. Ikiwa SI wewe: ingia kwenye programu yoyote ya SeeBuyGet kwa nambari na PIN yako — hilo peke yake linalizuia — kisha fungua Mipangilio, ambako unaweza kulizuia mwenyewe, na uchague PIN mpya.',

  'accountSafety.moveRefused.title': 'Ombi la kuhamisha akaunti yako lilikataliwa',
  'accountSafety.moveRefused.what': 'Wafanyakazi wa SeeBuyGet walikagua ombi la kuhamisha akaunti yako kwenda nambari nyingine ya simu, na wakalikataa. Hakuna kilichobadilika kwenye akaunti yako.',
  'accountSafety.moveRefused.next': 'Ikiwa hukuliomba, chagua PIN mpya: mtu anajua nambari yako ya simu na alijaribu kuchukua akaunti.',

  'mail.safety.subject': 'SeeBuyGet: {headline}',
  'mail.safety.when': 'Lini',
  'mail.safety.until': 'Inaweza kutenguliwa hadi',
  'mail.safety.whatToDo': 'Cha kufanya',
  'mail.safety.help': 'Msaada wa kuingia',
  'mail.safety.reason': 'Unapokea barua pepe hii kwa sababu ni anwani ya kurejesha ya akaunti ya SeeBuyGet. Daima tunakuarifu — barua pepe hii haiwezi kuzimwa.',
  'mail.footer.noReply': 'Tafadhali usijibu — anwani hii haisomwi.',
  'mail.footer.helpLead': 'Msaada wa kuingia na wa akaunti yako:',
  'mail.footer.helpLink': 'Msaada wa SeeBuyGet',

  'mail.app.agent': 'Programu ya Shop',
  'mail.app.mdp': 'Programu ya Hub',
  'mail.app.fleet': 'Programu ya Fleet',
  'mail.app.driver': 'Programu ya Driver',
  'mail.app.vendor': 'Programu ya Store',
  'mail.app.send': 'Programu ya Send',
  'mail.app.console': 'konsoli ya waendeshaji',
  'mail.app.home': 'SeeBuyGet',
  'mail.app.business': 'Programu ya Business',
};

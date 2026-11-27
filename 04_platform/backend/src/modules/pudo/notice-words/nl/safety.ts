import type { EN_SAFETY } from '../en/safety';

export const NL_SAFETY: Record<keyof typeof EN_SAFETY, string> = {
  'accountSafety.pinLocked.title': 'Je pincode is geblokkeerd',
  'accountSafety.pinLocked.what': 'Iemand heeft vijf keer een verkeerde pincode ingetypt voor je telefoonnummer, dus niemand kan er nu mee inloggen.',
  'accountSafety.pinLocked.next': 'Om opnieuw in te loggen bevestig je je telefoon met een code en kies je een nieuwe pincode. Was jij het niet, dan kent iemand je nummer: kies een pincode die niemand kan raden.',

  'accountSafety.pinReplaced.title': 'Je pincode is vervangen',
  'accountSafety.pinReplaced.what.newDevice': 'De pincode van je SeeBuyGet-account is vervangen op een telefoon of browser waarop nog niet eerder was ingelogd, met een code naar je telefoonnummer en een code naar dit e-mailadres. Je pincode werkt nu alleen daar.',
  'accountSafety.pinReplaced.what.known': 'De pincode van je SeeBuyGet-account is vervangen, met een code naar je telefoonnummer, op een telefoon of browser waarop je eerder had ingelogd. Je pincode werkt nu alleen daar.',
  'accountSafety.pinReplaced.next': 'Was jij het, dan hoef je niets te doen. Was jij het niet: vervang je pincode meteen opnieuw (“PIN vergeten” op het inlogscherm) — dat sluit elke andere telefoon en browser uit — en vraag je mobiele provider of je nummer naar een andere simkaart is overgezet.',

  'accountSafety.newDevice.title': 'Een nieuwe telefoon of browser kan je pincode gebruiken',
  'accountSafety.newDevice.what': 'Een code die naar je telefoonnummer is gestuurd, is ingetypt op een telefoon of browser waarop nog niet eerder in je SeeBuyGet-account was ingelogd. Je pincode werkt nu ook daar.',
  'accountSafety.newDevice.next': 'Was jij het, dan hoef je niets te doen. Was jij het niet: vervang je pincode meteen (“PIN vergeten” op het inlogscherm). Dat sluit elke andere telefoon en browser uit. Niemand komt binnen zonder je pincode — maar iemand kan wel de berichten lezen die naar je nummer worden gestuurd.',

  'accountSafety.emailChanged.title': 'Je herstel-e-mailadres is gewijzigd',
  'accountSafety.emailChanged.what': 'Het e-mailadres van je SeeBuyGet-account is nu {email}. Dit adres ontvangt de meldingen niet meer.',
  'accountSafety.emailChanged.next': 'Was jij het niet, log dan in en verander meteen je pincode, en stel daarna het herstel-e-mailadres opnieuw in.',

  'accountSafety.closed.title': 'Je account is gesloten',
  'accountSafety.closed.what': 'Je SeeBuyGet-account is gesloten. Je naam, ID-nummer, telefoonnummer, e-mailadres en ID-foto’s zijn verwijderd.',
  'accountSafety.closed.next': 'Was jij het niet, schrijf ons dan meteen via de hulp van SeeBuyGet, onder “Mijn gegevens, of mijn account sluiten”.',

  'accountSafety.moveAsked.title': 'Iemand heeft gevraagd je account te verplaatsen',
  'accountSafety.moveAsked.what': 'Iemand heeft SeeBuyGet verteld dat het telefoonnummer van dit account en de pincode kwijt zijn, en heeft gevraagd het account te verplaatsen naar een nummer dat eindigt op {ends}. Twee medewerkers controleren wie er vraagt voordat er iets verandert.',
  'accountSafety.moveAsked.next': 'Ben jij het, dan hoef je hier niets te doen. Ben jij het NIET: log in bij een SeeBuyGet-app met je nummer en pincode — alleen dat al stopt het — open dan Instellingen, waar je het zelf kunt stoppen, en kies een nieuwe pincode.',

  'accountSafety.moveRefused.title': 'Het verzoek om je account te verplaatsen is geweigerd',
  'accountSafety.moveRefused.what': 'Medewerkers van SeeBuyGet hebben het verzoek bekeken om je account naar een ander telefoonnummer te verplaatsen en hebben het geweigerd. Er is niets veranderd aan je account.',
  'accountSafety.moveRefused.next': 'Heb je er niet om gevraagd, kies dan een nieuwe pincode: iemand kent je telefoonnummer en probeerde het account over te nemen.',

  'mail.safety.subject': 'SeeBuyGet: {headline}',
  'mail.safety.when': 'Wanneer',
  'mail.safety.until': 'Kan ongedaan worden gemaakt tot',
  'mail.safety.whatToDo': 'Wat te doen',
  'mail.safety.help': 'Hulp bij inloggen',
  'mail.safety.reason': 'Je krijgt deze e-mail omdat dit het hersteladres is van een SeeBuyGet-account. We laten het je altijd weten — deze e-mail kan niet worden uitgezet.',
  'mail.footer.noReply': 'Reageer hier niet op — dit adres wordt niet gelezen.',
  'mail.footer.helpLead': 'Hulp bij inloggen en je account:',
  'mail.footer.helpLink': 'SeeBuyGet-hulp',
};

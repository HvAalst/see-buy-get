import type { Messages } from './en';

/** Nederlands — Dutch (the Netherlands, 2026-11-09). Partial — any missing key falls back to English; the full version 1
 *  is words/nl/, fetched when Dutch is chosen, and the Dutch company's review lays over it. */
export const nl: Partial<Messages> = {
  'common.readAloud': 'Lees dit scherm voor',
  'common.stop': 'Stop',
  'common.retry': 'Probeer opnieuw',
  'common.cancel': 'Annuleren',
  'common.close': 'Sluiten',
  'common.back': 'Terug',
  'common.done': 'Klaar',
  'common.save': 'Opslaan',
  'common.skip': 'Overslaan',
  'common.next': 'Volgende',
  'common.loading': 'Laden…',
  'common.yes': 'Ja',
  'common.no': 'Nee',
  'common.language': 'Taal',
  'common.chooseLanguage': 'Kies je taal',
  'common.greeting': 'Hoi, {name}',
  'account.title': 'Je account',
  'update.title': 'Deze app moet worden bijgewerkt',
  'update.body': 'Er is een nieuwere versie nodig voordat je verder kunt werken.',
  'update.cta': 'Nu bijwerken',
  'offline.banner': 'Geen bereik — je ziet wat we het laatst wisten.',
};

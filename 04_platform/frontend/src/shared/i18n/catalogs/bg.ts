import type { Messages } from './en';

/** Български — Bulgarian (Bulgaria, 2026-11-22). Partial — any missing key falls back to English; the full version 1
 *  is words/bg/, fetched when Bulgarian is chosen, and the Bulgarian company's review lays over it. */
export const bg: Partial<Messages> = {
  'common.readAloud': 'Прочетете екрана на глас',
  'common.stop': 'Спиране',
  'common.retry': 'Опитайте отново',
  'common.cancel': 'Отказ',
  'common.close': 'Затвори',
  'common.back': 'Назад',
  'common.done': 'Готово',
  'common.save': 'Запази',
  'common.skip': 'Пропусни',
  'common.next': 'Напред',
  'common.loading': 'Зареждане…',
  'common.yes': 'Да',
  'common.no': 'Не',
  'common.language': 'Език',
  'common.chooseLanguage': 'Изберете своя език',
  'common.greeting': 'Здравейте, {name}',
  'account.title': 'Вашият профил',
  'update.title': 'Приложението трябва да се обнови',
  'update.body': 'Нужна е по-нова версия, за да можете да продължите работа.',
  'update.cta': 'Обновете сега',
  'offline.banner': 'Няма сигнал — показано е последното, което знаем.',
};

import type { Messages } from './en';

/** العربية — Arabic (North Africa / Sahel). RIGHT-TO-LEFT. Partial — any missing key falls back to English.
 *  Seed translations, to be reviewed by a native speaker. */
export const ar: Partial<Messages> = {
  'common.readAloud': 'اقرأ هذه الشاشة بصوت عالٍ',
  'common.stop': 'إيقاف',
  'common.retry': 'حاول مرة أخرى',
  'common.cancel': 'إلغاء',
  'common.close': 'إغلاق',
  'common.back': 'رجوع',
  'common.done': 'تم',
  'common.save': 'حفظ',
  'common.skip': 'تخطّي',
  'common.next': 'التالي',
  'common.loading': 'جارٍ التحميل…',
  'common.yes': 'نعم',
  'common.no': 'لا',
  'common.language': 'اللغة',
  'common.chooseLanguage': 'اختر لغتك',
  'common.greeting': 'مرحبًا {name}',
  'account.title': 'حسابك',
  'update.title': 'يحتاج هذا التطبيق إلى تحديث',
  'update.body': 'مطلوب إصدار أحدث قبل أن تتمكن من المتابعة.',
  'update.cta': 'حدّث الآن',
  'offline.banner': 'لا توجد إشارة — نعرض آخر ما عرفناه.',
};

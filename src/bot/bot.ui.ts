import { Markup } from 'telegraf';

export const BTN = {
  newAnalysis: '📊 Yangi tahlil',
  help: 'ℹ️ Yordam',
  cancel: '❌ Bekor qilish',
};

export const mainMenuKeyboard = Markup.keyboard([
  [BTN.newAnalysis],
  [BTN.help],
]).resize();

export const requestPhoneKeyboard = Markup.keyboard([
  [Markup.button.contactRequest('📱 Telefon raqamni yuborish')],
]).resize();

export const cancelKeyboard = Markup.keyboard([[BTN.cancel]]).resize();

export const analyzeInlineKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('✅ Tahlil qilish', 'analyze')],
  [Markup.button.callback('🗑 Bekor qilish', 'cancel')],
]);

export const TEXT = {
  welcome: (name: string) =>
    `Assalomu alaykum, ${name}! 👋\n\n` +
    `*PricePill* — farmatsevtlar uchun price-list taqqoslash xizmati.\n` +
    `Siz o‘z narxlaringizni raqobatchilarникidan arzon yoki qimmatligini ` +
    `bir necha soniyada bilib olasiz.\n\n` +
    `Davom etish uchun telefon raqamingizni yuboring 👇`,

  registered:
    `✅ Ro‘yxatdan o‘tdingiz!\n\n` +
    `Tahlilni boshlash uchun «📊 Yangi tahlil» tugmasini bosing.`,

  askOwn:
    `1️⃣ *O‘z price-listingizni* yuboring (Excel .xlsx).\n\n` +
    `Faylda quyidagi ustunlar bo‘lishi kerak:\n` +
    `• *Nomi*\n• *Ishlab chiqaruvchi*\n• *Kelish narxi*\n• *Sotish narxi*\n\n` +
    `📎 Faylni shu yerga biriktirib yuboring.`,

  askCompetitors:
    `2️⃣ Endi *taqqoslamoqchi bo‘lgan* price-list(lar)ni yuboring.\n\n` +
    `Bir nechtasini ketma-ket yuborishingiz mumkin. ` +
    `Tugatgach «✅ Tahlil qilish» tugmasini bosing.`,

  notRegistered: 'Avval /start bosing va ro‘yxatdan o‘ting.',
  notXlsx: '⚠️ Faqat Excel (.xlsx) fayl qabul qilinadi. Qayta yuboring.',
  noOwnYet: 'Avval «📊 Yangi tahlil» tugmasidan boshlang.',
  needCompetitors: '⚠️ Kamida bitta raqobatchi price-list yuboring.',
  analyzing: '⏳ Tahlil qilinmoqda...',
  cancelled: '❌ Bekor qilindi.',

  help:
    `*PricePill qanday ishlaydi?*\n\n` +
    `1. «📊 Yangi tahlil» ni bosasiz.\n` +
    `2. O‘z price-listingizni (.xlsx) yuborasiz.\n` +
    `3. Raqobatchilar price-listini yuborasiz (bir nechta bo‘lishi mumkin).\n` +
    `4. «✅ Tahlil qilish» ni bosasiz.\n` +
    `5. Tayyor Excel hisobotni olasiz: qaysi dorini qimmat yoki arzon ` +
    `sotayotganingiz — so‘mda, foizda va $ da.`,
};

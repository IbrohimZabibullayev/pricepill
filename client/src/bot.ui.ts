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
    `*PricePill* — farmatsevtlar uchun oson narx tahlilchisi.\n\n` +
    `Davom etish uchun telefon raqamingizni yuboring 👇`,

  registered:
    `✅ Ro‘yxatdan o‘tdingiz!\n\n` +
    `Tahlilni boshlash uchun «📊 Yangi tahlil» tugmasini bosing.`,

  askOwn:
    `1️⃣ *O‘z price-listingizni* yuboring (Excel .xlsx yoki .xls).\n\n` +
    `Faylda quyidagi ustunlar bo‘lishi kerak:\n` +
    `• *Nomi* (majburiy)\n• *Sotish narxi* (majburiy)\n` +
    `• *Ishlab chiqaruvchi*, *Davlat*, *Kelish narxi* (ixtiyoriy)\n\n` +
    `🌍 Fayl istalgan tilda bo‘lishi mumkin (o‘zbek, rus, ingliz, fransuz...).\n` +
    `📎 Faylni shu yerga biriktirib yuboring.`,

  askCompetitors:
    `2️⃣ Endi *taqqoslash uchun* price-list(lar)ni yuboring.\n\n` +
    `Bir nechtasini ketma-ket yuborishingiz mumkin. ` +
    `Tugatgach «✅ Tahlil qilish» tugmasini bosing.`,

  notRegistered: 'Avval /start bosing va ro‘yxatdan o‘ting.',
  notXlsx: '⚠️ Faqat Excel (.xlsx yoki .xls) fayl qabul qilinadi. Qayta yuboring.',
  noOwnYet: 'Avval «📊 Yangi tahlil» tugmasidan boshlang.',
  needCompetitors: '⚠️ Kamida bitta taqqoslash uchun price-list yuboring.',
  analyzing:
    '⏳ Tahlil boshlandi...\n\n' +
    "Katta price-listlar uchun bu 5-7 daqiqagacha davom etishi mumkin. " +
    "Tayyor bo'lishi bilan hisobotni shu yerga yuboraman — kutib turing.",
  cancelled: '❌ Bekor qilindi.',

  help:
    `*PricePill qanday ishlaydi?*\n\n` +
    `1. «📊 Yangi tahlil» ni bosasiz.\n` +
    `2. O‘z price-listingizni (.xlsx) yuborasiz.\n` +
    `3. Taqqoslash uchun price-list(lar)ni yuborasiz (bir nechta bo‘lishi mumkin).\n` +
    `4. «✅ Tahlil qilish» ni bosasiz.\n` +
    `5. Tayyor Excel hisobotni olasiz: qaysi dorini qimmat yoki arzon ` +
    `sotayotganingiz — so‘mda, foizda va $ da.`,
};

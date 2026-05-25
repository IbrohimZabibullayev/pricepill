# 💊 PricePill

Farmatsevtlar uchun **price-list taqqoslash** Telegram boti.
Siz o‘z narxlaringizni raqobatchilarникidan **arzon yoki qimmat** sotayotganingizni
— **so‘mda, foizda va $ da** — bir necha soniyada bilib olasiz.

## Texnologiyalar
- **NestJS** + **nestjs-telegraf** (bot)
- **PostgreSQL** + **Prisma** (foydalanuvchilar, tahlil tarixi)
- **ExcelJS** (.xlsx o‘qish/yozish)
- **fastest-levenshtein** (fuzzy matching — AI'siz)

## Bot oqimi
1. `/start` → telefon raqamni so‘raydi (tugma orqali).
2. «📊 Yangi tahlil» → o‘z price-listini (.xlsx) yuboradi.
3. Raqobatchi price-list(lar)ni yuboradi — bir nechta bo‘lishi mumkin.
4. «✅ Tahlil qilish» → tayyor Excel hisobot keladi.

## Price-list shabloni (.xlsx)
Birinchi qatorда sarlavhalar bo‘lsin (tartibi muhim emas, nomlar moslashtiriladi):

| Nomi | Ishlab chiqaruvchi | Kelish narxi | Sotish narxi |
|------|--------------------|--------------|--------------|
| Paratsetamol 500mg №10 | Nobel | 4000 | 6000 |

> `Nomi` va `Sotish narxi` — majburiy. Qolganlari ixtiyoriy.

## Lokal ishga tushirish
```bash
# 1. Paketlar
npm install

# 2. .env yarating (namunadan)
cp .env.example .env
#   BOT_TOKEN     — @BotFather'dan YANGI token
#   DATABASE_URL  — local yoki Railway Postgres

# 3. Bazani tayyorlash
npm run prisma:migrate

# 4. (ixtiyoriy) test fayllarini yaratish
npm run make:template      # sample/own.xlsx + sample/competitor.xlsx

# 5. Botni ishga tushirish
npm run start:dev
```

## Railway'ga deploy
1. Yangi project → **PostgreSQL** plugin qo‘shing.
2. Bu repo'ni ulang (GitHub).
3. **Variables**'ga qo‘ying:
   - `BOT_TOKEN` — yangi BotFather tokeni
   - `DATABASE_URL` — Postgres "Connect" → `${{Postgres.DATABASE_URL}}`
   - `USD_RATE`, `MATCH_THRESHOLD` (ixtiyoriy)
4. Deploy. `start:prod` avtomatik `prisma migrate deploy` ni bajaradi.

> Bot **long-polling** rejimida ishlaydi — webhook/ochiq port shart emas.

## ⚠️ Xavfsizlik
- `BOT_TOKEN` ni hech qachon kodga yozmang yoki commit qilmang — faqat `.env` / Railway Variables.
- `.env` allaqachon `.gitignore` da.

## Keyingi bosqichlar (MVP'dan keyin)
- PDF / rasm (PNG, JPG) qabul qilish — OCR yoki **Claude vision** orqali.
- Mahsulot nomlarini **embedding** bilan semantik moslashtirish (lotin/kirill).
- USD kursini avtomatik olish (CBU API).
- Next.js admin panel / landing.

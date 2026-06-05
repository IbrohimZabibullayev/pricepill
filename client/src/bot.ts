import { Telegraf, Context } from 'telegraf';
import * as dotenv from 'dotenv';
import { sessionManager, UploadedFile } from './session';
import { getUser, upsertUser, setPhone, startAnalysis, getAnalysisStatus, StatusResult } from './api';
import {
  BTN,
  TEXT,
  mainMenuKeyboard,
  requestPhoneKeyboard,
  cancelKeyboard,
  analyzeInlineKeyboard,
} from './bot.ui';

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('CRITICAL ERROR: BOT_TOKEN is not defined in the environment variables.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Error logging
bot.catch((err: any, ctx) => {
  console.error(`Telegraf error for ${ctx.updateType}:`, err);
});

// /start command handler
bot.start(async (ctx) => {
  const from = ctx.from!;
  try {
    const user = await upsertUser({
      id: from.id,
      username: from.username,
      firstName: from.first_name,
    });
    sessionManager.reset(from.id);

    if (!user.phone) {
      sessionManager.set(from.id, { step: 'awaiting_phone' });
      await ctx.replyWithMarkdown(TEXT.welcome(from.first_name ?? 'do‘stim'), requestPhoneKeyboard);
    } else {
      await ctx.replyWithMarkdown(TEXT.registered, mainMenuKeyboard);
    }
  } catch (err) {
    console.error('Start error:', err);
    await ctx.reply('Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko‘ring.');
  }
});

// Contact/phone handler
bot.on('contact', async (ctx) => {
  const from = ctx.from!;
  const contact = ctx.message.contact;

  if (!contact || contact.user_id !== from.id) {
    await ctx.reply('Iltimos, o‘zingizning raqamingizni tugma orqali yuboring.');
    return;
  }

  try {
    await setPhone(from.id, contact.phone_number);
    sessionManager.reset(from.id);
    await ctx.replyWithMarkdown(TEXT.registered, mainMenuKeyboard);
  } catch (err) {
    console.error('Contact submit error:', err);
    await ctx.reply('Telefon raqamini saqlashda xatolik yuz berdi.');
  }
});

// Help command or button
bot.hears(BTN.help, async (ctx) => {
  await ctx.replyWithMarkdown(TEXT.help, mainMenuKeyboard);
});

// Cancel command or button
bot.hears(BTN.cancel, async (ctx) => {
  sessionManager.reset(ctx.from!.id);
  await ctx.reply(TEXT.cancelled, mainMenuKeyboard);
});

// Start new analysis button
bot.hears(BTN.newAnalysis, async (ctx) => {
  const from = ctx.from!;
  try {
    const user = await getUser(from.id);
    if (!user || !user.phone) {
      sessionManager.set(from.id, { step: 'awaiting_phone' });
      await ctx.replyWithMarkdown(TEXT.welcome(from.first_name ?? ''), requestPhoneKeyboard);
      return;
    }
    sessionManager.reset(from.id);
    sessionManager.set(from.id, { step: 'awaiting_own' });
    await ctx.replyWithMarkdown(TEXT.askOwn, cancelKeyboard);
  } catch (err) {
    console.error('New analysis check error:', err);
    await ctx.reply('Xatolik yuz berdi, iltimos keyinroq urinib ko‘ring.');
  }
});

// Document/Excel file upload handler
bot.on('document', async (ctx) => {
  const from = ctx.from!;
  const doc = ctx.message.document;
  const state = sessionManager.get(from.id);

  try {
    const user = await getUser(from.id);
    if (!user || !user.phone) {
      await ctx.reply(TEXT.notRegistered);
      return;
    }

    if (state.step !== 'awaiting_own' && state.step !== 'awaiting_competitors') {
      await ctx.reply(TEXT.noOwnYet, mainMenuKeyboard);
      return;
    }

    if (!isXlsx(doc)) {
      await ctx.reply(TEXT.notXlsx);
      return;
    }

    const file: UploadedFile = { fileId: doc.file_id, fileName: doc.file_name ?? 'file.xlsx' };

    if (state.step === 'awaiting_own') {
      sessionManager.set(from.id, { own: file, step: 'awaiting_competitors' });
      await ctx.replyWithMarkdown(TEXT.askCompetitors, cancelKeyboard);
    } else {
      state.competitors.push(file);
      sessionManager.set(from.id, { competitors: state.competitors });
      await ctx.reply(
        `✅ «${file.fileName}» qo‘shildi (jami ${state.competitors.length} ta).\n` +
          `Yana yuborishingiz yoki tahlilni boshlashingiz mumkin:`,
        analyzeInlineKeyboard,
      );
    }
  } catch (err) {
    console.error('File upload handling error:', err);
    await ctx.reply('Faylni qayta ishlashda xatolik yuz berdi.');
  }
});

// Inline button: cancel action
bot.action('cancel', async (ctx) => {
  await ctx.answerCbQuery();
  sessionManager.reset(ctx.from!.id);
  await ctx.reply(TEXT.cancelled, mainMenuKeyboard);
});

// Inline button: start analyze action
bot.action('analyze', async (ctx) => {
  await ctx.answerCbQuery();
  const from = ctx.from!;
  const state = sessionManager.get(from.id);

  if (!state.own) {
    await ctx.reply(TEXT.noOwnYet, mainMenuKeyboard);
    return;
  }
  if (state.competitors.length === 0) {
    await ctx.reply(TEXT.needCompetitors);
    return;
  }

  await ctx.reply(TEXT.analyzing);

  try {
    // 1. Resolve direct download URLs from Telegram
    const ownUrl = (await ctx.telegram.getFileLink(state.own.fileId)).href;
    const competitorsWithUrls = [];

    for (const comp of state.competitors) {
      const compUrl = (await ctx.telegram.getFileLink(comp.fileId)).href;
      competitorsWithUrls.push({
        fileName: comp.fileName,
        url: compUrl,
      });
    }

    // 2. Tahlilni boshlaymiz — backend darrov jobId qaytaradi (so'rov qisqa).
    const { jobId } = await startAnalysis({
      telegramId: from.id,
      own: {
        fileName: state.own.fileName,
        url: ownUrl,
      },
      competitors: competitorsWithUrls,
    });

    // 3. Holatni QISQA so'rovlar bilan so'rab turamiz. Har so'rov tez tugaydi,
    //    shuning uchun Railway proxy'si hech narsani uzmaydi (502 yo'q). Katta
    //    price-listlar uchun tahlil 5-7 daqiqa davom etishi mumkin.
    const res = await pollUntilDone(jobId);

    if (res.status === 'error') {
      throw new Error(res.message || 'Tahlil natijasi bo‘sh keldi.');
    }
    if (!res.reportBase64) {
      throw new Error('Tahlil tugadi, lekin hisobot bo‘sh keldi.');
    }

    // 4. Convert base64 back to buffer and reply
    const buffer = Buffer.from(res.reportBase64, 'base64');

    await ctx.replyWithDocument(
      { source: buffer, filename: reportName() },
      {
        caption:
          `✅ Tayyor!\n\n` +
          `📦 Jami mahsulot: *${res.totalCount}*\n` +
          `🔎 Topildi: *${res.matchedCount}*\n` +
          `❌ Topilmadi: *${res.notFoundCount}*\n\n` +
          `Batafsil — fayl ichida.`,
        parse_mode: 'Markdown',
        ...mainMenuKeyboard,
      },
    );
  } catch (err: any) {
    console.error('Analysis execution error:', err);
    await ctx.reply(
      `❌ Tahlilda xatolik yuz berdi: ${err.message || 'Kutilmagan muammo'}.\nFayllarni tekshirib qayta urinib ko‘ring.`,
      mainMenuKeyboard,
    );
  } finally {
    sessionManager.reset(from.id);
  }
});

/**
 * Job tugaguncha holatni qisqa intervalda so'rab turadi. Har bir so'rov tez
 * tugaydi — uzoq ulanish ochib qo'yilmaydi, shuning uchun proxy timeout (502)
 * bo'lmaydi. `done` yoki `error` qaytsa to'xtaydi; juda uzoq cho'zilsa — xato.
 */
async function pollUntilDone(jobId: string): Promise<StatusResult> {
  const POLL_INTERVAL_MS = 7000; // har 7 soniyada bir tekshiramiz
  const MAX_WAIT_MS = 15 * 60 * 1000; // 15 daqiqa — bundan ortig'i = nimadir buzilgan
  const started = Date.now();

  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    let st: StatusResult;
    try {
      st = await getAnalysisStatus(jobId);
    } catch (err: any) {
      // Job topilmasa (404 — server qayta ishga tushgan) yoki tarmoq sakrasa —
      // vaqt tugaguncha yana urinamiz, bitta uzilish tahlilni buzmasin.
      if (Date.now() - started > MAX_WAIT_MS) throw err;
      continue;
    }
    if (st.status === 'done' || st.status === 'error') return st;
    if (Date.now() - started > MAX_WAIT_MS) {
      throw new Error('Tahlil juda uzoq davom etdi (15 daqiqadan oshdi).');
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper validation functions
function isXlsx(doc: any): boolean {
  if (!doc) return false;
  const name = String(doc.file_name ?? '').toLowerCase();
  const mime = String(doc.mime_type ?? '');
  return (
    name.endsWith('.xlsx') ||
    name.endsWith('.xls') ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel'
  );
}

function reportName(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `PricePill_hisobot_${stamp}.xlsx`;
}

// Start the bot.
// launch() polls until the bot is stopped, and rejects on a fatal Telegram
// error. A 409 Conflict means another instance is still polling the same
// token — most often during Railway's zero-downtime deploys, where the old
// container lingers a few seconds before SIGTERM. Retry with backoff so the
// new instance waits it out instead of crash-looping.
async function launchBot(): Promise<void> {
  const MAX_CONFLICT_RETRIES = 10;
  const RETRY_DELAY_MS = 5000;
  let conflicts = 0;
  let announced = false;

  for (;;) {
    try {
      await bot.launch({ dropPendingUpdates: true }, () => {
        if (!announced) {
          announced = true;
          console.log('🟢 PricePill Bot client started successfully.');
        }
      });
      return; // resolved => bot was stopped gracefully
    } catch (err: any) {
      const code = err?.response?.error_code ?? err?.code;
      if (code === 409 && conflicts < MAX_CONFLICT_RETRIES) {
        conflicts += 1;
        console.warn(
          `⚠️  409 Conflict: another bot instance is still polling. ` +
            `Retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${conflicts}/${MAX_CONFLICT_RETRIES})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      console.error('Bot launch failed:', err);
      process.exit(1);
    }
  }
}

void launchBot();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

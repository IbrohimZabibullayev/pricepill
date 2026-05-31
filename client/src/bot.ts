import { Telegraf, Context } from 'telegraf';
import * as dotenv from 'dotenv';
import { sessionManager, UploadedFile } from './session';
import { getUser, upsertUser, setPhone, analyzePrices } from './api';
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

    // 2. Call backend analyze API
    const res = await analyzePrices({
      telegramId: from.id,
      own: {
        fileName: state.own.fileName,
        url: ownUrl,
      },
      competitors: competitorsWithUrls,
    });

    if (!res.success || !res.reportBase64) {
      throw new Error('Tahlil natijasi bo‘sh keldi.');
    }

    // 3. Convert base64 back to buffer and reply
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

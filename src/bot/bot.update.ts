import { Logger } from '@nestjs/common';
import { Action, Ctx, Hears, On, Start, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { UsersService } from '../users/users.service';
import { PriceList } from '../pricelist/pricelist.types';
import { PriceListParseError, PricelistService } from '../pricelist/pricelist.service';
import { MatchingService } from '../matching/matching.service';
import { ReportService } from '../report/report.service';
import { SessionService, UploadedFile } from './session.service';
import {
  analyzeInlineKeyboard,
  cancelKeyboard,
  mainMenuKeyboard,
  requestPhoneKeyboard,
  BTN,
  TEXT,
} from './bot.ui';

@Update()
export class BotUpdate {
  private readonly logger = new Logger(BotUpdate.name);

  constructor(
    private readonly users: UsersService,
    private readonly session: SessionService,
    private readonly pricelist: PricelistService,
    private readonly matching: MatchingService,
    private readonly report: ReportService,
  ) {}

  @Start()
  async onStart(@Ctx() ctx: Context) {
    const from = ctx.from!;
    const user = await this.users.upsertFromTelegram({
      id: from.id,
      username: from.username,
      firstName: from.first_name,
    });
    this.session.reset(from.id);

    if (!user.phone) {
      this.session.set(from.id, { step: 'awaiting_phone' });
      await ctx.replyWithMarkdown(TEXT.welcome(from.first_name ?? 'do‘stim'), requestPhoneKeyboard);
    } else {
      await ctx.replyWithMarkdown(TEXT.registered, mainMenuKeyboard);
    }
  }

  @On('contact')
  async onContact(@Ctx() ctx: Context) {
    const from = ctx.from!;
    const contact = (ctx.message as any)?.contact;
    // Faqat o'zining raqamini qabul qilamiz (boshqa kontaktni emas).
    if (!contact || contact.user_id !== from.id) {
      await ctx.reply('Iltimos, o‘zingizning raqamingizni tugma orqali yuboring.');
      return;
    }
    await this.users.setPhone(from.id, contact.phone_number);
    this.session.reset(from.id);
    await ctx.replyWithMarkdown(TEXT.registered, mainMenuKeyboard);
  }

  @Hears(BTN.help)
  async onHelp(@Ctx() ctx: Context) {
    await ctx.replyWithMarkdown(TEXT.help, mainMenuKeyboard);
  }

  @Hears(BTN.cancel)
  async onCancelText(@Ctx() ctx: Context) {
    this.session.reset(ctx.from!.id);
    await ctx.reply(TEXT.cancelled, mainMenuKeyboard);
  }

  @Hears(BTN.newAnalysis)
  async onNewAnalysis(@Ctx() ctx: Context) {
    const from = ctx.from!;
    const user = await this.users.findByTelegramId(from.id);
    if (!user?.phone) {
      this.session.set(from.id, { step: 'awaiting_phone' });
      await ctx.replyWithMarkdown(TEXT.welcome(from.first_name ?? ''), requestPhoneKeyboard);
      return;
    }
    this.session.reset(from.id);
    this.session.set(from.id, { step: 'awaiting_own' });
    await ctx.replyWithMarkdown(TEXT.askOwn, cancelKeyboard);
  }

  @On('document')
  async onDocument(@Ctx() ctx: Context) {
    const from = ctx.from!;
    const doc = (ctx.message as any)?.document;
    const state = this.session.get(from.id);

    const user = await this.users.findByTelegramId(from.id);
    if (!user?.phone) {
      await ctx.reply(TEXT.notRegistered);
      return;
    }
    if (state.step !== 'awaiting_own' && state.step !== 'awaiting_competitors') {
      await ctx.reply(TEXT.noOwnYet, mainMenuKeyboard);
      return;
    }
    if (!this.isXlsx(doc)) {
      await ctx.reply(TEXT.notXlsx);
      return;
    }

    const file: UploadedFile = { fileId: doc.file_id, fileName: doc.file_name };

    if (state.step === 'awaiting_own') {
      this.session.set(from.id, { own: file, step: 'awaiting_competitors' });
      await ctx.replyWithMarkdown(TEXT.askCompetitors, cancelKeyboard);
    } else {
      state.competitors.push(file);
      this.session.set(from.id, { competitors: state.competitors });
      await ctx.reply(
        `✅ «${file.fileName}» qo‘shildi (jami ${state.competitors.length} ta).\n` +
          `Yana yuborishingiz yoki tahlilni boshlashingiz mumkin:`,
        analyzeInlineKeyboard,
      );
    }
  }

  @Action('cancel')
  async onCancelAction(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    this.session.reset(ctx.from!.id);
    await ctx.reply(TEXT.cancelled, mainMenuKeyboard);
  }

  @Action('analyze')
  async onAnalyze(@Ctx() ctx: Context) {
    await ctx.answerCbQuery();
    const from = ctx.from!;
    const state = this.session.get(from.id);

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
      const ownList = await this.downloadAndParse(ctx, state.own);
      const competitorLists: PriceList[] = [];
      for (const c of state.competitors) {
        competitorLists.push(await this.downloadAndParse(ctx, c));
      }

      const rows = await this.matching.compare(ownList, competitorLists);
      const matched = rows.filter((r) => r.verdict !== 'NOT_FOUND').length;
      const buffer = await this.report.build(rows, ownList.fileName);

      await ctx.replyWithDocument(
        { source: buffer, filename: this.reportName() },
        {
          caption:
            `✅ Tayyor!\n\n` +
            `📦 Jami mahsulot: *${rows.length}*\n` +
            `🔎 Topildi: *${matched}*\n` +
            `❌ Topilmadi: *${rows.length - matched}*\n\n` +
            `Batafsil — fayl ichida.`,
          parse_mode: 'Markdown',
          ...mainMenuKeyboard,
        },
      );

      await this.users.logAnalysis({
        telegramId: from.id,
        ownFileName: ownList.fileName,
        competitorCount: competitorLists.length,
        ownProductCount: rows.length,
        matchedCount: matched,
      });
    } catch (e) {
      if (e instanceof PriceListParseError) {
        await ctx.reply(`⚠️ ${e.message}`, mainMenuKeyboard);
      } else {
        this.logger.error('Tahlil xatosi', e as any);
        await ctx.reply(
          '❌ Tahlilda kutilmagan xatolik yuz berdi. Fayllarni tekshirib qayta urinib ko‘ring.',
          mainMenuKeyboard,
        );
      }
    } finally {
      this.session.reset(from.id);
    }
  }

  // --- yordamchilar ---

  private isXlsx(doc: any): boolean {
    if (!doc) return false;
    const name = String(doc.file_name ?? '').toLowerCase();
    return (
      name.endsWith('.xlsx') ||
      doc.mime_type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  }

  private async downloadAndParse(ctx: Context, file: UploadedFile): Promise<PriceList> {
    const link = await ctx.telegram.getFileLink(file.fileId);
    const res = await fetch(link.href);
    if (!res.ok) {
      throw new PriceListParseError(`«${file.fileName}» faylini yuklab bo‘lmadi.`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return this.pricelist.parse(buffer, file.fileName);
  }

  private reportName(): string {
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    return `PricePill_hisobot_${stamp}.xlsx`;
  }
}

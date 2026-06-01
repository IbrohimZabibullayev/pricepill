import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { PricelistService, PriceListParseError } from '../pricelist/pricelist.service';
import { MatchingService } from '../matching/matching.service';
import { ReportService } from '../report/report.service';
import { UsersService } from '../users/users.service';
import { PriceList } from '../pricelist/pricelist.types';

@Controller('analyze')
export class AnalysisController {
  constructor(
    private readonly pricelist: PricelistService,
    private readonly matching: MatchingService,
    private readonly report: ReportService,
    private readonly users: UsersService,
  ) {}

  @Post()
  async analyze(
    @Body()
    body: {
      telegramId: number;
      own: { fileName: string; url: string };
      competitors: Array<{ fileName: string; url: string }>;
    },
  ) {
    if (!body.own || !body.competitors || body.competitors.length === 0) {
      throw new HttpException('Fayllar to‘liq yuborilmadi.', HttpStatus.BAD_REQUEST);
    }

    try {
      // 1. Download and parse own list
      const ownList = await this.downloadAndParse(body.own);

      // 2. Download and parse competitors list
      const competitorLists: PriceList[] = [];
      for (const comp of body.competitors) {
        competitorLists.push(await this.downloadAndParse(comp));
      }

      // 3. Run comparison
      const rows = await this.matching.compare(ownList, competitorLists);
      const matched = rows.filter((r) => r.verdict !== 'NOT_FOUND').length;

      // 4. Generate report excel
      const buffer = await this.report.build(rows, ownList.fileName);

      // 5. Log the analysis
      try {
        await this.users.logAnalysis({
          telegramId: body.telegramId,
          ownFileName: ownList.fileName,
          competitorCount: competitorLists.length,
          ownProductCount: rows.length,
          matchedCount: matched,
        });
      } catch (logErr) {
        // Do not fail the whole request if log analysis fails
        console.error('Failed to log analysis:', logErr);
      }

      return {
        success: true,
        totalCount: rows.length,
        matchedCount: matched,
        notFoundCount: rows.length - matched,
        reportBase64: buffer.toString('base64'),
      };
    } catch (e: any) {
      // Faylga oid (parse) xatolar foydalanuvchi tomonidagi muammo — 400.
      // Qolganlari kutilmagan ichki xato — 500.
      const status =
        e instanceof PriceListParseError
          ? HttpStatus.BAD_REQUEST
          : HttpStatus.INTERNAL_SERVER_ERROR;
      throw new HttpException(
        e.message || 'Tahlilda kutilmagan xatolik yuz berdi.',
        status,
      );
    }
  }

  private async downloadAndParse(file: { fileName: string; url: string }): Promise<PriceList> {
    const buffer = await this.downloadWithRetry(file);
    // parse() o'zining PriceListParseError'ini aniq xabar bilan otadi — uni o'tkazib yuboramiz.
    return this.pricelist.parse(buffer, file.fileName);
  }

  /**
   * Faylni yuklab oladi. SSL/TLS yoki ulanish kabi VAQTINCHALIK tarmoq xatolarida
   * bir necha marta qayta uradi — bitta uzilish butun tahlilni buzmasin.
   */
  private async downloadWithRetry(
    file: { fileName: string; url: string },
    attempts = 4,
  ): Promise<Buffer> {
    let lastErr: any;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(file.url);
        if (!res.ok) {
          // 5xx — vaqtinchalik bo'lishi mumkin, qayta uramiz; 4xx — yo'q.
          if (res.status >= 500 && i < attempts - 1) {
            await this.sleep(500 * (i + 1));
            continue;
          }
          throw new Error(`Telegram ${res.status} qaytardi`);
        }
        return Buffer.from(await res.arrayBuffer());
      } catch (err: any) {
        lastErr = err;
        // Oxirgi urinish bo'lmasa — biroz kutib qayta uramiz.
        if (i < attempts - 1) {
          await this.sleep(500 * (i + 1));
          continue;
        }
      }
    }
    throw new PriceListParseError(
      `«${file.fileName}» faylini yuklab bo‘lmadi (tarmoq xatosi): ${lastErr?.message ?? lastErr}. ` +
        `Iltimos, bir oz kutib qayta urinib ko‘ring.`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

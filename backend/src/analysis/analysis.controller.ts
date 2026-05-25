import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { PricelistService } from '../pricelist/pricelist.service';
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
      throw new HttpException(
        e.message || 'Tahlilda kutilmagan xatolik yuz berdi.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async downloadAndParse(file: { fileName: string; url: string }): Promise<PriceList> {
    try {
      const res = await fetch(file.url);
      if (!res.ok) {
        throw new Error(`CBU/Telegram returned ${res.status}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      return this.pricelist.parse(buffer, file.fileName);
    } catch (err: any) {
      throw new Error(`«${file.fileName}» faylini yuklab bo‘lmadi yoki o‘qishda xato: ${err.message}`);
    }
  }
}

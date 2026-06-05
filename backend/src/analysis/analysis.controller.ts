import { Controller, Post, Get, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PricelistService, PriceListParseError } from '../pricelist/pricelist.service';
import { MatchingService } from '../matching/matching.service';
import { ReportService } from '../report/report.service';
import { UsersService } from '../users/users.service';
import { PriceList } from '../pricelist/pricelist.types';

/** Foydalanuvchidan keladigan tahlil so'rovi tanasi. */
interface AnalyzeBody {
  telegramId: number;
  own: { fileName: string; url: string };
  competitors: Array<{ fileName: string; url: string }>;
}

/**
 * Bitta tahlil topshirig'i (job). Tahlil 5-7 daqiqa davom etishi mumkin —
 * Railway'ning tashqi proxy'si esa uzoq HTTP so'rovni ~5 daqiqada uzib tashlaydi
 * (502). Shuning uchun ASYNC ishlaymiz: so'rov darrov jobId qaytaradi, tahlil
 * ORQADA ishlaydi, client esa qisqa GET so'rovlar bilan holatni so'rab turadi.
 */
interface AnalysisJob {
  status: 'processing' | 'done' | 'error';
  createdAt: number;
  totalCount?: number;
  matchedCount?: number;
  notFoundCount?: number;
  reportBase64?: string;
  message?: string;
}

const JOB_TTL_MS = 30 * 60 * 1000; // Tugagan jobni 30 daqiqadan keyin xotiradan o'chiramiz

@Controller('analyze')
export class AnalysisController {
  // Joblar xotirada saqlanadi (bitta replica uchun yetarli). Replica > 1 bo'lsa
  // POST va GET turli replicaга tushib, job topilmasligi mumkin — u holда DB/Redis kerak.
  private readonly jobs = new Map<string, AnalysisJob>();

  constructor(
    private readonly pricelist: PricelistService,
    private readonly matching: MatchingService,
    private readonly report: ReportService,
    private readonly users: UsersService,
  ) {}

  /**
   * Tahlilni BOSHLAYDI va darrov jobId qaytaradi (so'rov qisqa — proxy uzmaydi).
   * Asl ish `runJob` ichida orqada, kutmasdan ishlaydi.
   */
  @Post()
  async start(@Body() body: AnalyzeBody): Promise<{ success: true; jobId: string }> {
    if (!body.own || !body.competitors || body.competitors.length === 0) {
      throw new HttpException('Fayllar to‘liq yuborilmadi.', HttpStatus.BAD_REQUEST);
    }
    this.cleanupOldJobs();

    const jobId = randomUUID();
    this.jobs.set(jobId, { status: 'processing', createdAt: Date.now() });
    // Fire-and-forget: javobni kutmaymiz. Xatolar runJob ichida ushlanadi.
    void this.runJob(jobId, body);

    return { success: true, jobId };
  }

  /**
   * Job holatini qaytaradi. Client buni har bir necha soniyada so'rab turadi.
   * `processing` — hali ishlayapti; `done` — hisobot tayyor (reportBase64);
   * `error` — xato (message bilan).
   */
  @Get(':jobId')
  status(@Param('jobId') jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new HttpException(
        'Tahlil topilmadi (eskirgan yoki server qayta ishga tushgan bo‘lishi mumkin).',
        HttpStatus.NOT_FOUND,
      );
    }
    if (job.status === 'processing') {
      return { success: true, status: 'processing' as const };
    }
    if (job.status === 'error') {
      return { success: false, status: 'error' as const, message: job.message };
    }
    return {
      success: true,
      status: 'done' as const,
      totalCount: job.totalCount,
      matchedCount: job.matchedCount,
      notFoundCount: job.notFoundCount,
      reportBase64: job.reportBase64,
    };
  }

  /** Asl tahlil — orqada ishlaydi, natijani job'ga yozadi. */
  private async runJob(jobId: string, body: AnalyzeBody): Promise<void> {
    try {
      // 1. O'z faylni yuklab, o'qiymiz.
      const ownList = await this.downloadAndParse(body.own);

      // 2. Raqobatchilar fayllarini yuklab, o'qiymiz.
      const competitorLists: PriceList[] = [];
      for (const comp of body.competitors) {
        competitorLists.push(await this.downloadAndParse(comp));
      }

      // 3. Taqqoslash.
      const rows = await this.matching.compare(ownList, competitorLists);
      const matched = rows.filter((r) => r.verdict !== 'NOT_FOUND').length;

      // 4. Hisobot Excel.
      const buffer = await this.report.build(rows, ownList.fileName);

      // 5. Tahlilni jurnalga yozamiz (xato bo'lsa ham tahLil buzilmasin).
      try {
        await this.users.logAnalysis({
          telegramId: body.telegramId,
          ownFileName: ownList.fileName,
          competitorCount: competitorLists.length,
          ownProductCount: rows.length,
          matchedCount: matched,
        });
      } catch (logErr) {
        console.error('Failed to log analysis:', logErr);
      }

      this.jobs.set(jobId, {
        status: 'done',
        createdAt: Date.now(),
        totalCount: rows.length,
        matchedCount: matched,
        notFoundCount: rows.length - matched,
        reportBase64: buffer.toString('base64'),
      });
    } catch (e: any) {
      // Foydalanuvchiga tushunarli xabar — parse xatolari aniq matnli keladi.
      const message =
        e instanceof PriceListParseError
          ? e.message
          : e?.message || 'Tahlilda kutilmagan xatolik yuz berdi.';
      this.jobs.set(jobId, { status: 'error', createdAt: Date.now(), message });
    }
  }

  /** Eskirgan (TTL o'tgan) joblarni xotiradan tozalaydi — xotira shishmasin. */
  private cleanupOldJobs(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (now - job.createdAt > JOB_TTL_MS) this.jobs.delete(id);
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
    attempts = 5,
  ): Promise<Buffer> {
    let lastErr: any;
    for (let i = 0; i < attempts; i++) {
      // Har urinishda YANGI ulanish: «bad record mac» SSL xatosi ko'pincha
      // buzilgan keep-alive ulanishni qayta ishlatishdan keladi. Connection:close
      // bilan har safar toza TLS ulanish ochiladi va abort bilan osilib qolmaydi.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const res = await fetch(file.url, {
          headers: { connection: 'close' },
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!res.ok) {
          // 5xx — vaqtinchalik bo'lishi mumkin, qayta uramiz; 4xx — yo'q.
          if (res.status >= 500 && i < attempts - 1) {
            await this.sleep(600 * (i + 1));
            continue;
          }
          throw new Error(`Telegram ${res.status} qaytardi`);
        }
        return Buffer.from(await res.arrayBuffer());
      } catch (err: any) {
        lastErr = err;
        // Oxirgi urinish bo'lmasa — biroz kutib qayta uramiz (SSL/ulanish xatolari
        // vaqtinchalik; yangi ulanish bilan keyingi urinish odatda o'tadi).
        if (i < attempts - 1) {
          await this.sleep(600 * (i + 1));
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw new PriceListParseError(
      `«${file.fileName}» faylini yuklab bo‘lmadi (tarmoq/SSL xatosi bir necha marta takrorlandi). ` +
        `Iltimos, bir oz kutib qayta urinib ko‘ring.`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

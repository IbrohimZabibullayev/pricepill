import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { distance } from 'fastest-levenshtein';
import { Currency, ComparisonRow, MatchHit, PriceList, Product } from '../pricelist/pricelist.types';
import { transliterate } from './translit';
import { AnthropicService, AiMatchRequest } from '../ai/anthropic.service';
import { CurrencyService, RateMap } from '../currency/currency.service';

/**
 * Oldindan normallashtirilgan mahsulot. Nom/ishlab chiqaruvchini va token
 * to'plamini BIR MARTA hisoblab qo'yamiz — taqqoslash sikli ichida millionlab
 * marta qayta normallashtirish (eski sekinlikning asosiy sababi) yo'qoladi.
 */
interface Normed {
  product: Product;
  nName: string;
  nManuf: string;
  tokens: Set<string>;
}

interface CompFile {
  fileName: string;
  currency: Currency;
  items: Normed[];
}

/** Raqobatchi mahsulot + uning lokal skori */
interface Candidate {
  competitorFile: string;
  competitorCurrency: Currency;
  product: Product;
  localScore: number;
}

/** O'z mahsuloti + uning nomzodlari */
interface OwnWithCandidates {
  ownIndex: number;
  own: Product;
  candidates: Candidate[];
}

/** Taqqoslash konteksti — mening valyutam va kurslar */
interface CompareCtx {
  ownCurrency: Currency;
  rates: RateMap;
}

const CANDIDATE_TOP = 3;          // Har raqobatchi fayldan olinadigan eng yaxshi n ta (kamroq = arzonroq)
const CANDIDATE_THRESHOLD = 0.30; // Nomzodlikka kiradigan minimal lokal skor
const LOCAL_THRESHOLD = 0.60;     // AI yo'q bo'lsa — eski chegara
const BATCH_SIZE = 25;            // Bir AI so'rovidagi mahsulotlar soni
const AI_CONCURRENCY = 4;         // Parallel AI so'rovlari (token byudjet asosiy cheklov)

// ── Kredit/token tejash chegaralari ──
// AI faqat CHINAKAM SHUBHALI hollarda ishlatiladi. Aniq mosliklar va aniq
// mos kelmaydiganlar lokal hal qilinadi — Anthropic krediti tejaladi.

// Lokal skor shu darajadan yuqori VA 2-chidan sezilarli ustun bo'lsa — AIsiz qabul.
const AUTO_ACCEPT_SCORE = 0.85;
const AUTO_ACCEPT_MARGIN = 0.08;
// Eng yaxshi nomzod ham shu darajadan past bo'lsa — bu aniq «topilmadi»,
// AIga yuborishdan ma'no yo'q.
const AUTO_REJECT_SCORE = 0.45;

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);
  private readonly threshold: number;

  constructor(
    config: ConfigService,
    private readonly ai: AnthropicService,
    private readonly currency: CurrencyService,
  ) {
    this.threshold = Number(config.get('MATCH_THRESHOLD') ?? LOCAL_THRESHOLD);
  }

  // O'z price-listni bir nechta raqobatchi listga taqqoslaydi.
  async compare(own: PriceList, competitors: PriceList[]): Promise<ComparisonRow[]> {
    const t0 = Date.now();
    const rates = await this.currency.getRates();

    // Hamma mahsulotni bir marta normallashtiramiz.
    const ownN = own.products.map((p) => this.normed(p));
    const comps: CompFile[] = competitors.map((c) => ({
      fileName: c.fileName,
      currency: c.currency,
      items: c.products.map((p) => this.normed(p)),
    }));

    const ctx = { ownCurrency: own.currency, rates };
    const rows = this.ai.isEnabled
      ? await this.compareWithAi(ownN, comps, ctx)
      : ownN.map((o) => this.compareOneLocal(o, comps, ctx));

    this.logger.log(
      `Taqqoslash tugadi: ${ownN.length} mahsulot, ${(Date.now() - t0) / 1000}s ` +
        `(${this.ai.isEnabled ? 'AI hybrid' : 'lokal'}, valyuta: ${own.currency}).`,
    );
    return rows;
  }

  // ─────────────────────── AI HYBRID PATH ───────────────────────

  private async compareWithAi(ownN: Normed[], comps: CompFile[], ctx: CompareCtx): Promise<ComparisonRow[]> {
    // 1. Har bir o'z mahsuloti uchun nomzodlarni lokal filtr bilan topamiz.
    const ownsWithCandidates: OwnWithCandidates[] = ownN.map((o, ownIndex) => ({
      ownIndex,
      own: o.product,
      candidates: this.gatherCandidates(o, comps),
    }));

    // 2. Kreditni tejash uchun AIsiz hal bo'ladiganlarni ajratamiz:
    //    • auto-qabul — yagona kuchli nomzod (yuqori skor + 2-chidan ustun)
    //    • auto-rad   — eng yaxshi nomzod ham juda zaif (aniq topilmadi)
    //    Faqat oraliq (shubhali) holatlar AIga boradi.
    const autoAccepted = new Map<number, Candidate>();
    let autoRejected = 0;
    const needsAi: OwnWithCandidates[] = [];
    for (const o of ownsWithCandidates) {
      if (o.candidates.length === 0) continue;
      const sorted = [...o.candidates].sort((a, b) => b.localScore - a.localScore);
      const top = sorted[0];
      const second = sorted[1]?.localScore ?? 0;
      if (top.localScore >= AUTO_ACCEPT_SCORE && top.localScore - second >= AUTO_ACCEPT_MARGIN) {
        autoAccepted.set(o.ownIndex, top);
      } else if (top.localScore < AUTO_REJECT_SCORE) {
        autoRejected++; // nomzodlar bor, lekin hammasi juda zaif — topilmadi
      } else {
        needsAi.push(o);
      }
    }

    const batches: OwnWithCandidates[][] = [];
    for (let i = 0; i < needsAi.length; i += BATCH_SIZE) {
      batches.push(needsAi.slice(i, i + BATCH_SIZE));
    }
    this.logger.log(
      `Lokal hal: ${autoAccepted.size} qabul + ${autoRejected} rad. ` +
        `AIga (shubhali): ${needsAi.length} ta.`,
    );

    // 3. Batchlarni PARALLEL yuboramiz (eski kod ketma-ket yuborardi — asosiy
    //    sekinlik shu edi). Concurrency cheklab, rate-limitга urilmaymiz.
    const batchResults = await this.runPool(batches, AI_CONCURRENCY, (batch) => {
      const aiRequests: AiMatchRequest[] = batch.map((o) => ({
        ownIndex: o.ownIndex,
        ownProduct: {
          name: o.own.name,
          manufacturer: o.own.manufacturer || null,
          country: o.own.country || null,
        },
        candidates: o.candidates.map((c, ci) => ({
          candidateIndex: ci,
          name: c.product.name,
          manufacturer: c.product.manufacturer || null,
          country: c.product.country || null,
        })),
      }));
      return this.ai.matchBatch(aiRequests);
    });

    const aiResultMap = new Map<number, { candidateIdx: number; confidence: number }>();
    for (const results of batchResults) {
      for (const r of results) {
        aiResultMap.set(r.ownIndex, { candidateIdx: r.candidateIndex, confidence: r.confidence });
      }
    }

    // 4. Natijalarni yig'amiz.
    return ownsWithCandidates.map(({ ownIndex, own, candidates }) => {
      let bestHit: MatchHit | null = null;

      const auto = autoAccepted.get(ownIndex);
      const aiResult = aiResultMap.get(ownIndex);

      if (auto) {
        // Lokal yo'l bilan ishonchli tanlangan.
        bestHit = this.toHit(auto);
      } else if (aiResult && aiResult.candidateIdx >= 0 && aiResult.candidateIdx < candidates.length) {
        const chosen = candidates[aiResult.candidateIdx];
        bestHit = this.toHit(chosen, aiResult.confidence);
      } else if (!aiResult && candidates.length > 0) {
        // AI javob bermagan bo'lsa — lokal eng yaxshi nomzoddan foydalanamiz.
        const best = candidates.reduce((a, b) => (a.localScore >= b.localScore ? a : b));
        if (best.localScore >= this.threshold) bestHit = this.toHit(best);
      }

      return this.buildRow(own, bestHit ? [bestHit] : [], ctx);
    });
  }

  private toHit(c: Candidate, score?: number): MatchHit {
    return {
      competitorFile: c.competitorFile,
      competitorCurrency: c.competitorCurrency,
      product: c.product,
      score: score ?? c.localScore,
    };
  }

  /** Har bir raqobatchi fayldan o'z mahsulotiga eng yaqin top-N nomzodlar. */
  private gatherCandidates(own: Normed, comps: CompFile[]): Candidate[] {
    const all: Candidate[] = [];
    for (const comp of comps) {
      const perComp: Candidate[] = [];
      for (const cand of comp.items) {
        const localScore = this.scoreN(own, cand);
        if (localScore >= CANDIDATE_THRESHOLD) {
          perComp.push({
            competitorFile: comp.fileName,
            competitorCurrency: comp.currency,
            product: cand.product,
            localScore,
          });
        }
      }
      perComp.sort((a, b) => b.localScore - a.localScore);
      for (const c of perComp.slice(0, CANDIDATE_TOP)) all.push(c);
    }
    return all;
  }

  // ─────────────────────── LOCAL FALLBACK PATH ───────────────────────

  private compareOneLocal(own: Normed, comps: CompFile[], ctx: CompareCtx): ComparisonRow {
    const hits: MatchHit[] = [];
    for (const comp of comps) {
      let best: MatchHit | null = null;
      for (const cand of comp.items) {
        const score = this.scoreN(own, cand);
        if (score >= this.threshold && (!best || score > best.score)) {
          best = {
            competitorFile: comp.fileName,
            competitorCurrency: comp.currency,
            product: cand.product,
            score,
          };
        }
      }
      if (best) hits.push(best);
    }
    return this.buildRow(own.product, hits, ctx);
  }

  // ─────────────────────── SHARED HELPERS ───────────────────────

  private buildRow(own: Product, hits: MatchHit[], ctx: CompareCtx): ComparisonRow {
    const base = {
      own,
      ownCurrency: ctx.ownCurrency,
      compCurrency: null,
      compSellInOwnCcy: null,
      diff: null,
      diffPercent: null,
    };

    if (hits.length === 0 || own.sellPrice == null) {
      return { ...base, bestHit: hits[0] ?? null, verdict: 'NOT_FOUND' };
    }

    // Narxli nomzodlar orasidan — mening valyutamga aylantirilgan eng arzonini tanlaymiz.
    const priced = hits.filter((h) => h.product.sellPrice != null);
    if (priced.length === 0) {
      return { ...base, bestHit: hits[0], verdict: 'NOT_FOUND' };
    }
    const inOwn = (h: MatchHit) =>
      this.currency.convert(h.product.sellPrice as number, h.competitorCurrency, ctx.ownCurrency, ctx.rates);
    const bestHit = priced.reduce((a, b) => (inOwn(a) <= inOwn(b) ? a : b));

    const compSellInOwnCcy = inOwn(bestHit);
    const diff = own.sellPrice - compSellInOwnCcy;
    const diffPercent = compSellInOwnCcy !== 0 ? (diff / compSellInOwnCcy) * 100 : null;

    let verdict: ComparisonRow['verdict'] = 'EQUAL';
    if (diff > 0.0001) verdict = 'EXPENSIVE';
    else if (diff < -0.0001) verdict = 'CHEAP';

    return {
      ...base,
      bestHit,
      compCurrency: bestHit.competitorCurrency,
      compSellInOwnCcy,
      diff,
      diffPercent,
      verdict,
    };
  }

  /** Mahsulotni bir marta normallashtirib, token to'plamini tayyorlaydi. */
  private normed(p: Product): Normed {
    const nName = this.norm(p.name);
    const nManuf = p.manufacturer ? this.norm(p.manufacturer) : '';
    return {
      product: p,
      nName,
      nManuf,
      tokens: new Set(nName.split(' ').filter(Boolean)),
    };
  }

  /** Oldindan normallashtirilgan ikki mahsulot skori. */
  private scoreN(a: Normed, b: Normed): number {
    const nameScore = this.simTokens(a.nName, a.tokens, b.nName, b.tokens);
    const manufScore =
      a.nManuf && b.nManuf ? this.simStr(a.nManuf, b.nManuf) : 0.5; // yo'q bo'lsa neytral
    return nameScore * 0.8 + manufScore * 0.2;
  }

  /** Levenshtein nisbati va token (so'z) Dice o'xshashligidan kattasi. */
  private simTokens(a: string, ta: Set<string>, b: string, tb: Set<string>): number {
    if (!a || !b) return 0;
    if (a === b) return 1;

    const maxLen = Math.max(a.length, b.length);
    const lev = maxLen === 0 ? 0 : 1 - distance(a, b) / maxLen;

    let inter = 0;
    ta.forEach((t) => tb.has(t) && inter++);
    const dice = ta.size + tb.size === 0 ? 0 : (2 * inter) / (ta.size + tb.size);

    return Math.max(lev, dice);
  }

  /** Faqat Levenshtein nisbati (ishlab chiqaruvchi nomlari uchun yetarli). */
  private simStr(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const maxLen = Math.max(a.length, b.length);
    return maxLen === 0 ? 0 : 1 - distance(a, b) / maxLen;
  }

  private norm(s: string): string {
    return transliterate(s || '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * `items`ni eng ko'pi bilan `limit` ta parallel ishlatadigan oddiy pool.
   * Promise.all bilan hammasini birdan otmaymiz — AI rate-limitга urilmaslik uchun.
   */
  private async runPool<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let idx = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = idx++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]);
      }
    });
    await Promise.all(workers);
    return results;
  }
}

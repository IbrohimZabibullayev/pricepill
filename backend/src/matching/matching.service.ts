import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { distance } from 'fastest-levenshtein';
import { ComparisonRow, MatchHit, PriceList, Product } from '../pricelist/pricelist.types';
import { transliterate } from './translit';
import { CurrencyService } from '../currency/currency.service';
import { AnthropicService, AiMatchRequest } from '../ai/anthropic.service';

/** Raqobatchi mahsulot + uning lokal skori */
interface Candidate {
  competitorFile: string;
  product: Product;
  localScore: number;
  /** candidates massividagi pozitsiyasi (AI'ga yuborish uchun) */
  indexInBatch: number;
}

/** O'z mahsuloti + uning nomzodlari */
interface OwnWithCandidates {
  ownIndex: number;
  own: Product;
  /** Har bir raqobatchi fayldan top-5 ta nominatsiya */
  candidates: (Candidate & { globalIndex: number })[];
}

const CANDIDATE_TOP = 5;      // Har raqobatchi fayldan olinadigan eng yaxshi n ta
const CANDIDATE_THRESHOLD = 0.30; // Nomzodlikka kiradigan minimal lokal skor
const LOCAL_THRESHOLD = 0.60; // AI yo'q bo'lsa — eski chegara
const BATCH_SIZE = 25;        // Bir vaqtda AI ga yuboriladigan mahsulotlar soni

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);
  private readonly threshold: number;

  constructor(
    config: ConfigService,
    private readonly currencyService: CurrencyService,
    private readonly ai: AnthropicService,
  ) {
    this.threshold = Number(config.get('MATCH_THRESHOLD') ?? LOCAL_THRESHOLD);
  }

  // O'z price-listni bir nechta raqobatchi listga taqqoslaydi.
  async compare(own: PriceList, competitors: PriceList[]): Promise<ComparisonRow[]> {
    const usdRate = await this.currencyService.getUsdRate();

    if (this.ai.isEnabled) {
      return this.compareWithAi(own, competitors, usdRate);
    }
    return own.products.map((p) => this.compareOneLocal(p, competitors, usdRate));
  }

  // ─────────────────────── AI HYBRID PATH ───────────────────────

  private async compareWithAi(
    own: PriceList,
    competitors: PriceList[],
    usdRate: number,
  ): Promise<ComparisonRow[]> {
    // 1. Har bir o'z mahsuloti uchun nomzodlarni lokal filtr bilan topamiz
    const ownsWithCandidates: OwnWithCandidates[] = own.products.map((p, ownIndex) => ({
      ownIndex,
      own: p,
      candidates: this.gatherCandidates(p, competitors),
    }));

    // 2. Nomzodlari bo'lgan mahsulotlarnigina AIga yuboramiz
    const needsAi = ownsWithCandidates.filter((o) => o.candidates.length > 0);

    // 3. Batch bo'lib yuboramiz
    // candidateIndex — AI response'dagi son,
    // biz ownIndex:number, candidateIndex:number (o'sha OwnWithCandidates.candidates massividagi indeks) ishlatamiz
    const aiResultMap = new Map<number, { candidateIdx: number; confidence: number }>();

    for (let i = 0; i < needsAi.length; i += BATCH_SIZE) {
      const batch = needsAi.slice(i, i + BATCH_SIZE);
      const aiRequests: AiMatchRequest[] = batch.map((o) => ({
        ownIndex: o.ownIndex,
        ownProduct: {
          name: o.own.name,
          manufacturer: o.own.manufacturer,
          form: null,
        },
        candidates: o.candidates.map((c, ci) => ({
          candidateIndex: ci,
          name: c.product.name,
          manufacturer: c.product.manufacturer,
          form: null,
        })),
      }));

      const results = await this.ai.matchBatch(aiRequests);
      for (const r of results) {
        aiResultMap.set(r.ownIndex, { candidateIdx: r.candidateIndex, confidence: r.confidence });
      }
    }

    // 4. Natijalarni yig'amiz
    return ownsWithCandidates.map(({ ownIndex, own, candidates }) => {
      const aiResult = aiResultMap.get(ownIndex);
      let bestHit: MatchHit | null = null;

      if (aiResult && aiResult.candidateIdx >= 0 && aiResult.candidateIdx < candidates.length) {
        const chosen = candidates[aiResult.candidateIdx];
        bestHit = {
          competitorFile: chosen.competitorFile,
          product: chosen.product,
          score: aiResult.confidence,
        };
      } else if (!aiResult && candidates.length > 0) {
        // AI javob bermagan bo'lsa — lokal eng yaxshi nomzoddan foydalanamiz
        const best = candidates.reduce((a, b) => (a.localScore >= b.localScore ? a : b));
        if (best.localScore >= this.threshold) {
          bestHit = { competitorFile: best.competitorFile, product: best.product, score: best.localScore };
        }
      }

      return this.buildRow(own, bestHit ? [bestHit] : [], usdRate);
    });
  }

  /**
   * Har bir raqobatchi fayldan o'z mahsulotiga eng yaqin top-N nomzodlarni topadi.
   * Chegara CANDIDATE_THRESHOLD — lokal matchingdan past.
   */
  private gatherCandidates(
    own: Product,
    competitors: PriceList[],
  ): (Candidate & { globalIndex: number })[] {
    const all: (Candidate & { globalIndex: number })[] = [];
    let globalIndex = 0;
    for (const comp of competitors) {
      const perComp: Candidate[] = [];
      for (const cand of comp.products) {
        const localScore = this.scoreLocal(own, cand);
        if (localScore >= CANDIDATE_THRESHOLD) {
          perComp.push({ competitorFile: comp.fileName, product: cand, localScore, indexInBatch: 0 });
        }
      }
      perComp
        .sort((a, b) => b.localScore - a.localScore)
        .slice(0, CANDIDATE_TOP)
        .forEach((c) => {
          all.push({ ...c, globalIndex: globalIndex++ });
        });
    }
    return all;
  }

  // ─────────────────────── LOCAL FALLBACK PATH ───────────────────────

  private compareOneLocal(own: Product, competitors: PriceList[], usdRate: number): ComparisonRow {
    const hits: MatchHit[] = [];
    for (const comp of competitors) {
      const hit = this.bestMatchLocal(own, comp);
      if (hit) hits.push(hit);
    }
    return this.buildRow(own, hits, usdRate);
  }

  private bestMatchLocal(own: Product, comp: PriceList): MatchHit | null {
    let best: MatchHit | null = null;
    for (const cand of comp.products) {
      const score = this.scoreLocal(own, cand);
      if (score >= this.threshold && (!best || score > best.score)) {
        best = { competitorFile: comp.fileName, product: cand, score };
      }
    }
    return best;
  }

  // ─────────────────────── SHARED HELPERS ───────────────────────

  private buildRow(own: Product, hits: MatchHit[], usdRate: number): ComparisonRow {
    if (hits.length === 0 || own.sellPrice == null) {
      return {
        own,
        bestHit: hits[0] ?? null,
        diffSom: null,
        diffPercent: null,
        diffUsd: null,
        verdict: 'NOT_FOUND',
      };
    }

    // Eng arzon raqobatchi narxini tanlaymiz — "men eng arzondan ham qimmatmi?"
    const priced = hits.filter((h) => h.product.sellPrice != null);
    if (priced.length === 0) {
      return { own, bestHit: hits[0], diffSom: null, diffPercent: null, diffUsd: null, verdict: 'NOT_FOUND' };
    }
    const bestHit = priced.reduce((a, b) =>
      (a.product.sellPrice as number) <= (b.product.sellPrice as number) ? a : b,
    );

    const compPrice = bestHit.product.sellPrice as number;
    const diffSom = own.sellPrice - compPrice;
    const diffPercent = compPrice !== 0 ? (diffSom / compPrice) * 100 : null;
    const diffUsd = usdRate > 0 ? diffSom / usdRate : null;

    let verdict: ComparisonRow['verdict'] = 'EQUAL';
    if (diffSom > 0) verdict = 'EXPENSIVE';
    else if (diffSom < 0) verdict = 'CHEAP';

    return { own, bestHit, diffSom, diffPercent, diffUsd, verdict };
  }

  // Levenshtein nisbati va token (so'z) to'plami o'xshashligidan kattasi.
  private scoreLocal(a: Product, b: Product): number {
    const nameScore = this.sim(this.norm(a.name), this.norm(b.name));
    const manufScore =
      a.manufacturer && b.manufacturer
        ? this.sim(this.norm(a.manufacturer), this.norm(b.manufacturer))
        : 0.5; // ishlab chiqaruvchi yo'q bo'lsa — neytral
    return nameScore * 0.8 + manufScore * 0.2;
  }

  private sim(a: string, b: string): number {
    if (!a || !b) return 0;
    if (a === b) return 1;

    const maxLen = Math.max(a.length, b.length);
    const lev = maxLen === 0 ? 0 : 1 - distance(a, b) / maxLen;

    const ta = new Set(a.split(' ').filter(Boolean));
    const tb = new Set(b.split(' ').filter(Boolean));
    let inter = 0;
    ta.forEach((t) => tb.has(t) && inter++);
    const dice = ta.size + tb.size === 0 ? 0 : (2 * inter) / (ta.size + tb.size);

    return Math.max(lev, dice);
  }

  private norm(s: string): string {
    return transliterate(s || '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

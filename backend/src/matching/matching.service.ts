import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { distance } from 'fastest-levenshtein';
import { ComparisonRow, MatchHit, PriceList, Product } from '../pricelist/pricelist.types';
import { transliterate } from './translit';
import { CurrencyService } from '../currency/currency.service';

@Injectable()
export class MatchingService {
  private readonly threshold: number;

  constructor(
    config: ConfigService,
    private readonly currencyService: CurrencyService,
  ) {
    this.threshold = Number(config.get('MATCH_THRESHOLD') ?? 0.6);
  }

  // O'z price-listni bir nechta raqobatchi listga taqqoslaydi.
  async compare(own: PriceList, competitors: PriceList[]): Promise<ComparisonRow[]> {
    const usdRate = await this.currencyService.getUsdRate();
    return own.products.map((p) => this.compareOne(p, competitors, usdRate));
  }

  private compareOne(own: Product, competitors: PriceList[], usdRate: number): ComparisonRow {
    const hits: MatchHit[] = [];
    for (const comp of competitors) {
      const hit = this.bestMatch(own, comp);
      if (hit) hits.push(hit);
    }

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

  private bestMatch(own: Product, comp: PriceList): MatchHit | null {
    let best: MatchHit | null = null;
    for (const cand of comp.products) {
      const score = this.score(own, cand);
      if (score >= this.threshold && (!best || score > best.score)) {
        best = { competitorFile: comp.fileName, product: cand, score };
      }
    }
    return best;
  }

  // Nom (80%) + ishlab chiqaruvchi (20%) bo'yicha o'xshashlik.
  private score(a: Product, b: Product): number {
    const nameScore = this.sim(this.norm(a.name), this.norm(b.name));
    const manufScore =
      a.manufacturer && b.manufacturer
        ? this.sim(this.norm(a.manufacturer), this.norm(b.manufacturer))
        : 0.5; // ishlab chiqaruvchi yo'q bo'lsa — neytral
    return nameScore * 0.8 + manufScore * 0.2;
  }

  // Levenshtein nisbati va token (so'z) to'plami o'xshashligidan kattasi.
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

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Currency } from '../pricelist/pricelist.types';

/** 1 birlik valyuta necha UZS turishi (UZS=1). */
export type RateMap = Record<Currency, number>;

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);
  private cached: RateMap | null = null;
  private lastFetched = 0;
  private readonly cacheDurationMs = 12 * 60 * 60 * 1000; // 12 soat

  // CBU ishlamasa — zaxira kurslar (taxminiy, env bilan o'zgartirsa bo'ladi).
  private readonly fallback: RateMap;

  constructor(private readonly config: ConfigService) {
    this.fallback = {
      UZS: 1,
      USD: Number(config.get('USD_RATE')) || 12600,
      EUR: Number(config.get('EUR_RATE')) || 13700,
      RUB: Number(config.get('RUB_RATE')) || 140,
    };
  }

  /** Har valyuta uchun «1 birlik = N UZS» xaritasini qaytaradi. */
  async getRates(): Promise<RateMap> {
    const now = Date.now();
    if (this.cached && now - this.lastFetched < this.cacheDurationMs) {
      return this.cached;
    }

    try {
      const res = await fetch('https://cbu.uz/uz/arkhiv-kursov-valyut/json/');
      if (!res.ok) throw new Error(`CBU API status ${res.status}`);
      const data = (await res.json()) as any[];

      const pick = (code: string): number | null => {
        const row = data.find((d) => d?.Ccy === code);
        const rate = row ? parseFloat(row.Rate) : NaN;
        return Number.isFinite(rate) && rate > 0 ? rate : null;
      };

      const rates: RateMap = {
        UZS: 1,
        USD: pick('USD') ?? this.fallback.USD,
        EUR: pick('EUR') ?? this.fallback.EUR,
        RUB: pick('RUB') ?? this.fallback.RUB,
      };

      this.cached = rates;
      this.lastFetched = now;
      this.logger.log(
        `CBU kurslari yangilandi: USD=${rates.USD}, EUR=${rates.EUR}, RUB=${rates.RUB} UZS.`,
      );
      return rates;
    } catch (err: any) {
      this.logger.warn(`CBU kursini olishda xato: ${err.message}. Zaxira kurslar ishlatiladi.`);
      return this.cached ?? this.fallback;
    }
  }

  /** Eski API (compat) — faqat USD kursi. */
  async getUsdRate(): Promise<number> {
    return (await this.getRates()).USD;
  }

  /** `amount` (from valyutada) ni `to` valyutaga aylantiradi. */
  convert(amount: number, from: Currency, to: Currency, rates: RateMap): number {
    if (from === to) return amount;
    const inUzs = amount * rates[from]; // avval UZSga
    return inUzs / rates[to]; // keyin kerakli valyutaga
  }
}

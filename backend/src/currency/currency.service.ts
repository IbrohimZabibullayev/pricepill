import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Currency } from '../pricelist/pricelist.types';

/** 1 birlik valyuta necha UZS turishi (UZS=1). Kalit — valyuta kodi. */
export type RateMap = Record<string, number>;

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);
  private cached: RateMap | null = null;
  private lastFetched = 0;
  private readonly cacheDurationMs = 12 * 60 * 60 * 1000; // 12 soat

  // CBU ishlamasa — zaxira kurslar (taxminiy). UZS doim 1.
  private readonly fallback: RateMap;

  constructor(private readonly config: ConfigService) {
    this.fallback = {
      UZS: 1,
      USD: Number(config.get('USD_RATE')) || 12600,
      EUR: Number(config.get('EUR_RATE')) || 13700,
      RUB: Number(config.get('RUB_RATE')) || 140,
      HRK: 1850, // taxminiy
    };
  }

  /**
   * Har valyuta uchun «1 birlik = N UZS» xaritasini qaytaradi.
   * CBU'dagi BARCHA valyutalarni yuklaydi (HRK, GBP, CHF, CNY...) — dinamik.
   */
  async getRates(): Promise<RateMap> {
    const now = Date.now();
    if (this.cached && now - this.lastFetched < this.cacheDurationMs) {
      return this.cached;
    }

    try {
      const res = await fetch('https://cbu.uz/uz/arkhiv-kursov-valyut/json/');
      if (!res.ok) throw new Error(`CBU API status ${res.status}`);
      const data = (await res.json()) as any[];

      const rates: RateMap = { UZS: 1 };
      for (const row of data) {
        const code = String(row?.Ccy ?? '').toUpperCase();
        const rate = parseFloat(row?.Rate);
        const nominal = parseFloat(row?.Nominal) || 1; // ba'zi valyutalar 10/100 birlik uchun
        if (code && Number.isFinite(rate) && rate > 0) {
          rates[code] = rate / nominal;
        }
      }
      // Zaxiradan yetishmaganlarini to'ldiramiz.
      for (const [k, v] of Object.entries(this.fallback)) {
        if (rates[k] == null) rates[k] = v;
      }

      this.cached = rates;
      this.lastFetched = now;
      this.logger.log(
        `CBU kurslari yangilandi: ${Object.keys(rates).length} valyuta ` +
          `(USD=${rates.USD}, EUR=${rates.EUR}, HRK=${rates.HRK ?? '—'}).`,
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

  /**
   * `amount` (from valyutada) ni `to` valyutaga aylantiradi.
   * Kurs noma'lum bo'lsa — null (taqqoslab bo'lmaydi, xato qiymat bermaymiz).
   */
  convert(amount: number, from: Currency, to: Currency, rates: RateMap): number | null {
    if (from === to) return amount;
    const fr = rates[from];
    const tr = rates[to];
    if (fr == null || tr == null) return null; // noma'lum valyuta
    return (amount * fr) / tr;
  }

  /** Valyuta kursi ma'lummi? */
  isKnown(ccy: Currency, rates: RateMap): boolean {
    return rates[ccy] != null;
  }
}

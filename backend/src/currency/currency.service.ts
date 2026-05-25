import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);
  private cachedRate: number | null = null;
  private lastFetched: number = 0;
  private readonly cacheDurationMs = 12 * 60 * 60 * 1000; // 12 hours
  private readonly fallbackRate: number;

  constructor(private readonly config: ConfigService) {
    this.fallbackRate = Number(config.get('USD_RATE') ?? 12600);
  }

  async getUsdRate(): Promise<number> {
    const now = Date.now();
    if (this.cachedRate && now - this.lastFetched < this.cacheDurationMs) {
      return this.cachedRate;
    }

    try {
      this.logger.log('Fetching USD rate from CBU API...');
      const res = await fetch('https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/');
      if (!res.ok) {
        throw new Error(`CBU API returned status ${res.status}`);
      }
      const data = (await res.json()) as any[];
      if (Array.isArray(data) && data.length > 0 && data[0].Rate) {
        const rate = parseFloat(data[0].Rate);
        if (Number.isFinite(rate) && rate > 0) {
          this.cachedRate = rate;
          this.lastFetched = now;
          this.logger.log(`USD rate updated from CBU API: ${rate} UZS`);
          return rate;
        }
      }
      throw new Error('Invalid response structure from CBU API');
    } catch (err: any) {
      this.logger.warn(
        `Failed to fetch USD rate from CBU: ${err.message}. Using fallback: ${this.fallbackRate}`,
      );
      if (this.cachedRate) {
        return this.cachedRate;
      }
      return this.fallbackRate;
    }
  }
}

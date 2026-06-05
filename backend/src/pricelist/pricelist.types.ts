/**
 * Valyuta — ISO/CBU kodi (UZS, USD, EUR, RUB, HRK, GBP, CHF, CNY...).
 * Qat'iy ro'yxat emas: CBU bergan istalgan kod ishlatilishi mumkin.
 */
export type Currency = string;

export interface Product {
  name: string;
  manufacturer: string;
  /** Keladigan davlat — ixtiyoriy, faqat ma'lumot uchun (moslikka ta'sir qilmaydi) */
  country: string;
  purchasePrice: number | null;
  sellPrice: number | null;
  row: number; // Excel'dagi qator raqami (xatolikni ko'rsatish uchun)
}

export interface PriceList {
  fileName: string;
  products: Product[];
  /** Shu fayl narxlarining valyutasi (sarlavha/belgidan aniqlanadi, default UZS) */
  currency: Currency;
}

// Bitta o'z mahsuloti uchun bitta raqobatchidagi eng yaqin moslik
export interface MatchHit {
  competitorFile: string;
  competitorCurrency: Currency;
  product: Product;
  score: number; // 0..1 moslik aniqligi
  /** AI aniqlagan mos faol modda (INN) — nega mos kelgani; lokal moslikda yo'q. */
  substance?: string;
}

export interface ComparisonRow {
  own: Product;
  bestHit: MatchHit | null; // eng arzon raqobatchi narxi bo'yicha tanlangan
  /** Mening valyutam (own price-list valyutasi) — farq shu valyutada */
  ownCurrency: Currency;
  /** Raqobatchi narxining asl valyutasi (bestHit bo'lsa) */
  compCurrency: Currency | null;
  /** Raqobatchi sotish narxi MENING valyutamga aylantirilgani (taqqoslash uchun) */
  compSellInOwnCcy: number | null;
  diff: number | null; // mening narxim - raqobatchi narxi (mening valyutamda; + => qimmat)
  diffPercent: number | null;
  verdict: 'EXPENSIVE' | 'CHEAP' | 'EQUAL' | 'NOT_FOUND';
}

export interface Product {
  name: string;
  manufacturer: string;
  purchasePrice: number | null;
  sellPrice: number | null;
  row: number; // Excel'dagi qator raqami (xatolikni ko'rsatish uchun)
}

export interface PriceList {
  fileName: string;
  products: Product[];
}

// Bitta o'z mahsuloti uchun bitta raqobatchidagi eng yaqin moslik
export interface MatchHit {
  competitorFile: string;
  product: Product;
  score: number; // 0..1 moslik aniqligi
}

export interface ComparisonRow {
  own: Product;
  bestHit: MatchHit | null; // eng arzon raqobatchi narxi bo'yicha tanlangan
  diffSom: number | null; // mening narxim - raqobatchi narxi (+ => qimmat sotyapman)
  diffPercent: number | null;
  diffUsd: number | null;
  verdict: 'EXPENSIVE' | 'CHEAP' | 'EQUAL' | 'NOT_FOUND';
}

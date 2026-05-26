import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PriceList, Product } from './pricelist.types';

// Ustun sarlavhalarini turli yozuvlardan tanib olish uchun aliaslar.
// "Belgilangan shablon" bo'lsa ham, kichik farqlarga chidamli bo'lsin.
const COLUMN_ALIASES: Record<keyof ColumnMap, string[]> = {
  name: ['nomi', 'nom', 'mahsulot', 'dori', 'tovar', 'name', 'наименование', 'товар', 'препарат'],
  manufacturer: [
    'ishlab chiqaruvchi',
    'i ch',
    'ishlabchiqaruvchi',
    'manufacturer',
    'brand',
    'firma',
    'производитель',
    'завод',
  ],
  purchasePrice: [
    'kelish narxi',
    'sotib olish narxi',
    'kirim narxi',
    'tan narxi',
    'purchase',
    'закупка',
    'закупочная',
    'приход',
  ],
  sellPrice: ['sotish narxi', 'sotuv narxi', 'narxi', 'narx', 'price', 'sale', 'цена', 'продажа'],
};

interface ColumnMap {
  name: number;
  manufacturer: number;
  purchasePrice: number;
  sellPrice: number;
}

export class PriceListParseError extends Error {}

@Injectable()
export class PricelistService {
  private readonly logger = new Logger(PricelistService.name);

  async parse(buffer: Buffer, fileName: string): Promise<PriceList> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch {
      throw new PriceListParseError(
        `«${fileName}» faylini o‘qib bo‘lmadi. Bu haqiqiy .xlsx faylmi?`,
      );
    }

    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount === 0) {
      throw new PriceListParseError(`«${fileName}» bo‘sh ko‘rinadi.`);
    }

    const { headerRow, columns } = this.detectColumns(sheet);
    if (columns.name === -1 || columns.sellPrice === -1) {
      throw new PriceListParseError(
        `«${fileName}»: kerakli ustunlar topilmadi.\n` +
          `Sarlavhalar qatorida kamida «Nomi» va «Sotish narxi» bo‘lishi shart.`,
      );
    }

    const products: Product[] = [];
    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const name = this.cellString(row, columns.name);
      if (!name) continue; // bo'sh qatorni o'tkazib yuboramiz

      products.push({
        name,
        manufacturer:
          columns.manufacturer !== -1 ? this.cellString(row, columns.manufacturer) : '',
        purchasePrice:
          columns.purchasePrice !== -1 ? this.cellNumber(row, columns.purchasePrice) : null,
        sellPrice: this.cellNumber(row, columns.sellPrice),
        row: r,
      });
    }

    if (products.length === 0) {
      throw new PriceListParseError(`«${fileName}»: birorta ham mahsulot topilmadi.`);
    }

    this.logger.log(`«${fileName}» dan ${products.length} ta mahsulot o‘qildi.`);
    return { fileName, products };
  }

  // Birinchi 5 qatordan sarlavha qatorini va ustunlar joylashuvini topadi.
  private detectColumns(sheet: ExcelJS.Worksheet): {
    headerRow: number;
    columns: ColumnMap;
  } {
    const maxScan = Math.min(5, sheet.rowCount);
    let best = { headerRow: 1, columns: this.emptyMap(), score: -1 };

    for (let r = 1; r <= maxScan; r++) {
      const row = sheet.getRow(r);
      const columns = this.emptyMap();
      let matched = 0;
      row.eachCell((cell, col) => {
        const text = this.norm(String(cell.value ?? ''));
        if (!text) return;
        
        for (const key of Object.keys(COLUMN_ALIASES) as (keyof ColumnMap)[]) {
          if (columns[key] !== -1) continue;
          if (COLUMN_ALIASES[key].some((a) => text === this.norm(a) || text.includes(this.norm(a)))) {
            columns[key] = col;
            matched++;
            break; // Ustun bitta maydonga mos kelgach, boshqasiga ham o'zlashmasligi uchun to'xtatamiz!
          }
        }
      });
      if (matched > best.score) best = { headerRow: r, columns, score: matched };
    }
    return { headerRow: best.headerRow, columns: best.columns };
  }

  private emptyMap(): ColumnMap {
    return { name: -1, manufacturer: -1, purchasePrice: -1, sellPrice: -1 };
  }

  private cellString(row: ExcelJS.Row, col: number): string {
    const v = row.getCell(col).value;
    if (v == null) return '';
    if (typeof v === 'object' && 'text' in (v as any)) return String((v as any).text).trim();
    return String(v).trim();
  }

  private cellNumber(row: ExcelJS.Row, col: number): number | null {
    const v = row.getCell(col).value;
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    // "12 500" yoki "12,500.00" kabi matnli narxlarni ham tushunamiz
    const cleaned = String(v).replace(/[^\d.,-]/g, '').replace(/\s/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  private norm(s: string): string {
    return s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

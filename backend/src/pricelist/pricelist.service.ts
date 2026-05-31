import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PriceList, Product } from './pricelist.types';

// Ustun sarlavhalarini turli yozuvlardan tanib olish uchun aliaslar.
// Ko'p tilli: o'zbek (lotin/kirill), rus, ingliz, fransuz — fayl qaysi tilda
// bo'lishidan qat'i nazar ustunlar tanilsin.
const COLUMN_ALIASES: Record<keyof ColumnMap, string[]> = {
  name: [
    'nomi', 'nom', 'mahsulot', 'dori', 'tovar', 'tovar nomi',
    'name', 'product', 'item', 'drug', 'medicine',
    'наименование', 'товар', 'препарат', 'название', 'номенклатура',
    'nom', 'produit', 'designation', 'médicament', 'medicament', 'libellé', 'libelle',
  ],
  manufacturer: [
    'ishlab chiqaruvchi', 'i ch', 'ishlabchiqaruvchi', 'yetkazib beruvchi', 'taminotchi', 'firma',
    'manufacturer', 'brand', 'supplier', 'vendor', 'maker',
    'производитель', 'завод', 'поставщик', 'фирма', 'бренд',
    'fabricant', 'fournisseur', 'marque', 'laboratoire',
  ],
  country: [
    'davlat', 'mamlakat', 'keladigan davlat', 'ishlab chiqarilgan davlat', 'mamlakati', 'origin',
    'country', 'country of origin', 'made in', 'origin country',
    'страна', 'страна происхождения', 'происхождение',
    'pays', "pays d'origine", 'origine',
  ],
  purchasePrice: [
    'kelish narxi', 'sotib olish narxi', 'kirim narxi', 'tan narxi', 'kelish',
    'purchase', 'purchase price', 'cost', 'cost price', 'buy price',
    'закупка', 'закупочная', 'приход', 'себестоимость', 'закупочная цена',
    'prix achat', "prix d'achat", 'cout', 'coût',
  ],
  sellPrice: [
    'sotish narxi', 'sotuv narxi', 'narxi', 'narx', 'sotish',
    'price', 'sale', 'sale price', 'sell price', 'selling price', 'retail',
    'цена', 'продажа', 'цена продажи', 'розница', 'стоимость',
    'prix', 'prix de vente', 'vente', 'tarif',
  ],
};

interface ColumnMap {
  name: number;
  manufacturer: number;
  country: number;
  purchasePrice: number;
  sellPrice: number;
}

// Matnli/raqamli xom katak qiymati
type Cell = string | number | boolean | Date | null | undefined;

export class PriceListParseError extends Error {}

@Injectable()
export class PricelistService {
  private readonly logger = new Logger(PricelistService.name);

  async parse(buffer: Buffer, fileName: string): Promise<PriceList> {
    // SheetJS .xlsx VA eski .xls (BIFF) formatini ham o'qiydi.
    let rows: Cell[][];
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
      if (!sheet) {
        throw new PriceListParseError(`«${fileName}» bo‘sh ko‘rinadi.`);
      }
      rows = XLSX.utils.sheet_to_json<Cell[]>(sheet, {
        header: 1,
        raw: true,
        defval: null,
        blankrows: false,
      });
    } catch (err) {
      if (err instanceof PriceListParseError) throw err;
      throw new PriceListParseError(
        `«${fileName}» faylini o‘qib bo‘lmadi. Bu haqiqiy Excel (.xlsx yoki .xls) faylmi?`,
      );
    }

    if (!rows || rows.length === 0) {
      throw new PriceListParseError(`«${fileName}» bo‘sh ko‘rinadi.`);
    }

    const { headerRow, columns } = this.detectColumns(rows);
    if (columns.name === -1 || columns.sellPrice === -1) {
      throw new PriceListParseError(
        `«${fileName}»: kerakli ustunlar topilmadi.\n` +
          `Sarlavhalar qatorida kamida «Nomi» va «Sotish narxi» (yoki ularning tarjimasi) bo‘lishi shart.`,
      );
    }

    const products: Product[] = [];
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      const name = this.cellString(row[columns.name]);
      if (!name) continue; // bo'sh qatorni o'tkazib yuboramiz

      products.push({
        name,
        manufacturer:
          columns.manufacturer !== -1 ? this.cellString(row[columns.manufacturer]) : '',
        country: columns.country !== -1 ? this.cellString(row[columns.country]) : '',
        purchasePrice:
          columns.purchasePrice !== -1 ? this.cellNumber(row[columns.purchasePrice]) : null,
        sellPrice: this.cellNumber(row[columns.sellPrice]),
        row: r + 1, // 1-asosli qator raqami (foydalanuvchiga ko'rsatish uchun)
      });
    }

    if (products.length === 0) {
      throw new PriceListParseError(`«${fileName}»: birorta ham mahsulot topilmadi.`);
    }

    this.logger.log(`«${fileName}» dan ${products.length} ta mahsulot o‘qildi.`);
    return { fileName, products };
  }

  // Sarlavha qatorini topadi. Dorixona/1C prays-listlari yuqorida ko'p
  // metama'lumot (kompaniya nomi, manzil, sana...) saqlaydi — shuning uchun
  // 25 qatorgacha skanlaymiz va eng ko'p ustun mos kelgan qatorni tanlaymiz.
  private detectColumns(rows: Cell[][]): { headerRow: number; columns: ColumnMap } {
    const maxScan = Math.min(25, rows.length);
    let best = { headerRow: 0, columns: this.emptyMap(), score: -1 };

    for (let r = 0; r < maxScan; r++) {
      const row = rows[r] ?? [];
      const columns = this.emptyMap();
      let matched = 0;

      row.forEach((cell, col) => {
        const text = this.norm(this.cellString(cell));
        if (!text) return;

        for (const key of Object.keys(COLUMN_ALIASES) as (keyof ColumnMap)[]) {
          if (columns[key] !== -1) continue;
          if (
            COLUMN_ALIASES[key].some((a) => {
              const na = this.norm(a);
              return text === na || text.includes(na);
            })
          ) {
            columns[key] = col;
            matched++;
            break; // Bir ustun bitta maydonga mos kelgach to'xtaymiz
          }
        }
      });

      if (matched > best.score) best = { headerRow: r, columns, score: matched };
    }

    return { headerRow: best.headerRow, columns: best.columns };
  }

  private emptyMap(): ColumnMap {
    return { name: -1, manufacturer: -1, country: -1, purchasePrice: -1, sellPrice: -1 };
  }

  private cellString(v: Cell): string {
    if (v == null) return '';
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object' && 'text' in (v as any)) return String((v as any).text).trim();
    return String(v).trim();
  }

  private cellNumber(v: Cell): number | null {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    // "12 500" yoki "12,500.00" kabi matnli narxlarni ham tushunamiz
    const cleaned = String(v)
      .replace(/[^\d.,-]/g, '')
      .replace(/\s/g, '')
      .replace(',', '.');
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

import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PriceList, Product } from './pricelist.types';

// Ustun sarlavhalarini turli yozuvlardan tanib olish uchun aliaslar.
// Ko'p tilli: o'zbek (lotin/kirill), rus, ingliz, fransuz, nemis, ispan, italyan,
// turk — fayl qaysi tilda bo'lishidan qat'i nazar ustunlar tanilsin. Bu lug'atda
// topilmasa, contentga qarab taxmin qiluvchi fallback ishlaydi (inferColumns).
const COLUMN_ALIASES: Record<keyof ColumnMap, string[]> = {
  name: [
    'nomi', 'nom', 'mahsulot', 'dori', 'tovar', 'tovar nomi',
    'name', 'product', 'item', 'drug', 'medicine', 'description',
    'наименование', 'товар', 'препарат', 'название', 'номенклатура',
    'produit', 'designation', 'médicament', 'medicament', 'libellé', 'libelle',
    // nemis / ispan / italyan / turk
    'medikamentenname', 'bezeichnung', 'artikel', 'produkt', 'name des medikaments',
    'medicamento', 'producto', 'nombre', 'farmaco', 'prodotto', 'ilaç', 'ilac', 'urun',
  ],
  manufacturer: [
    'ishlab chiqaruvchi', 'i ch', 'ishlabchiqaruvchi', 'yetkazib beruvchi', 'taminotchi', 'firma',
    'manufacturer', 'brand', 'supplier', 'vendor', 'maker',
    'производитель', 'завод', 'поставщик', 'фирма', 'бренд',
    'fabricant', 'fournisseur', 'marque', 'laboratoire',
    // nemis / ispan / italyan / turk
    'hersteller', 'lieferant', 'anbieter', 'fabricante', 'proveedor', 'produttore',
    'fornitore', 'üretici', 'uretici', 'tedarikçi', 'tedarikci',
  ],
  country: [
    'davlat', 'mamlakat', 'keladigan davlat', 'ishlab chiqarilgan davlat', 'mamlakati', 'origin',
    'country', 'country of origin', 'made in', 'origin country',
    'страна', 'страна происхождения', 'происхождение',
    'pays', "pays d'origine", 'origine',
    // nemis / ispan / italyan / turk
    'herkunftsland', 'herkunft', 'land', 'país', 'pais', 'origen', 'paese', 'origine',
    'ülke', 'ulke', 'menşei', 'mensei',
  ],
  purchasePrice: [
    'kelish narxi', 'sotib olish narxi', 'kirim narxi', 'tan narxi', 'kelish',
    'purchase', 'purchase price', 'cost', 'cost price', 'buy price',
    'закупка', 'закупочная', 'приход', 'себестоимость', 'закупочная цена',
    'prix achat', "prix d'achat", 'cout', 'coût',
    // nemis / ispan / italyan / turk
    'einkaufspreis', 'ek-preis', 'precio de compra', 'costo', 'prezzo acquisto',
    'alış fiyatı', 'alis fiyati', 'maliyet',
  ],
  sellPrice: [
    'sotish narxi', 'sotuv narxi', 'narxi', 'narx', 'sotish',
    'price', 'sale', 'sale price', 'sell price', 'selling price', 'retail',
    'цена', 'продажа', 'цена продажи', 'розница', 'стоимость',
    'prix', 'prix de vente', 'vente', 'tarif',
    // nemis / ispan / italyan / turk (narx ko'pincha valyuta bilan: "Preis (EUR)")
    'preis', 'verkaufspreis', 'vk-preis', 'precio', 'precio de venta', 'prezzo',
    'prezzo vendita', 'fiyat', 'satış fiyatı', 'satis fiyati',
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

    // Lug'at bilan topilmasa — ustun TARKIBIGA qarab taxmin qilamiz. Bu nemis,
    // ispan yoki boshqa noma'lum tildagi sarlavhalar uchun ham ishlaydi:
    // matnli ustun = nom, narxga o'xshash sonli ustun = narx.
    this.inferMissingColumns(rows, headerRow, columns);

    if (columns.name === -1 || columns.sellPrice === -1) {
      throw new PriceListParseError(
        `«${fileName}»: kerakli ustunlar topilmadi.\n` +
          `Faylda kamida mahsulot nomi va narx ustunlari bo‘lishi kerak.`,
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

  /**
   * Lug'at bilan topilmagan «name»/«sellPrice» ustunlarini ma'lumot tarkibiga
   * qarab taxmin qiladi — har qanday tildagi sarlavha uchun ishlasin.
   * Heuristika: ma'lumot qatorlaridan ustunlarni profillab,
   *   • nom    = eng uzun, ko'p so'zli MATNLI ustun (raqam emas),
   *   • narx   = qiymatlari musbat son bo'lgan ustun (nom'dan boshqa).
   */
  private inferMissingColumns(rows: Cell[][], headerRow: number, columns: ColumnMap): void {
    if (columns.name !== -1 && columns.sellPrice !== -1) return; // hammasi topilgan

    const sampleStart = headerRow + 1;
    const sampleEnd = Math.min(sampleStart + 40, rows.length);
    const colCount = Math.max(0, ...rows.slice(sampleStart, sampleEnd).map((r) => r?.length ?? 0));

    interface Prof { textCount: number; numCount: number; avgLen: number; avgWords: number; }
    const profs: Prof[] = [];
    for (let c = 0; c < colCount; c++) {
      let textCount = 0, numCount = 0, totalLen = 0, totalWords = 0, n = 0;
      for (let r = sampleStart; r < sampleEnd; r++) {
        const v = rows[r]?.[c];
        if (v == null || v === '') continue;
        n++;
        const num = this.cellNumber(v);
        const str = this.cellString(v);
        // Faqat son bo'lsa — raqamli; aks holda matnli.
        if (num != null && !/[a-zа-яäöüßçğış]/i.test(str)) {
          numCount++;
          totalLen += String(num).length;
        } else {
          textCount++;
          totalLen += str.length;
          totalWords += str.split(/\s+/).filter(Boolean).length;
        }
      }
      profs.push({
        textCount,
        numCount,
        avgLen: n ? totalLen / n : 0,
        avgWords: textCount ? totalWords / textCount : 0,
      });
    }

    const taken = new Set(
      Object.values(columns).filter((v) => v !== -1) as number[],
    );

    // NOM: eng ko'p so'zli / uzun matnli ustun (band bo'lmaganlar orasidan).
    if (columns.name === -1) {
      let best = -1, bestScore = -1;
      profs.forEach((p, c) => {
        if (taken.has(c)) return;
        if (p.textCount < p.numCount) return; // asosan matnli bo'lsin
        const score = p.avgWords * 10 + p.avgLen;
        if (p.textCount > 0 && score > bestScore) { bestScore = score; best = c; }
      });
      if (best !== -1) { columns.name = best; taken.add(best); }
    }

    // NARX: asosan musbat sonli ustun (band bo'lmaganlar orasidan, nom emas).
    // Bir nechta bo'lsa — birinchisini sotish narxi deb olamiz.
    if (columns.sellPrice === -1) {
      let best = -1, bestNum = -1;
      profs.forEach((p, c) => {
        if (taken.has(c)) return;
        if (p.numCount > bestNum && p.numCount >= p.textCount) { bestNum = p.numCount; best = c; }
      });
      if (best !== -1) { columns.sellPrice = best; taken.add(best); }
    }

    if (columns.name !== -1 || columns.sellPrice !== -1) {
      this.logger.log(
        `Sarlavhalar lug'atda topilmadi — tarkibga qarab taxmin qilindi ` +
          `(nom=ustun ${columns.name}, narx=ustun ${columns.sellPrice}).`,
      );
    }
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

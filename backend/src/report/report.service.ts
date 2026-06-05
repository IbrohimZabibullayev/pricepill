import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { ComparisonRow, Currency } from '../pricelist/pricelist.types';

const borderStyle: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
  left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
  bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
  right: { style: 'thin', color: { argb: 'FFE0E0E0' } },
};

// Tanish valyutalar uchun belgi. Boshqalari uchun kod ishlatiladi (HRK, GBP...).
const CCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', RUB: '₽', GBP: '£' };
// Maydaroq birlik (kasrli) valyutalar — 2 kasr; qolganlari (UZS, RUB...) butun.
const DECIMAL_CCY = new Set(['USD', 'EUR', 'GBP', 'CHF', 'HRK', 'TRY', 'CNY']);

/** Valyutaning ko'rsatiladigan belgisi (yoki kodi: "so'm", "HRK"). */
function ccyLabel(ccy: Currency): string {
  if (ccy === 'UZS') return "so'm";
  return CCY_SYMBOL[ccy] ?? ccy; // belgi bo'lsa belgi, aks holda kod (HRK, KZT...)
}

/** Sonni valyuta bilan matn qilib qaytaradi: "12 000 so'm", "$4.20", "7.20 HRK". */
function money(amount: number | null | undefined, ccy: Currency): string {
  if (amount == null) return '—';
  const decimals = DECIMAL_CCY.has(ccy) ? 2 : 0;
  const num = amount.toLocaleString('ru-RU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const label = ccyLabel(ccy);
  // $/€/£ — son oldida; so'm/HRK/kod — sondan keyin.
  return label.length === 1 ? `${label}${num}` : `${num} ${label}`;
}

@Injectable()
export class ReportService {
  async build(rows: ComparisonRow[], ownFileName: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'PricePill';
    wb.created = new Date();

    // Taqqoslash jadvali birinchi sahifa bo'lib chiqadi (Default ochiladi)
    this.buildComparisonSheet(wb, rows);
    this.buildSummarySheet(wb, rows, ownFileName);
    this.buildNotFoundSheet(wb, rows);

    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out);
  }

  private buildComparisonSheet(wb: ExcelJS.Workbook, rows: ComparisonRow[]) {
    const ws = wb.addWorksheet('Taqqoslash jadvali');
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const headers = [
      '№',
      'Mening dorim',
      'Raqobatchi dorisi',
      'Mening narxim',
      'Raqobatdagi narx',
      `Narx farqi`,
      'Farq (%)',
      'Mening yetkazib beruvchim',
      'Raqobatdagi yetkazib beruvchi',
      'Mening davlatim',
      'Raqobatchi davlati',
      'Raqobatchi (fayl)',
    ];

    const headerRow = ws.addRow(headers);
    headerRow.height = 30;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F497D' } }; // Deep Navy
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = borderStyle;
    });

    const found = rows.filter((r) => r.verdict !== 'NOT_FOUND');
    found.forEach((r, i) => {
      const compProduct = r.bestHit?.product ?? null;
      const ownCcy = r.ownCurrency;
      const compCcy = r.compCurrency;
      const sellPct = r.diffPercent != null ? r.diffPercent / 100 : null;

      // Raqobatchi narxi: o'z valyutasida; agar mendan farq qilsa — UZS/mening
      // valyutamga aylangani ham qavs ichida ko'rsatiladi.
      let compPriceText = '—';
      if (compProduct?.sellPrice != null && compCcy) {
        compPriceText = money(compProduct.sellPrice, compCcy);
        if (compCcy !== ownCcy && r.compSellInOwnCcy != null) {
          compPriceText += ` (= ${money(r.compSellInOwnCcy, ownCcy)})`;
        }
      }

      const row = ws.addRow(new Array(headers.length).fill(null));
      row.height = 22;

      this.setCell(row.getCell(1), i + 1, undefined, 'center');
      this.setCell(row.getCell(2), r.own.name, undefined, 'left');
      // Raqobatchining AYNAN qaysi dorisi mos kelgani — moslik to'g'riligini
      // ko'z bilan tekshirish uchun. Bo'lmasa noto'g'ri taqqoslash ko'rinmas edi.
      this.setCell(row.getCell(3), compProduct?.name ?? '—', undefined, 'left');
      this.setCell(row.getCell(4), money(r.own.sellPrice, ownCcy), undefined, 'right');
      this.setCell(row.getCell(5), compPriceText, undefined, 'right');
      // Narx farqi — har doim MENING valyutamda.
      this.setCell(row.getCell(6), r.diff != null ? money(r.diff, ownCcy) : '—', undefined, 'right');
      this.setCell(row.getCell(7), sellPct, '0.0%', 'right');
      this.setCell(row.getCell(8), r.own.manufacturer || '—', undefined, 'left');
      this.setCell(row.getCell(9), compProduct?.manufacturer || '—', undefined, 'left');
      this.setCell(row.getCell(10), r.own.country || '—', undefined, 'left');
      this.setCell(row.getCell(11), compProduct?.country || '—', undefined, 'left');
      this.setCell(row.getCell(12), r.bestHit?.competitorFile ?? '—', undefined, 'left');

      // Qimmat sotyapsiz — yumshoq qizil, arzon — yumshoq yashil
      const color =
        r.verdict === 'EXPENSIVE' ? 'FFFCE4E4' : r.verdict === 'CHEAP' ? 'FFE4F7E4' : undefined;
      if (color) {
        row.eachCell((c) => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
        });
      }
    });

    ws.autoFilter = { from: 'A1', to: 'L1' };
    this.autofitColumns(ws);
  }

  private buildSummarySheet(wb: ExcelJS.Workbook, rows: ComparisonRow[], ownFileName: string) {
    const ws = wb.addWorksheet('Tahlil xulosasi');
    const found = rows.filter((r) => r.verdict !== 'NOT_FOUND');
    const expensive = found.filter((r) => r.verdict === 'EXPENSIVE');
    const cheap = found.filter((r) => r.verdict === 'CHEAP');
    const avgPct =
      found.length === 0
        ? 0
        : found.reduce((s, r) => s + (r.diffPercent ?? 0), 0) / found.length;

    ws.addRow([]);
    const headerRow = ws.addRow(['PricePill — Tahlil Xulosasi']);
    headerRow.getCell(1).font = { bold: true, size: 16, color: { argb: 'FF1F497D' } };
    ws.addRow([]);

    const addSummaryRow = (label: string, value: any, format?: string) => {
      const row = ws.addRow([label, value]);
      row.height = 22;
      const cellLabel = row.getCell(1);
      const cellVal = row.getCell(2);

      cellLabel.font = { bold: true, color: { argb: 'FF333333' } };
      cellLabel.border = borderStyle;
      cellLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F5F9' } };
      cellLabel.alignment = { vertical: 'middle' };

      cellVal.border = borderStyle;
      if (typeof value === 'number') {
        cellVal.value = value;
        if (format) cellVal.numFmt = format;
        cellVal.alignment = { horizontal: 'right', vertical: 'middle' };
      } else {
        cellVal.value = value;
        cellVal.alignment = { horizontal: 'left', vertical: 'middle' };
      }
    };

    addSummaryRow('Mening price-listim', ownFileName);
    addSummaryRow('Mening valyutam', rows[0] ? ccyLabel(rows[0].ownCurrency) : '—');
    addSummaryRow('Tahlil sanasi', new Date().toLocaleString('uz-UZ'));
    addSummaryRow('Jami mahsulotlar soni', rows.length, '#,##0');
    addSummaryRow('Raqobatchida topilganlari', found.length, '#,##0');
    addSummaryRow('Topilmaganlari', rows.length - found.length, '#,##0');
    addSummaryRow('Qimmat sotilayotganlari', expensive.length, '#,##0');
    addSummaryRow('Arzon sotilayotganlari', cheap.length, '#,##0');
    addSummaryRow("O'rtacha sotish farqi (%)", avgPct / 100, '0.0%');

    ws.getColumn(1).width = 34;
    ws.getColumn(2).width = 38;
  }

  private buildNotFoundSheet(wb: ExcelJS.Workbook, rows: ComparisonRow[]) {
    const ws = wb.addWorksheet('Topilmadi');
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const headers = ['№', 'Nomi', 'Mening narxim', 'Yetkazib beruvchi', 'Davlat'];
    const headerRow = ws.addRow(headers);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5A5A5A' } }; // Neutral Gray
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = borderStyle;
    });

    const notFound = rows.filter((r) => r.verdict === 'NOT_FOUND');
    notFound.forEach((r, i) => {
      const row = ws.addRow(new Array(headers.length).fill(null));
      row.height = 22;

      this.setCell(row.getCell(1), i + 1, undefined, 'center');
      this.setCell(row.getCell(2), r.own.name, undefined, 'left');
      this.setCell(row.getCell(3), money(r.own.sellPrice, r.ownCurrency), undefined, 'right');
      this.setCell(row.getCell(4), r.own.manufacturer || '—', undefined, 'left');
      this.setCell(row.getCell(5), r.own.country || '—', undefined, 'left');
    });

    this.autofitColumns(ws);
  }

  private setCell(cell: ExcelJS.Cell, val: any, format?: string, align?: 'left' | 'center' | 'right') {
    cell.border = borderStyle;
    if (val == null || val === '—' || val === '') {
      cell.value = '—';
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    } else {
      cell.value = val;
      if (format) cell.numFmt = format;
      if (align) cell.alignment = { horizontal: align, vertical: 'middle' };
    }
  }

  private autofitColumns(ws: ExcelJS.Worksheet) {
    ws.columns.forEach((column) => {
      let maxLen = 0;
      if (column.eachCell) {
        column.eachCell({ includeEmpty: true }, (cell) => {
          let val = cell.value;
          if (val != null) {
            if (typeof val === 'object' && 'text' in (val as any)) {
              val = (val as any).text;
            }
            const len = String(val).length;
            if (len > maxLen) {
              maxLen = len;
            }
          }
        });
      }
      column.width = Math.min(Math.max(maxLen + 4, 10), 45);
    });
  }
}

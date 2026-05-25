import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { ComparisonRow } from '../pricelist/pricelist.types';
import { CurrencyService } from '../currency/currency.service';

const borderStyle: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
  left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
  bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
  right: { style: 'thin', color: { argb: 'FFE0E0E0' } },
};

@Injectable()
export class ReportService {
  constructor(private readonly currencyService: CurrencyService) {}

  async build(rows: ComparisonRow[], ownFileName: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'PricePill';
    wb.created = new Date();

    const usdRate = await this.currencyService.getUsdRate();

    // Taqqoslash jadvali birinchi sahifa bo'lib chiqadi (Default ochiladi)
    this.buildComparisonSheet(wb, rows, usdRate);
    this.buildSummarySheet(wb, rows, ownFileName, usdRate);
    this.buildNotFoundSheet(wb, rows);

    const out = await wb.xlsx.writeBuffer();
    return Buffer.from(out);
  }

  private buildComparisonSheet(wb: ExcelJS.Workbook, rows: ComparisonRow[], usdRate: number) {
    const ws = wb.addWorksheet('Taqqoslash jadvali');
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const headers = [
      '№',
      'Nomi',
      'Ishlab chiqaruvchi',
      'Mening kelish narxim',
      'Raqobatchi kelish narxi',
      'Kelish narxi farqi',
      'Mening sotish narxim',
      'Raqobatchi sotish narxi',
      'Sotish narxi farqi',
      'Sotish farqi (%)',
      'Sotish farqi ($)',
      'Raqobatchi',
    ];

    const headerRow = ws.addRow(headers);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F497D' } }; // Deep Navy
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = borderStyle;
    });

    const found = rows.filter((r) => r.verdict !== 'NOT_FOUND');
    found.forEach((r, i) => {
      const diffUsd = r.diffUsd;
      const myPurchase = r.own.purchasePrice;
      const compPurchase = r.bestHit?.product.purchasePrice ?? null;
      const purchaseDiff = (myPurchase != null && compPurchase != null) ? myPurchase - compPurchase : null;

      const row = ws.addRow([
        i + 1,
        r.own.name,
        r.own.manufacturer || '—',
        myPurchase,
        compPurchase,
        purchaseDiff,
        r.own.sellPrice,
        r.bestHit?.product.sellPrice ?? null,
        r.diffSom,
        r.diffPercent != null ? r.diffPercent / 100 : null,
        diffUsd,
        r.bestHit?.competitorFile ?? '—',
      ]);
      row.height = 22;

      // Hujayralarni formatlash
      this.setCell(row.getCell(1), i + 1, undefined, 'center');
      this.setCell(row.getCell(2), r.own.name, undefined, 'left');
      this.setCell(row.getCell(3), r.own.manufacturer || '—', undefined, 'left');
      this.setCell(row.getCell(4), myPurchase, '#,##0', 'right');
      this.setCell(row.getCell(5), compPurchase, '#,##0', 'right');
      this.setCell(row.getCell(6), purchaseDiff, '#,##0', 'right');
      this.setCell(row.getCell(7), r.own.sellPrice, '#,##0', 'right');
      this.setCell(row.getCell(8), r.bestHit?.product.sellPrice ?? null, '#,##0', 'right');
      this.setCell(row.getCell(9), r.diffSom, '#,##0', 'right');
      this.setCell(row.getCell(10), r.diffPercent != null ? r.diffPercent / 100 : null, '0.0%', 'right');
      this.setCell(row.getCell(11), diffUsd, '$#,##0.00', 'right');
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

  private buildSummarySheet(wb: ExcelJS.Workbook, rows: ComparisonRow[], ownFileName: string, usdRate: number) {
    const ws = wb.addWorksheet('Tahlil xulosasi');
    const found = rows.filter((r) => r.verdict !== 'NOT_FOUND');
    const expensive = found.filter((r) => r.verdict === 'EXPENSIVE');
    const cheap = found.filter((r) => r.verdict === 'CHEAP');
    const avgPct =
      found.length === 0
        ? 0
        : found.reduce((s, r) => s + (r.diffPercent ?? 0), 0) / found.length;

    // Sarlavha qatorlari
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
    addSummaryRow('Tahlil sanasi', new Date().toLocaleString('uz-UZ'));
    addSummaryRow('Jami mahsulotlar soni', rows.length, '#,##0');
    addSummaryRow('Raqobatchida topilganlari', found.length, '#,##0');
    addSummaryRow('Topilmaganlari', rows.length - found.length, '#,##0');
    addSummaryRow('Qimmat sotilayotganlari', expensive.length, '#,##0');
    addSummaryRow('Arzon sotilayotganlari', cheap.length, '#,##0');
    addSummaryRow("O'rtacha sotish farqi (%)", avgPct / 100, '0.0%');
    addSummaryRow('USD Kursi (CBU API)', usdRate, '$#,##0.00');

    ws.getColumn(1).width = 34;
    ws.getColumn(2).width = 38;
  }

  private buildNotFoundSheet(wb: ExcelJS.Workbook, rows: ComparisonRow[]) {
    const ws = wb.addWorksheet('Topilmadi');
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const headers = ['№', 'Nomi', 'Ishlab chiqaruvchi', 'Mening kelish narxim', 'Mening sotish narxim'];
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
      const row = ws.addRow([
        i + 1,
        r.own.name,
        r.own.manufacturer || '—',
        r.own.purchasePrice,
        r.own.sellPrice,
      ]);
      row.height = 22;

      this.setCell(row.getCell(1), i + 1, undefined, 'center');
      this.setCell(row.getCell(2), r.own.name, undefined, 'left');
      this.setCell(row.getCell(3), r.own.manufacturer || '—', undefined, 'left');
      this.setCell(row.getCell(4), r.own.purchasePrice, '#,##0', 'right');
      this.setCell(row.getCell(5), r.own.sellPrice, '#,##0', 'right');
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
      column.width = Math.max(maxLen + 4, 10);
    });
  }
}

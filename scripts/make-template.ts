/**
 * Test uchun namuna price-listlar yaratadi:
 *   sample/own.xlsx        — mening narxlarim
 *   sample/competitor.xlsx — raqobatchi narxlari
 * Ishga tushirish:  npm run make:template
 */
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

const HEADERS = ['Nomi', 'Ishlab chiqaruvchi', 'Kelish narxi', 'Sotish narxi'];

async function write(file: string, rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Price');
  ws.addRow(HEADERS).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  ws.columns.forEach((c) => (c.width = 24));
  await wb.xlsx.writeFile(file);
  console.log('✓ yozildi:', file);
}

async function main() {
  const dir = path.join(process.cwd(), 'sample');
  fs.mkdirSync(dir, { recursive: true });

  // Mening price-listim
  await write(path.join(dir, 'own.xlsx'), [
    ['Paratsetamol 500mg №10', 'Nobel', 4000, 6000],
    ['Analgin 500mg №10', 'Farmstandart', 3000, 4500],
    ['Ascorbin kislotasi 100mg', 'Uzfarma', 1500, 2500],
    ['Amoksitsillin 500mg №20', 'Sandoz', 12000, 18000],
    ['No-shpa 40mg №100', 'Chinoin', 45000, 62000],
  ]);

  // Raqobatchi — nomlar biroz boshqacha yozilgan (fuzzy matching sinovi)
  await write(path.join(dir, 'competitor.xlsx'), [
    ['Парацетамол таб. 500 мг 10', 'Nobel Ilac', 3800, 5500],
    ['Analgin 500 mg N10', 'Farmstandart', 2900, 5000],
    ['Аскорбиновая кислота 100мг', 'Uzfarma', 1400, 2200],
    ['Amoxicillin 500mg #20', 'Sandoz', 11500, 17000],
    ['Citramon P №6', 'Pharmstandard', 2000, 3500], // menda yo'q — "topilmadi"ga tushadi
  ]);

  console.log('\nTayyor! Botda avval own.xlsx, keyin competitor.xlsx ni yuboring.');
}

main();

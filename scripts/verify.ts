/**
 * Yadro mantiqni Telegram/DB'siz sinaydi:
 *   parse(own) + parse(competitor) -> match -> report
 * Ishga tushirish:  npx ts-node scripts/verify.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { PricelistService } from '../src/pricelist/pricelist.service';
import { MatchingService } from '../src/matching/matching.service';
import { ReportService } from '../src/report/report.service';

const fakeConfig: any = { get: (_k: string) => undefined };

async function main() {
  const dir = path.join(process.cwd(), 'sample');
  const pricelist = new PricelistService();
  const matching = new MatchingService(fakeConfig);
  const report = new ReportService(fakeConfig);

  const own = await pricelist.parse(fs.readFileSync(path.join(dir, 'own.xlsx')), 'own.xlsx');
  const comp = await pricelist.parse(
    fs.readFileSync(path.join(dir, 'competitor.xlsx')),
    'competitor.xlsx',
  );

  const rows = matching.compare(own, [comp]);

  console.log('\n=== TAQQOSLASH NATIJASI ===');
  for (const r of rows) {
    const verdict = r.verdict.padEnd(10);
    const diff = r.diffSom == null ? '   —' : (r.diffSom > 0 ? '+' : '') + r.diffSom;
    const pct = r.diffPercent == null ? '' : `(${Math.round(r.diffPercent)}%)`;
    const score = r.bestHit ? `[${Math.round(r.bestHit.score * 100)}%]` : '';
    console.log(`${verdict} ${diff} ${pct} ${score}  ${r.own.name}`);
  }

  const matched = rows.filter((r) => r.verdict !== 'NOT_FOUND').length;
  console.log(`\nJami: ${rows.length} | topildi: ${matched} | topilmadi: ${rows.length - matched}`);

  const buf = await report.build(rows, own.fileName);
  const outPath = path.join(dir, 'report.xlsx');
  fs.writeFileSync(outPath, buf);
  console.log('Hisobot yozildi:', outPath, `(${buf.length} bayt)`);
}

main().catch((e) => {
  console.error('XATO:', e);
  process.exit(1);
});

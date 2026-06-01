/**
 * Yadro mantiqni Telegram/DB'siz sinaydi:
 *   parse(own) + parse(competitor) -> match -> report
 * Ishga tushirish:  npx ts-node scripts/verify.ts
 * Yoki o'z fayllaringiz bilan: npx ts-node scripts/verify.ts own.xls comp1.xls comp2.xls
 */
import * as fs from 'fs';
import * as path from 'path';
import { PricelistService } from '../src/pricelist/pricelist.service';
import { MatchingService } from '../src/matching/matching.service';
import { ReportService } from '../src/report/report.service';
import { AnthropicService } from '../src/ai/anthropic.service';

const fakeConfig: any = { get: (k: string) => process.env[k] };

async function main() {
  const dir = path.join(process.cwd(), 'sample');
  const pricelist = new PricelistService();
  const ai = new AnthropicService(fakeConfig);
  const matching = new MatchingService(fakeConfig, ai);
  const report = new ReportService();

  // CLI argumentlari berilsa — o'sha fayllar; bo'lmasa sample/ dagilar.
  const args = process.argv.slice(2);
  const ownPath = args[0] ?? path.join(dir, 'own.xlsx');
  const compPaths = args.length > 1 ? args.slice(1) : [path.join(dir, 'competitor.xlsx')];

  const own = await pricelist.parse(fs.readFileSync(ownPath), path.basename(ownPath));
  const comps = compPaths.map((p) =>
    pricelist.parse(fs.readFileSync(p), path.basename(p)),
  );
  const competitors = await Promise.all(comps);

  const t0 = Date.now();
  const rows = await matching.compare(own, competitors);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const matched = rows.filter((r) => r.verdict !== 'NOT_FOUND').length;
  console.log(`\nJami: ${rows.length} | topildi: ${matched} | topilmadi: ${rows.length - matched}`);
  console.log(`Taqqoslash vaqti: ${elapsed}s`);

  // Faqat dastlabki 15 ta natijani ko'rsatamiz (katta fayllar uchun).
  console.log('\n=== DASTLABKI NATIJALAR ===');
  for (const r of rows.slice(0, 15)) {
    const verdict = r.verdict.padEnd(10);
    const diff = r.diffSom == null ? '   —' : (r.diffSom > 0 ? '+' : '') + r.diffSom;
    const pct = r.diffPercent == null ? '' : `(${Math.round(r.diffPercent)}%)`;
    const score = r.bestHit ? `[${Math.round(r.bestHit.score * 100)}%]` : '';
    console.log(`${verdict} ${diff} ${pct} ${score}  ${r.own.name}`);
  }

  const buf = await report.build(rows, own.fileName);
  const outPath = path.join(dir, 'report.xlsx');
  fs.writeFileSync(outPath, buf);
  console.log('\nHisobot yozildi:', outPath, `(${buf.length} bayt)`);
}

main().catch((e) => {
  console.error('XATO:', e);
  process.exit(1);
});

/**
 * Lokal moslik testi — Telegram/deploy KERAK EMAS.
 *
 * Ikki (yoki ko'p) Excel faylni o'qib, taqqoslab, natijani konsolga jadval
 * qilib chiqaradi: mening dorim → raqobatchi dorisi, narxlar, ishonch (AI),
 * va hukm (qimmat/arzon/topilmadi). Maqsad: noto'g'ri mosliklarni KO'Z bilan
 * tekshirish (masalan "Авицет" hech narsaga ulanmasligini).
 *
 * Ishlatish (backend/ ichida):
 *   npx ts-node scripts/test-match.ts <mening.xls> <raqobatchi1.xls> [raqobatchi2.xls ...]
 *
 * Ixtiyoriy: natija hisobotini ham yozish uchun oxiriga --report qo'shing:
 *   npx ts-node scripts/test-match.ts mening.xls raqobat.xls --report
 *
 * .env dagi ANTHROPIC_API_KEY avtomatik o'qiladi (AI shu bilan ishlaydi).
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { ConfigService } from '@nestjs/config';

import { PricelistService } from '../src/pricelist/pricelist.service';
import { MatchingService } from '../src/matching/matching.service';
import { ReportService } from '../src/report/report.service';
import { AnthropicService } from '../src/ai/anthropic.service';
import { CurrencyService } from '../src/currency/currency.service';
import { PriceList } from '../src/pricelist/pricelist.types';

/** .env ni process.env ga oddiy yuklash (qo'shimcha paket shart emas). */
function loadEnv(): void {
  try {
    const text = readFileSync(resolve(__dirname, '..', '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  } catch {
    console.warn('⚠️  .env topilmadi — AI o\'chiq holda (lokal Levenshtein) ishlaydi.');
  }
}

function pad(s: string, n: number): string {
  s = s ?? '';
  if (s.length > n) return s.slice(0, n - 1) + '…';
  return s.padEnd(n);
}

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const writeReport = args.includes('--report');
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length < 2) {
    console.error('Ishlatish: npx ts-node scripts/test-match.ts <mening.xls> <raqobatchi.xls> [...] [--report]');
    process.exit(1);
  }
  const [ownPath, ...compPaths] = files;

  const config = new ConfigService();
  const ai = new AnthropicService(config);
  const currency = new CurrencyService(config);
  const pricelist = new PricelistService(ai);
  const matching = new MatchingService(config, ai, currency);
  const report = new ReportService();

  const parseFile = async (p: string): Promise<PriceList> => {
    const buf = readFileSync(resolve(p));
    const name = p.split(/[\\/]/).pop() || p;
    return pricelist.parse(buf, name);
  };

  console.log('\n📂 Fayllarni o\'qiyapman...');
  const own = await parseFile(ownPath);
  console.log(`   Mening: «${own.fileName}» — ${own.products.length} dori (${own.currency})`);
  const competitors: PriceList[] = [];
  for (const p of compPaths) {
    const c = await parseFile(p);
    console.log(`   Raqobat: «${c.fileName}» — ${c.products.length} dori (${c.currency})`);
    competitors.push(c);
  }

  console.log('\n🔍 Taqqoslayapman (AI: ' + (ai.isEnabled ? 'YOQILGAN' : 'o\'chiq') + ')...\n');
  const rows = await matching.compare(own, competitors);

  const matched = rows.filter((r) => r.verdict !== 'NOT_FOUND');
  const notFound = rows.length - matched.length;

  // ── Topilgan mosliklar jadvali ──
  console.log('─'.repeat(120));
  console.log(
    pad('MENING DORIM', 34) + '│ ' + pad('RAQOBATCHI DORISI', 40) + '│ ' +
      pad('ISHONCH', 8) + '│ ' + pad('HUKM', 10),
  );
  console.log('─'.repeat(120));
  for (const r of matched) {
    const comp = r.bestHit?.product;
    const conf = r.bestHit ? (r.bestHit.score * 100).toFixed(0) + '%' : '—';
    console.log(
      pad(r.own.name, 34) + '│ ' + pad(comp?.name ?? '—', 40) + '│ ' +
        pad(conf, 8) + '│ ' + pad(r.verdict, 10),
    );
  }
  console.log('─'.repeat(120));
  console.log(`\n✅ Topildi: ${matched.length}   ❌ Topilmadi: ${notFound}   📦 Jami: ${rows.length}\n`);

  if (writeReport) {
    const buf = await report.build(rows, own.fileName);
    const out = resolve('test-hisobot.xlsx');
    writeFileSync(out, buf);
    console.log(`📄 Hisobot yozildi: ${out}\n`);
  }
}

main().catch((e) => {
  console.error('\n💥 Xato:', e?.message ?? e);
  process.exit(1);
});

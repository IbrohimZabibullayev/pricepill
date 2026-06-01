import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { Product } from '../pricelist/pricelist.types';

/** Bitta mahsulot uchun AI tekshiruvi natijalari */
export interface AiMatchResult {
  /** O'z mahsulotning tartibi (index) */
  ownIndex: number;
  /** Eng mos raqobatchi mahsulotning tartibi (candidateIndex), yoki -1 (topilmadi) */
  candidateIndex: number;
  /** AI ishonch darajasi (0-1) */
  confidence: number;
}

/** AI ustun aniqlash natijasi — har maydon uchun 0-asosli indeks yoki -1 */
export interface AiColumnResult {
  name: number;
  sellPrice: number;
  purchasePrice: number;
  manufacturer: number;
  country: number;
}

/** AI ga yuboriladigan bitta taqqoslash so'rovi */
export interface AiMatchRequest {
  ownIndex: number;
  ownProduct: {
    name: string;
    manufacturer?: string | null;
    country?: string | null;
  };
  candidates: Array<{
    candidateIndex: number;
    name: string;
    manufacturer?: string | null;
    country?: string | null;
  }>;
}

// Eng kuchli va eng oxirgi model — tahlil sifati uchun. ANTHROPIC_MODEL bilan
// almashtirsa bo'ladi. MUHIM: eski "claude-3-5-haiku-*" endi mavjud emas (404).
const DEFAULT_MODEL = 'claude-opus-4-8';

// Daqiqasiga kiruvchi token byudjeti. Anthropic'ning eng past tier'i 50k/min;
// shu chegaradan past ushlab tursak — 429 (rate limit) umuman chiqmaydi.
// ANTHROPIC_TPM env bilan tier oshganda kattalashtirish mumkin.
const DEFAULT_TPM = 45000;
const MAX_429_RETRIES = 5;

/**
 * Daqiqalik token byudjetini boshqaradi: har bir so'rovdan oldin oxirgi 60s
 * ichida sarflangan tokenlarni hisoblab, limitdan oshmaslik uchun kutadi.
 * acquire'lar zanjir orqali ketma-ket ishlaydi — poyga (race) bo'lmaydi.
 */
class TokenBudget {
  private events: { t: number; tokens: number }[] = [];
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly limitPerMin: number) {}

  acquire(tokens: number): Promise<void> {
    const run = this.tail.then(() => this.wait(tokens));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async wait(tokens: number): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.events = this.events.filter((e) => now - e.t < 60_000);
      const used = this.events.reduce((s, e) => s + e.tokens, 0);
      // Bo'sh bo'lsa — bitta ulkan so'rov ham o'tsin (deadlock bo'lmasin).
      if (used + tokens <= this.limitPerMin || this.events.length === 0) {
        this.events.push({ t: now, tokens });
        return;
      }
      const oldest = this.events[0];
      const waitMs = Math.min(Math.max(60_000 - (now - oldest.t) + 100, 250), 60_000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

@Injectable()
export class AnthropicService {
  private readonly logger = new Logger(AnthropicService.name);
  private readonly client: Anthropic | null;
  private readonly enabled: boolean;
  private readonly model: string;
  private readonly budget: TokenBudget;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    this.model = config.get<string>('ANTHROPIC_MODEL') || DEFAULT_MODEL;
    const tpm = Number(config.get('ANTHROPIC_TPM')) || DEFAULT_TPM;
    this.budget = new TokenBudget(tpm);
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
      this.enabled = true;
      this.logger.log(`🤖 Anthropic AI matching yoqildi (model: ${this.model}, ${tpm} tok/min).`);
    } else {
      this.client = null;
      this.enabled = false;
      this.logger.warn('⚠️  ANTHROPIC_API_KEY topilmadi — lokal Levenshtein matching ishlatiladi.');
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Promptdagi token sonini taxminlaydi (kirill og'ir bo'lgani uchun ehtiyotkor). */
  private estimateTokens(prompt: string): number {
    return Math.ceil(prompt.length / 2.5) + 300; // + javob/overhead zaxirasi
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Bir guruh (batch) taqqoslash so'rovlarini AIga yuboradi.
   * Token byudjetiga rioya qiladi va 429 bo'lsa kutib qayta uradi.
   * Xato yuz bersa — bo'sh massiv qaytaradi (fallback lokal matchingga o'tadi).
   */
  async matchBatch(requests: AiMatchRequest[]): Promise<AiMatchResult[]> {
    if (!this.client || !this.enabled || requests.length === 0) return [];
    const prompt = this.buildPrompt(requests);
    const text = await this.callModel(prompt, 1024);
    return text ? this.parseResponse(text) : [];
  }

  /**
   * Fayl sarlavhalarini AI bilan aniqlaydi — lug'at topa olmaganda chaqiriladi.
   * Har qanday tilda ishlaydi (portugal, yapon, arab...). Fayl boshida 1 marta.
   * `header` — sarlavha qatori, `samples` — bir necha ma'lumot qatori (kontekst).
   * Natija: har maydon uchun 0-asosli ustun indeksi yoki -1.
   */
  async detectColumnsAi(
    header: string[],
    samples: string[][],
  ): Promise<AiColumnResult | null> {
    if (!this.client || !this.enabled || header.length === 0) return null;
    const prompt = this.buildColumnPrompt(header, samples);
    const text = await this.callModel(prompt, 256);
    if (!text) return null;
    return this.parseColumnResponse(text, header.length);
  }

  /** Model chaqiruvi — token byudjet + 429 retry. Matn yoki null qaytaradi. */
  private async callModel(prompt: string, maxTokens: number): Promise<string | null> {
    if (!this.client) return null;
    const est = this.estimateTokens(prompt);
    for (let attempt = 0; ; attempt++) {
      await this.budget.acquire(est);
      try {
        const message = await this.client.messages.create({
          model: this.model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        });
        return message.content
          .filter((c) => c.type === 'text')
          .map((c) => (c as { type: 'text'; text: string }).text)
          .join('');
      } catch (err: any) {
        if (err?.status === 429 && attempt < MAX_429_RETRIES) {
          const retryAfter = Number(err?.headers?.['retry-after']);
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(2 ** attempt, 30) * 1000;
          this.logger.warn(`Rate limit (429) — ${waitMs / 1000}s kutib qayta urinaman...`);
          await this.sleep(waitMs);
          continue;
        }
        this.logger.error('Anthropic API xatosi:', err?.message ?? err);
        return null;
      }
    }
  }

  // ─────────────────────────── private helpers ───────────────────────────

  private buildColumnPrompt(header: string[], samples: string[][]): string {
    const cols = header.map((h, i) => `  ${i}: "${h}"`).join('\n');
    const rows = samples
      .slice(0, 3)
      .map((r) => '  [' + r.map((c) => `"${c}"`).join(', ') + ']')
      .join('\n');

    return `You are analyzing a pharmacy price-list spreadsheet whose column headers may be in ANY language (Uzbek, Russian, German, Croatian, Spanish, Turkish, etc).

Identify which column index corresponds to each field:
- "name": the medication/product name
- "sellPrice": the selling price (the main price column)
- "purchasePrice": the purchase/cost price, if present
- "manufacturer": the manufacturer or supplier company
- "country": the country of origin

COLUMNS (index: header):
${cols}

SAMPLE DATA ROWS:
${rows}

Use both the header meaning AND the sample data to decide. If a field is not present, use -1.
Respond ONLY with a valid JSON object, no explanation:
{"name": <idx>, "sellPrice": <idx>, "purchasePrice": <idx or -1>, "manufacturer": <idx or -1>, "country": <idx or -1>}`;
  }

  private parseColumnResponse(text: string, colCount: number): AiColumnResult | null {
    try {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return null;
      const o = JSON.parse(m[0]);
      const clamp = (v: any): number => {
        const n = Number(v);
        return Number.isInteger(n) && n >= 0 && n < colCount ? n : -1;
      };
      const res: AiColumnResult = {
        name: clamp(o.name),
        sellPrice: clamp(o.sellPrice),
        purchasePrice: clamp(o.purchasePrice),
        manufacturer: clamp(o.manufacturer),
        country: clamp(o.country),
      };
      // Nom va narx bo'lmasa — foydasiz.
      if (res.name === -1 || res.sellPrice === -1) return null;
      return res;
    } catch {
      return null;
    }
  }

  private buildPrompt(requests: AiMatchRequest[]): string {
    const items = requests.map((r) => {
      const cands = r.candidates
        .map(
          (c, i) =>
            `  ${i}: "${c.name}"${c.manufacturer ? ` (${c.manufacturer})` : ''}${c.country ? ` {${c.country}}` : ''}`,
        )
        .join('\n');
      return (
        `OWN[${r.ownIndex}]: "${r.ownProduct.name}"` +
        (r.ownProduct.manufacturer ? ` (${r.ownProduct.manufacturer})` : '') +
        (r.ownProduct.country ? ` {${r.ownProduct.country}}` : '') +
        `\nNOMINATED CANDIDATES:\n${cands}`
      );
    });

    return `You are a pharmaceutical product matching expert working across MULTIPLE LANGUAGES.
For each OWN product below, identify which NOMINATED CANDIDATE (if any) refers to the same drug product — same active substance, same dosage form (tablet/capsule/syrup/etc), and same strength/dosage.

The product names may be written in DIFFERENT LANGUAGES and scripts (e.g. Uzbek Latin, Uzbek Cyrillic, Russian, English, French). Match by MEANING — the underlying drug — not by spelling. Notation in parentheses "(...)" is the manufacturer; notation in braces "{...}" is the country of origin.

Rules:
- Brand names and generic names for the same substance ARE a match (e.g. "No-shpa" and "Drotaverin").
- The same drug named in different languages IS a match (e.g. "Парацетамол" = "Paratsetamol" = "Paracétamol" = "Paracetamol").
- Different dosages (e.g. 500mg vs 250mg) are NOT a match.
- Different dosage forms (tablet vs syrup) are NOT a match.
- Country of origin and manufacturer are extra context only — DO NOT reject a match just because the country or manufacturer differs.
- If NO candidate matches, use candidateIndex -1.
- Respond ONLY with a valid JSON array, no explanation.

Format:
[{"ownIndex": <number>, "candidateIndex": <number or -1>, "confidence": <0.0-1.0>}, ...]

Products to match:
${items.join('\n\n')}`;
  }

  private parseResponse(text: string): AiMatchResult[] {
    try {
      // JSON blokini ajratib olamiz
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (r: any) =>
          typeof r.ownIndex === 'number' &&
          typeof r.candidateIndex === 'number' &&
          typeof r.confidence === 'number',
      ) as AiMatchResult[];
    } catch {
      this.logger.error('AI javobini parse qilishda xato. Javob:', text.slice(0, 200));
      return [];
    }
  }
}

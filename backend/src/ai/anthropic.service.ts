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

/** AI ga yuboriladigan bitta taqqoslash so'rovi */
export interface AiMatchRequest {
  ownIndex: number;
  ownProduct: {
    name: string;
    manufacturer?: string | null;
    form?: string | null;
  };
  candidates: Array<{
    candidateIndex: number;
    name: string;
    manufacturer?: string | null;
    form?: string | null;
  }>;
}

@Injectable()
export class AnthropicService {
  private readonly logger = new Logger(AnthropicService.name);
  private readonly client: Anthropic | null;
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
      this.enabled = true;
      this.logger.log('🤖 Anthropic AI matching yoqildi.');
    } else {
      this.client = null;
      this.enabled = false;
      this.logger.warn('⚠️  ANTHROPIC_API_KEY topilmadi — lokal Levenshtein matching ishlatiladi.');
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Bir guruh (batch) taqqoslash so'rovlarini AIga yuboradi.
   * Xato yuz bersa — bo'sh massiv qaytaradi (fallback lokal matchingga o'tadi).
   */
  async matchBatch(requests: AiMatchRequest[]): Promise<AiMatchResult[]> {
    if (!this.client || !this.enabled || requests.length === 0) return [];

    const prompt = this.buildPrompt(requests);

    try {
      const message = await this.client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = message.content
        .filter((c) => c.type === 'text')
        .map((c) => (c as { type: 'text'; text: string }).text)
        .join('');

      return this.parseResponse(text);
    } catch (err: any) {
      this.logger.error('Anthropic API xatosi:', err?.message ?? err);
      return []; // fallback
    }
  }

  // ─────────────────────────── private helpers ───────────────────────────

  private buildPrompt(requests: AiMatchRequest[]): string {
    const items = requests.map((r) => {
      const cands = r.candidates
        .map(
          (c, i) =>
            `  ${i}: "${c.name}"${c.manufacturer ? ` (${c.manufacturer})` : ''}${c.form ? ` [${c.form}]` : ''}`,
        )
        .join('\n');
      return (
        `OWN[${r.ownIndex}]: "${r.ownProduct.name}"` +
        (r.ownProduct.manufacturer ? ` (${r.ownProduct.manufacturer})` : '') +
        (r.ownProduct.form ? ` [${r.ownProduct.form}]` : '') +
        `\nNOMINATED CANDIDATES:\n${cands}`
      );
    });

    return `You are a pharmaceutical product matching expert. 
For each OWN product below, identify which NOMINATED CANDIDATE (if any) refers to the same drug product — same active substance, same dosage form (tablet/capsule/syrup/etc), and same strength/dosage.

Rules:
- Brand names and generic names for the same substance ARE a match (e.g. "No-shpa" and "Drotaverin").
- Different dosages (e.g. 500mg vs 250mg) are NOT a match.
- Different dosage forms (tablet vs syrup) are NOT a match.
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

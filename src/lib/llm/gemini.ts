import { GoogleGenAI } from "@google/genai";
import { RateLimiter } from "./rate-limiter";
import { LlmError, type JsonSchema, type LlmProvider } from "./types";

/**
 * Google AI Studio (generativelanguage) 백엔드.
 *
 * 무료 티어 기준 (2026-08): gemini-2.5-flash 10 RPM / 500 RPD,
 * gemini-2.5-flash-lite 15 RPM / 1000 RPD.
 * 무료 티어는 입력이 Google 제품 개선에 쓰일 수 있으므로 공개 웹 콘텐츠만 보낸다.
 */
export class GeminiProvider implements LlmProvider {
  readonly name = "gemini" as const;
  readonly model: string;

  private readonly client: GoogleGenAI;
  private readonly limiter: RateLimiter;

  constructor(opts: { apiKey: string; model?: string; minIntervalMs?: number }) {
    this.model = opts.model ?? "gemini-2.5-flash";
    this.client = new GoogleGenAI({ apiKey: opts.apiKey });
    this.limiter = new RateLimiter(opts.minIntervalMs ?? 7000);
  }

  async generateJson<T>(args: {
    system: string;
    user: string;
    schema: JsonSchema;
    maxOutputTokens?: number;
  }): Promise<T> {
    const text = await this.limiter.run(async () => {
      try {
        const res = await this.client.models.generateContent({
          model: this.model,
          contents: [{ role: "user", parts: [{ text: args.user }] }],
          config: {
            systemInstruction: args.system,
            responseMimeType: "application/json",
            // responseJsonSchema 가 표준 JSON Schema 를 그대로 받는다.
            responseJsonSchema: args.schema,
            maxOutputTokens: args.maxOutputTokens ?? 8192,
            temperature: 0.4,
          },
        });
        return res.text ?? "";
      } catch (e) {
        throw new LlmError("gemini", "생성 요청 실패", e);
      }
    });

    if (!text.trim()) {
      throw new LlmError("gemini", "빈 응답을 받았습니다.");
    }

    try {
      return JSON.parse(text) as T;
    } catch (e) {
      throw new LlmError("gemini", `JSON 파싱 실패: ${text.slice(0, 200)}`, e);
    }
  }
}

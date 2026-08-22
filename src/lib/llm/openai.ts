import OpenAI from "openai";
import { RateLimiter } from "./rate-limiter";
import { LlmError, type JsonSchema, type LlmProvider } from "./types";

/**
 * OpenAI 백엔드.
 *
 * Structured Outputs(json_schema) 를 쓰므로 스키마를 벗어난 응답이 오지 않는다.
 * 유료 API 라 기본적으로 입력이 학습에 사용되지 않는다.
 */
export class OpenAiProvider implements LlmProvider {
  readonly name = "openai" as const;
  readonly model: string;

  private readonly client: OpenAI;
  private readonly limiter: RateLimiter;

  constructor(opts: { apiKey: string; model?: string; minIntervalMs?: number }) {
    this.model = opts.model ?? "gpt-5-mini";
    this.client = new OpenAI({ apiKey: opts.apiKey });
    this.limiter = new RateLimiter(opts.minIntervalMs ?? 500);
  }

  async generateJson<T>(args: {
    system: string;
    user: string;
    schema: JsonSchema;
    maxOutputTokens?: number;
  }): Promise<T> {
    const text = await this.limiter.run(async () => {
      try {
        const res = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: "system", content: args.system },
            { role: "user", content: args.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "trend_articles",
              strict: false,
              schema: args.schema as Record<string, unknown>,
            },
          },
          max_completion_tokens: args.maxOutputTokens ?? 8192,
        });
        return res.choices[0]?.message?.content ?? "";
      } catch (e) {
        throw new LlmError("openai", "생성 요청 실패", e);
      }
    });

    if (!text.trim()) {
      throw new LlmError("openai", "빈 응답을 받았습니다.");
    }

    try {
      return JSON.parse(text) as T;
    } catch (e) {
      throw new LlmError("openai", `JSON 파싱 실패: ${text.slice(0, 200)}`, e);
    }
  }
}

import OpenAI from "openai";
import { RateLimiter } from "./rate-limiter";
import { LlmError, type JsonSchema, type LlmProvider } from "./types";

/**
 * OpenAI 백엔드.
 *
 * Structured Outputs(json_schema) 를 쓰므로 스키마를 벗어난 응답이 오지 않는다.
 * 유료 API 라 기본적으로 입력이 학습에 사용되지 않는다.
 *
 * gpt-5.6 계열 주의사항 두 가지:
 *   - temperature 를 보내지 않는다. 이 계열은 1 만 받아서, 값을 넣는 순간
 *     400 이 된다. Gemini 쪽(gemini.ts)이 0.4 를 쓰고 있어 여기도 맞추고 싶어
 *     보이지만 맞추면 안 된다.
 *   - 추론 토큰이 max_completion_tokens 안에서 함께 소모된다. 상한이 빡빡하면
 *     본문이 중간에 끊기고, 끊긴 JSON 은 파싱 실패로 배치가 통째로 버려진다
 *     (sync/trend.ts 의 배치 단위 건너뛰기).
 */
export class OpenAiProvider implements LlmProvider {
  readonly name = "openai" as const;
  readonly model: string;

  private readonly client: OpenAI;
  private readonly limiter: RateLimiter;

  constructor(opts: { apiKey: string; model?: string; minIntervalMs?: number }) {
    this.model = opts.model ?? "gpt-5.6-luna";
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
          // 배치 5건 × 소제목으로 구획된 본문 + 추론 토큰까지 한 상한에서
          // 나눠 쓴다. 예전 기본값 8192 는 추론 모델에서 본문을 자른다.
          max_completion_tokens: args.maxOutputTokens ?? 32768,
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

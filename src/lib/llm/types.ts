import type { LlmProviderName } from "@/types/db";

/**
 * 트렌드 브리핑 기사 작성에 쓰는 LLM 인터페이스.
 *
 * Gemini 와 OpenAI 를 같은 모양으로 감싼다. 호출부(src/lib/sync/trend.ts)는
 * 어느 쪽이 붙었는지 알 필요가 없고, GitHub Actions 에서 LLM_PROVIDER 환경변수로
 * 갈아끼운다.
 */

export interface JsonSchema {
  type: "object" | "array" | "string" | "number" | "boolean";
  [k: string]: unknown;
}

export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly model: string;

  /**
   * 구조화 JSON 응답을 받는다.
   * 두 제공자 모두 스키마 강제 기능을 지원하므로 파싱 실패는 거의 없지만,
   * 실패 시 예외를 던져 호출부가 해당 배치를 건너뛸 수 있게 한다.
   */
  generateJson<T>(args: {
    system: string;
    user: string;
    schema: JsonSchema;
    /** 응답 최대 토큰 (기본값은 구현체가 정함) */
    maxOutputTokens?: number;
  }): Promise<T>;
}

export class LlmError extends Error {
  readonly provider: LlmProviderName;
  readonly cause?: unknown;

  constructor(provider: LlmProviderName, message: string, cause?: unknown) {
    super(`[${provider}] ${message}`);
    this.name = "LlmError";
    this.provider = provider;
    this.cause = cause;
  }
}

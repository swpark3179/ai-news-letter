import { GeminiProvider } from "./gemini";
import { OpenAiProvider } from "./openai";
import type { LlmProvider } from "./types";

export * from "./types";
export * from "./prompts";

/**
 * LLM_PROVIDER 환경변수로 제공자를 고른다.
 *
 *   LLM_PROVIDER=gemini  → Google AI Studio (GEMINI_API_KEY)   — CI 기본
 *   LLM_PROVIDER=openai  → OpenAI (OPENAI_API_KEY)
 *
 * 워크플로 파일이 이 값만 바꿔서 같은 스크립트를 재사용한다.
 */
export function getLlm(override?: "gemini" | "openai"): LlmProvider {
  const provider = override ?? (process.env.LLM_PROVIDER === "openai" ? "openai" : "gemini");

  const intervalRaw = Number(process.env.LLM_MIN_CALL_INTERVAL_MS);
  const minIntervalMs = Number.isFinite(intervalRaw) && intervalRaw >= 0
    ? intervalRaw
    : undefined;

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY 가 없습니다. LLM_PROVIDER=openai 로 실행하려면 키가 필요합니다.",
      );
    }
    return new OpenAiProvider({
      apiKey,
      model: process.env.OPENAI_MODEL,
      minIntervalMs,
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY 가 없습니다. https://aistudio.google.com/apikey 에서 발급하세요.",
    );
  }
  return new GeminiProvider({
    apiKey,
    model: process.env.GEMINI_MODEL,
    minIntervalMs,
  });
}

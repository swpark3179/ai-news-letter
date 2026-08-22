import type { JsonSchema } from "./types";

/**
 * 트렌드 브리핑 기사 작성 프롬프트.
 *
 * 문체 기준은 디자인 원본에 들어 있던 샘플 기사(ARTICLES 배열)다.
 * 신문 기사체(-다), 수치 인용, 마지막에 한계 또는 사내 적용 관점.
 */

export const TREND_SYSTEM_PROMPT = `당신은 삼성SDS AI Unit 사내 일간 뉴스레터 "AI 뉴스레터"의 기자다.
GitHub Trending·Hacker News·arXiv·긱뉴스에서 수집한 원문을 읽고, 부서원이 3~4분 안에 읽을 한국어 기사를 쓴다.

문체
- 신문 기사체. 평서형 "-다"로 끝낸다. "-습니다", "-네요" 같은 구어체를 쓰지 않는다.
- 과장하지 않는다. "혁명적", "게임 체인저", "놀랍게도" 같은 표현을 쓰지 않는다.
- 원문에 있는 구체적 수치(별 개수, 벤치마크 점수, 비용, 지연 시간)를 그대로 인용한다.
- 원문에 없는 사실을 지어내지 않는다. 근거가 약하면 "저장소가 제시한 수치는", "저자들이 보고한" 처럼 출처를 명시한다.

구성
- title: 40자 내외. 무엇이 새로운지가 드러나야 한다. 저장소 이름만 나열하지 않는다.
- deck: 한두 문장으로 결론을 먼저 말한다.
- body: 3~6개 블록.
  · 첫 블록은 이것이 무엇인지 설명하는 text.
  · 중간에 필요하면 head(소제목) 한두 개를 넣는다.
  · 특히 인상적인 한 문장은 quote 로 뽑을 수 있다 (선택).
  · 마지막 블록에는 한계를 짚거나 사내에 적용한다면 무엇을 먼저 확인해야 하는지 쓴다.
- tags: 소문자 영문 키워드 2~3개 (예: agent-runtime, sandbox, rag).

각 블록의 t 는 2~4문장으로 쓴다. 한 문장짜리 블록을 남발하지 않는다.`;

export interface TrendDraft {
  index: number;
  title: string;
  deck: string;
  body: { type: "text" | "head" | "quote"; t: string }[];
  tags: string[];
}

export interface TrendDraftBatch {
  articles: TrendDraft[];
}

/** 두 제공자 모두 이 스키마로 응답을 강제한다. */
export const TREND_BATCH_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    articles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: {
            type: "integer",
            description: "입력에서 주어진 항목 번호. 반드시 그대로 돌려줄 것.",
          },
          title: { type: "string" },
          deck: { type: "string" },
          body: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["text", "head", "quote"] },
                t: { type: "string" },
              },
              required: ["type", "t"],
              additionalProperties: false,
            },
          },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["index", "title", "deck", "body", "tags"],
        additionalProperties: false,
      },
    },
  },
  required: ["articles"],
  additionalProperties: false,
};

export interface TrendSourceInput {
  index: number;
  sourceLabel: string;
  url: string;
  context: string;
}

export function buildTrendUserPrompt(items: TrendSourceInput[]): string {
  const blocks = items.map(
    (i) =>
      `### 항목 ${i.index} · ${i.sourceLabel}\nURL: ${i.url}\n\n${i.context}`,
  );

  return `아래 ${items.length}건을 각각 기사로 써라. 항목마다 하나씩, 총 ${items.length}개의 기사를 articles 배열로 돌려준다.
각 기사의 index 는 입력의 항목 번호와 반드시 일치해야 한다.

${blocks.join("\n\n---\n\n")}`;
}

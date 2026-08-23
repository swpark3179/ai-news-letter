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
- deck: 한 문장, 60자 내외. 결론을 먼저 말한다. 목록에서 두 줄 안에 읽히도록 짧고 쉬운 말로 쓴다.
  deck 은 목록용 한 줄 요약이다. 상세한 설명은 전부 body 로 넘기고 deck 에 담지 않는다.
- body: 5~8개 블록. 소제목으로 구획해서, 상세 화면에서 읽는 사람이 흐름을 따라갈 수 있게 한다.
  · 첫 블록은 소제목 없이 text 로 시작한다. 이것이 무엇이고 왜 지금 눈에 띄는지 쓴다.
  · 그다음부터는 head(소제목) 로 문단을 묶는다. 아래 골격을 기본으로 삼는다.
      head "어떻게 동작하나" 계열 + text — 구조·방식·핵심 아이디어
      head "수치와 근거" 계열 + text — 원문이 제시한 별 개수·벤치마크 점수·비용·지연 시간
      head "한계" 또는 "사내 적용" 계열 + text — 걸리는 점과 먼저 확인해야 할 것
  · 특히 인상적인 한 문장은 quote 로 뽑을 수 있다 (선택, 최대 1개).
  · 마지막 블록은 한계를 짚거나 사내에 적용한다면 무엇을 먼저 확인해야 하는지로 닫는다.
- tags: 소문자 영문 키워드 2~3개 (예: agent-runtime, sandbox, rag).

문단 규칙
- 각 text 블록의 t 는 3~5문장. 한 문장짜리 블록을 남발하지 않는다.
- 한 블록에 한 주제만 담는다. 여러 주제를 한 문단에 몰아넣지 않고 블록을 나눈다.
- head 는 6~14자. 그 아래 문단이 무슨 이야기인지 알 수 있게 쓴다.
  "개요", "특징", "결론" 처럼 아무 내용 없는 소제목은 쓰지 않는다.
- 원문 컨텍스트가 얇으면 블록 수를 줄인다. 5개를 채우려고 원문에 없는 내용을
  쓰거나, 같은 말을 다시 쓰거나, 일반론으로 분량을 늘리지 않는다.
  근거가 있는 3블록이 지어낸 8블록보다 낫다.`;

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

/**
 * 두 제공자 모두 이 스키마로 응답을 강제한다.
 *
 * body[].type 의 enum 과 위 TrendDraft 의 유니온은 types/db.ts 의 BlockType 에서
 * 파생시키지 않는다. BlockType 에는 작성 화면용 "table" 이 들어 있는데, 이걸
 * 여기로 끌어오면 LLM 이 rows 없는 table 블록을 낼 수 있다. 트렌드 저장 경로는
 * 블록 모양을 검사하지 않으므로(sync/trend.ts) 그대로 저장돼 빈 표로 렌더된다.
 * 트렌드 브리핑 본문은 의도적으로 표·서식 없이 text/head/quote 로만 쓴다.
 *
 * additionalProperties: false 가 모델이 align·rows 같은 필드를 임의로 만들어
 * 붙이는 것을 막아 준다. 지우지 말 것.
 */
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
          deck: {
            type: "string",
            description:
              "목록에 나가는 한 줄 요약. 한 문장, 60자 내외. 상세 설명은 body 로 넘긴다.",
          },
          body: {
            type: "array",
            description:
              "상세 본문. 5~8개 블록을 head(소제목)로 구획한다. 첫 블록은 소제목 없는 text, 마지막 블록은 한계 또는 사내 적용 관점. 원문 근거가 얇으면 블록 수를 줄인다.",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["text", "head", "quote"] },
                t: {
                  type: "string",
                  description:
                    "text 는 3~5문장, 한 블록에 한 주제. head 는 6~14자이며 아래 문단의 내용을 알 수 있게 쓴다.",
                },
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

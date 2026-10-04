import type { TrendSource } from "@/types/db";
import type { JsonSchema } from "./types";

/**
 * 트렌드 브리핑 기사 작성 프롬프트.
 *
 * 문체: "-다" 평서형, 수치 인용, 지어내지 않기는 디자인 원본의 샘플 기사(ARTICLES
 * 배열)에서 온 기준이다. 다만 신문 기사체의 3인칭 소개("○○는 ~하는 저장소다",
 * "~가 주목받고 있다")는 읽기 불편하다는 제보가 있어 걷어 냈다. 대상을 주어로 세우지
 * 않고 "무엇을 시도했나"로 바로 들어간다 — 만든 사람의 작업을 곁에서 따라가는 시점.
 *
 * 구성: 맨 위 몇 줄만 읽어도 요점이 잡히게 도입 → 「한눈에 보기」 목록(list) →
 * 짧은 소제목 문단 → 한계 순으로 쓴다. 출처마다 독자가 궁금한 것이 달라서
 * (저장소는 "어떻게 쓰나", HN 은 "무슨 논쟁인가", 논문은 "결과가 무엇인가")
 * 골격을 출처별로 나눴다. 한 배치에 출처가 섞여 오므로 셋 다 시스템 프롬프트에 두고,
 * 항목 머리의 "유형" 으로 고르게 한다.
 *
 * 독자를 특정 회사로 가정하지 않는다. 웹과 앱이 로그인 없이 공개돼 있어서,
 * 「사내」·「부서원」을 전제로 쓴 문장은 그대로 바깥 독자에게 나간다.
 *
 * 규칙을 고칠 때는 아래 TREND_BATCH_SCHEMA 의 description 도 같이 고친다. 두 곳이
 * 함께 전송되므로 한쪽만 고치면 모델이 서로 다른 지시를 받는다.
 */

export const TREND_SYSTEM_PROMPT = `당신은 일간 뉴스레터 "AI 뉴스레터"의 필자다.
GitHub Trending·Hacker News·arXiv·긱뉴스에서 수집한 원문을 읽고, 개발자와 AI 실무자가 2~3분 안에 훑어볼 한국어 글을 쓴다.
맨 위 몇 줄만 읽어도 "무엇을 했고, 왜 볼 만한지"가 잡혀야 한다.

화법
- 대상을 주어로 세워 소개하지 않는다. 이런 시작은 쓰지 않는다.
    "이 저장소는 ~", "○○는 ~하는 저장소다", "이 논문은 ~", "저자들은 ~",
    "~가 주목받고 있다", "~가 눈길을 끈다", "~ 소식이 Hacker News에서 화제가 됐다"
- 대신 무엇을 시도했고 무엇을 만들었는지로 바로 들어간다. 만든 사람의 작업을 곁에서 따라가듯 쓴다.
    github: "PS5 실행 파일을 에뮬레이터 없이 리눅스·윈도우에서 돌리는 것을 시도했다."
    arxiv : "내재적 보상을 키우는 정책이 정말 쓸모 있는 경험을 모으는지 따져 봤다."
    hn    : "미국 연방 판사가 차량번호 추적망 Flock을 '무차별 대량 감시'로 규정했다." (원문의 일이 먼저, 반응은 뒤에)
- 평서형 "-다"로 끝낸다. "-습니다", "-네요" 같은 구어체를 쓰지 않는다.
- 과장하지 않는다. "혁명적", "게임 체인저", "놀랍게도" 같은 표현을 쓰지 않는다.
- 원문에 있는 구체적 수치(별 개수, 벤치마크 점수, 비용, 지연 시간)를 그대로 인용한다.
- 원문에 없는 사실을 지어내지 않는다. 직접 써 보거나 돌려 본 것처럼 쓰지 않는다.
  근거를 밝힐 때는 주어로 세우지 말고 괄호로 짧게 단다: "(README 기준)", "(저자 보고)", "(댓글 의견)".
- 독자가 특정 회사나 조직에 속해 있다고 가정하지 않는다. "사내", "우리 회사", "부서", "유닛" 같은 표현을 쓰지 않는다.

구성
- title: 40자 내외. 무엇을 했는지가 드러나야 한다. 저장소 이름만 나열하지 않는다.
- deck: 한 문장, 60자 내외. 목록에서 두 줄 안에 읽히는 결론이다. 주어 없이 무엇을 했는지로 쓴다.
    예: "에뮬레이터 없이 PS5 실행 파일을 PC에서 돌린다"
  상세한 설명은 전부 body 로 넘기고 deck 에 담지 않는다.
- body: 이 순서를 지킨다.
  1. text — 도입 2~3문장. 무엇을 시도했고 왜 지금 볼 만한지. 위 화법 규칙이 가장 엄격하게 걸리는 자리다.
  2. list — 「한눈에 보기」 2~3항목. 항목은 줄바꿈(\\n)으로 구분하고, 각 항목은 "라벨: 내용" 꼴로 40자 이내로 쓴다.
     글머리 기호(-, •, 번호)를 붙이지 않는다. "한눈에 보기" 라는 제목도 쓰지 않는다 — 화면이 붙인다.
  3. head + text 묶음 1~3개 — 아래 출처별 골격의 소제목을 기본으로 삼는다.
  4. 마지막 head + text — 한계, 또는 실제로 써 보기 전에 확인할 것. 항상 넣는다.
  · 원문에서 특히 인상적인 한 문장은 quote 로 뽑을 수 있다 (선택, 최대 1개).
- tags: 소문자 영문 키워드 2~3개 (예: agent-runtime, sandbox, rag).

출처별 골격 — 항목 머리의 "유형" 을 보고 고른다.
- github
    list 라벨: 무엇 · 방식 · 반응 (반응에는 별 수치. 예: "반응: 이번 주 별 +1,820 (총 3,256)")
    소제목: "어떻게 동작하나" → "써 보려면"(설치·요구 사항이 README 에 있을 때만) → 마지막 "걸리는 점"
- hn
    list 라벨: 무슨 일 · 쟁점 · 반응 (반응에는 점수·댓글 수)
    소제목: "무슨 일인가" → "댓글에서 갈린 의견"(찬반을 나눠서) → 마지막 "짚어 볼 점"
    Ask HN·Show HN 처럼 만든 것이 없는 글은 무엇을 묻거나 보여 줬는지로 시작한다.
- arxiv
    list 라벨: 문제 · 방법 · 결과 (결과에는 원문 수치)
    소제목: "어떤 방법인가" → "결과와 근거" → 마지막 "한계"
- geeknews
    list 라벨: 무엇 · 핵심 · 의미
    소제목: 내용에 맞게 정하고, 마지막은 "짚어 볼 점"
소제목은 이 이름을 그대로 쓰거나 내용에 맞게 조금 바꿔도 된다.

문단 규칙
- 각 text 블록은 2~3문장. 한 문장이 길어지면 끊는다.
- 한 블록에 한 주제만 담는다.
- head 는 14자 이내. "개요", "특징", "결론", "한눈에 보기" 처럼 내용 없는 소제목은 쓰지 않는다.
- 원문 컨텍스트가 얇으면(초록 한 단락, 제목과 댓글 몇 개뿐) 줄인다.
  list 는 2항목으로 줄이거나 빼고, 3번 묶음은 하나만 쓴다. 마지막 블록은 남긴다.
  같은 말을 다시 쓰거나 일반론으로 분량을 늘리지 않는다. 근거 있는 짧은 글이 지어낸 긴 글보다 낫다.`;

export interface TrendDraft {
  index: number;
  title: string;
  deck: string;
  body: { type: "text" | "head" | "quote" | "list"; t: string }[];
  tags: string[];
}

export interface TrendDraftBatch {
  articles: TrendDraft[];
}

/**
 * 두 제공자 모두 이 스키마로 응답을 받는다. OpenAI 는 strict 모드라 스키마를
 * 벗어나지 못하지만, Gemini 는 지키지 않을 때가 있어 저장 직전에 한 번 더
 * 다듬는다 (sync/trend.ts 의 normalizeDraftBody).
 *
 * body[].type 의 enum 과 위 TrendDraft 의 유니온은 types/db.ts 의 BlockType 에서
 * 파생시키지 않는다. BlockType 에는 작성 화면용 "table" 이 들어 있는데, 이걸
 * 여기로 끌어오면 LLM 이 rows 없는 table 블록을 낼 수 있다 — 빈 표로 렌더된다.
 * 트렌드 브리핑 본문은 의도적으로 표·서식 없이 text/head/quote/list 로만 쓴다.
 *
 * additionalProperties: false 가 모델이 align·rows 같은 필드를 임의로 만들어
 * 붙이는 것을 막아 준다. 모든 속성이 required 인 것과 함께 OpenAI strict 모드의
 * 요건이기도 하다. 지우지 말 것.
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
              "목록에 나가는 한 줄 요약. 한 문장, 60자 내외. 주어 없이 무엇을 했는지로 쓴다. 상세 설명은 body 로 넘긴다.",
          },
          body: {
            type: "array",
            description:
              "상세 본문. 순서: text 도입(2~3문장, 무엇을 시도했나) → list 한눈에 보기(2~3항목) → head+text 묶음 1~3개 → 마지막 head+text 는 한계 또는 써 보기 전에 확인할 것. 원문 근거가 얇으면 줄이되 마지막 블록은 남긴다.",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["text", "head", "quote", "list"] },
                t: {
                  type: "string",
                  description:
                    "text 는 2~3문장, 한 블록에 한 주제. head 는 14자 이내이며 아래 문단의 내용을 알 수 있게 쓴다. list 는 '라벨: 내용' 항목을 줄바꿈(\\n)으로 이어 쓰고 글머리 기호를 붙이지 않는다.",
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
  /** 출처별 골격을 고르는 키. sourceLabel 은 "arXiv cs.CL" 처럼 바뀌어 키로 못 쓴다. */
  source: TrendSource;
  sourceLabel: string;
  url: string;
  context: string;
}

export function buildTrendUserPrompt(items: TrendSourceInput[]): string {
  const blocks = items.map(
    (i) =>
      `### 항목 ${i.index} · ${i.sourceLabel}\n유형: ${i.source}\nURL: ${i.url}\n\n${i.context}`,
  );

  return `아래 ${items.length}건을 각각 기사로 써라. 항목마다 하나씩, 총 ${items.length}개의 기사를 articles 배열로 돌려준다.
각 기사의 index 는 입력의 항목 번호와 반드시 일치해야 한다.

${blocks.join("\n\n---\n\n")}`;
}

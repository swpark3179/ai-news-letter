import {
  crawlHadaList,
  type CrawlOptions,
  type CrawlResult,
  type HadaListItem,
} from "./geeknews";

/**
 * news.hada.io/show — 쇼케이스.
 *
 * 메인 목록이 "읽을 거리"를 모으는 곳이라면 /show 는 **사람들이 직접 만든 것을
 * 소개하는** 게시판이다. 성격이 달라 저장 테이블(showcase_items)도 분리한다.
 *
 * 마크업은 메인과 같은 div.topic_row 템플릿이라 파서를 새로 쓰지 않는다.
 * 경로만 갈아 끼워 sources/geeknews.ts 의 crawlHadaList 를 그대로 쓴다.
 *
 * 메인과 다르게 잡는 것 두 가지
 *
 *   1. requireSummary: false
 *      소개문 없이 만든 것 링크만 올리는 글이 있다. 메인 기준(요약 없으면 버림)을
 *      그대로 적용하면 그런 글이 조용히 사라진다.
 *
 *   2. failOnEmptyFirstPage: true
 *      새로 붙이는 수집기라 셀렉터가 맞는지 아직 실측되지 않았다. 1페이지에서
 *      한 건도 못 뽑으면 "오늘 새 글이 없다"가 아니라 파싱이 깨진 것이므로
 *      성공으로 넘기지 않고 실패로 드러낸다.
 *
 * Atom 피드 보강은 하지 않는다 — hada.io 가 공식 제공하는 피드는 /rss/news 와
 * /rss/blog 뿐이고 /show 용 공식 피드가 없다. 같은 이름의 3rd-party 미러가
 * 있지만, 원본이 아닌 곳에 수집을 의존하지 않는다.
 */

export const SHOW_LIST_PATH = "/show";

/** 쇼케이스 항목 — 목록 행 구조가 같아 필드도 같다. */
export type ShowcaseItem = HadaListItem;

export async function crawlHadaShow(opts: CrawlOptions): Promise<CrawlResult> {
  return crawlHadaList({
    ...opts,
    listPath: SHOW_LIST_PATH,
    requireSummary: false,
    failOnEmptyFirstPage: true,
  });
}

import type { Block, TrendSource } from "@/types/db";

/**
 * 앱과 웹이 함께 읽는 Supabase 뷰의 행 모양.
 *
 * 정의는 supabase/migrations/0013 · 0016 · 0017 · 0019 에 있고, 열 이름을 그대로 쓴다.
 * 웹은 표(geek_news · trend_items · showcase_items)를 직접 읽지 않는다 — 무엇이 보이는지
 * (숨긴 글 · 미공개 트렌드)와 목록의 지표 문구(meta)는 뷰 정의가 정한다.
 */

export type FeedType = "geek" | "trend" | "show";

/**
 * mobile_feed · mobile_showcase 의 한 행.
 *
 * 쇼케이스 뷰에는 source · repo · public_id · source_variant · origin_url 이 없어
 * null 로 채우고, 반대로 maker 는 쇼케이스에만 있다.
 */
export interface FeedItem {
  type: FeedType;
  /** 긱뉴스 · 쇼케이스는 토픽 URL, 트렌드는 원문 URL. 상세를 찾는 키다. */
  key: string;
  source: TrendSource | null;
  /** GitHub 행의 owner/repo — 제목 자리에 온다 */
  repo: string | null;
  title: string;
  /** 긱뉴스는 요약, 트렌드는 deck. 쇼케이스는 빈 문자열일 수 있다. */
  lede: string;
  /** 지표 문구 — "★ 711 this week · Python" · "github.com · 3 points · 댓글 1" */
  meta: string;
  /** 긱뉴스 · 쇼케이스는 원문 게시 시각, 트렌드는 수집 시각 */
  published_at: string;
  /** 긱뉴스는 토픽(토론) 페이지, 트렌드는 원문, 쇼케이스는 만든 것의 주소 */
  open_url: string;
  host: string;
  public_id: string | null;
  source_variant: string | null;
  /** 수집한 날 (KST, YYYY-MM-DD) */
  collected_date: string;
  /** 같은 날 안에서의 순서 — points 또는 기간 별. arXiv 는 null */
  score: number | null;
  /** 「원문」 링크 — 긱뉴스가 소개한 글, HN 스레드가 가리키는 글 */
  origin_url: string | null;
  /** 쇼케이스의 만든 사람 */
  maker: string | null;
}

/** mobile_trend_detail 의 한 행 */
export interface TrendDetail {
  key: string;
  source: TrendSource;
  public_id: string;
  repo: string | null;
  source_variant: string | null;
  title: string;
  deck: string;
  raw_title: string;
  host: string;
  collected_at: string;
  collected_date: string;
  llm_model: string | null;
  body: Block[];
  tags: string[];
  origin_url: string | null;
}

/** mobile_issue — 항상 한 행. 건수는 오늘(KST) 수집분이고 숨긴 글은 세지 않는다. */
export interface IssueRow {
  issue_no: number;
  date: string;
  geek_count: number;
  trend_count: number;
}

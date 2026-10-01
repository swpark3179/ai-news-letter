/**
 * Supabase 테이블에 대응하는 행 타입.
 * supabase/migrations/*.sql 과 손으로 맞춰 둔다 (gen types 도입 시 대체 가능).
 */

// ---------------------------------------------------------------------------
// 공통
// ---------------------------------------------------------------------------

/**
 * 기사 본문 블록. trend_items.body 의 구조.
 *
 * 트렌드 브리핑을 쓰는 LLM 은 text/head/quote 만 낸다 (llm/prompts.ts 참고).
 * "table" 과 서식 속성(align/size/color)은 예전 기사 작성 화면이 쓰던 것인데,
 * jsonb 라 무엇이든 들어올 수 있으므로 읽는 쪽은 table 을 만나도 죽지 않게 쓴다.
 *
 * 서식 값은 전부 열거형이다. 자유 문자열을 받아 style 로 흘리지 않는다 —
 * 색상·크기는 CSS 모듈 클래스로만 매핑된다(components/article/blocks.module.css).
 */
export type BlockType = "text" | "head" | "quote" | "table";
export type BlockAlign = "left" | "center" | "right";
export type BlockSize = "sm" | "md" | "lg";
export type BlockColor =
  | "default"
  | "purple"
  | "blue"
  | "green"
  | "red"
  | "yellow"
  | "gray";

export interface Block {
  type: BlockType;
  /** table 이면 표 설명(캡션). 비어 있어도 된다. */
  t: string;
  /** 이하 전부 optional — 서식 없이 발행된 기존 행이 그대로 렌더돼야 한다. */
  align?: BlockAlign;
  size?: BlockSize;
  color?: BlockColor;
  /** table 전용. rows[0] 을 머리행으로 쓴다. */
  rows?: string[][];
}

export type SectionKey = "geek" | "trend";
export type SourceKind = "gh" | "hn" | "ax" | "gk";
export type TrendSource = "github" | "hn" | "arxiv" | "geeknews";
export type LlmProviderName = "gemini" | "openai";
/** 수집 파이프라인 종류 — sync_runs.kind 의 CHECK 제약과 같은 값을 유지한다. */
export type SyncRunKind = "geeknews" | "trend" | "showcase";

// ---------------------------------------------------------------------------
// 테이블 행
// ---------------------------------------------------------------------------

export interface AppSettingRow {
  key: string;
  value: unknown;
  updated_at: string;
}

export interface GeekNewsRow {
  /** PK — 요약부 링크(https://news.hada.io/topic?id=NNNNN 또는 /article/<slug>) */
  url: string;
  title: string;
  summary: string;
  published_at: string;
  external_url: string | null;
  source_domain: string | null;
  points: number;
  comment_count: number;
  submitter: string | null;
  is_hidden: boolean;
  collected_at: string;
  collected_date: string;
}

/**
 * 쇼케이스 — news.hada.io/show 수집분.
 *
 * 목록 행 구조가 긱뉴스와 같아 열도 같지만, 성격이 달라 테이블을 나눴다
 * (뉴스 큐레이션 vs. 직접 만든 것). summary 는 소개문 없이 올라오는 글이 있어
 * 빈 문자열일 수 있다 — GeekNewsRow.summary 와 다른 점이다.
 */
export interface ShowcaseItemRow {
  /** PK — 요약부 링크(https://news.hada.io/topic?id=NNNNN) */
  url: string;
  title: string;
  /** 소개문. 없는 글이 있어 빈 문자열일 수 있다. */
  summary: string;
  published_at: string;
  /** 만든 것의 실제 주소 */
  external_url: string | null;
  source_domain: string | null;
  points: number;
  comment_count: number;
  /** 만든 사람 */
  submitter: string | null;
  is_hidden: boolean;
  collected_at: string;
  collected_date: string;
}

/** 본문을 어느 목록에서 가져왔는지. hada_contents.source 와 같은 값. */
export type HadaSourceKind = "geeknews" | "showcase";

/**
 * 본문 수집 결과.
 *   ok           본문을 얻었다
 *   empty        컨테이너는 찾았는데 본문이 사실상 비어 있다
 *   parse_failed 본문 컨테이너를 못 찾았다 (마크업 변경 의심)
 *   fetch_failed HTTP 실패 / 타임아웃
 */
export type HadaContentStatus = "ok" | "empty" | "parse_failed" | "fetch_failed";

/**
 * 긱뉴스 / 쇼케이스 상세 페이지 본문.
 *
 * geek_news / showcase_items 와 PK(url)가 같다. 목록 테이블을 얇게 두려고
 * 분리했다 — 목록 조회가 select('*') 라, 본문을 그쪽에 넣으면 목록 한 번
 * 그릴 때마다 본문을 통째로 끌어오게 된다.
 */
export interface HadaContentRow {
  /** PK — geek_news.url / showcase_items.url 과 같은 값 */
  url: string;
  source: HadaSourceKind;
  /** "함께 보면 좋은 글" 직전까지의 본문 (마크다운). 요약이 아니라 원문 그대로다. */
  body_md: string;
  body_chars: number;
  truncated: boolean;
  status: HadaContentStatus;
  /** 본문을 뽑아낸 CSS 셀렉터 — 마크업 드리프트 추적용 */
  container: string | null;
  attempts: number;
  last_error: string | null;
  content_hash: string | null;
  fetched_at: string;
  updated_at: string;
}

export interface TrendMetrics {
  stars?: number;
  stars_in_period?: number;
  language?: string | null;
  points?: number;
  comments?: number;
  arxiv_id?: string;
  authors?: string[];
  hn_external_url?: string;
  [k: string]: unknown;
}

export interface TrendItemRow {
  /** PK — 원본 URL */
  source_url: string;
  /** source_url 에서 파생된 라우팅용 짧은 식별자 (generated column) */
  public_id: string;
  source: TrendSource;
  source_variant: string | null;
  raw_title: string | null;
  raw_excerpt: string | null;
  metrics: TrendMetrics;
  title: string;
  deck: string | null;
  body: Block[];
  tags: string[];
  llm_provider: LlmProviderName | null;
  llm_model: string | null;
  status: "published" | "review" | "hidden";
  view_count: number;
  collected_at: string;
  collected_date: string;
}

export interface SyncLogEntry {
  at: string;
  level: "info" | "warn" | "error" | "done";
  msg: string;
}

export interface SyncRunRow {
  id: string;
  kind: SyncRunKind;
  provider: LlmProviderName | null;
  trigger: "schedule" | "manual" | "admin_ui";
  status: "running" | "success" | "failed";
  started_at: string;
  finished_at: string | null;
  fetched_count: number;
  new_count: number;
  inserted_count: number;
  skipped_count: number;
  logs: SyncLogEntry[];
  error: string | null;
}

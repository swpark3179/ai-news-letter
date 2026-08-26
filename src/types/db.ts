/**
 * Supabase 테이블에 대응하는 행 타입.
 * supabase/migrations/*.sql 과 손으로 맞춰 둔다 (gen types 도입 시 대체 가능).
 */

// ---------------------------------------------------------------------------
// 공통
// ---------------------------------------------------------------------------

/**
 * 기사 본문 블록. trend_items.body / articles.body 공통 구조.
 *
 * "table" 과 서식 속성(align/size/color)은 작성 화면에서 사람이 쓰는 것이고,
 * 트렌드 브리핑을 쓰는 LLM 은 text/head/quote 만 낸다 (llm/prompts.ts 참고).
 * 두 테이블이 같은 타입을 공유하므로 trend_items.body 도 타입상으로는 table 을
 * 담을 수 있다 — 읽는 쪽은 그래서 table 을 만나도 죽지 않게 써야 한다.
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

export type MemberRole = "unit_lead" | "member" | "subscriber";
export type AvatarTone = "purple" | "blue" | "green" | "yellow" | "gray";
export type SectionKey = "geek" | "trend" | "review" | "deep";
/** 유닛원이 직접 쓰는 두 카테고리. */
export type WritableSection = "review" | "deep";
export type SourceKind = "gh" | "hn" | "ax" | "gk";
export type TrendSource = "github" | "hn" | "arxiv" | "geeknews";
export type LlmProviderName = "gemini" | "openai";
/** 보관함에 담을 수 있는 대상 종류. target_key 는 종류에 따라 UUID 또는 URL 이다. */
export type ScrapTargetType = "article" | "trend" | "geek";

// ---------------------------------------------------------------------------
// 테이블 행
// ---------------------------------------------------------------------------

export interface MemberRow {
  id: string;
  emp_no: string;
  /** 사내 SSO(Knox) 사원 식별자. 사번과는 다른 별도 ID. 0012_member_epid.sql */
  epid: string | null;
  name: string;
  email: string | null;
  dept: string | null;
  role: MemberRole;
  is_admin: boolean;
  initial: string | null;
  avatar_tone: AvatarTone;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

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

export interface ArticleRow {
  id: string;
  slug: string | null;
  section: WritableSection;
  title: string;
  deck: string | null;
  body: Block[];
  tags: string[];
  repo_label: string | null;
  author_id: string | null;
  status: "draft" | "review" | "published";
  published_at: string | null;
  issue_no: number | null;
  talk_date: string | null;
  talk_room: string | null;
  photo_path: string | null;
  read_minutes: number | null;
  view_count: number;
  created_at: string;
  updated_at: string;
}

export interface ArticleSourceRow {
  id: number;
  article_id: string;
  kind: SourceKind;
  label: string | null;
  url: string;
  seq: number;
}

export interface CommentRow {
  id: string;
  article_id: string;
  member_id: string | null;
  author_name: string;
  role_tag: string;
  body: string;
  is_deleted: boolean;
  created_at: string;
}

export interface ScrapRow {
  member_id: string;
  target_type: ScrapTargetType;
  /** article 이면 articles.id, trend 면 trend_items.source_url, geek 이면 geek_news.url */
  target_key: string;
  created_at: string;
}

export interface MeetingRow {
  id: string;
  week_label: string;
  met_at: string;
  room: string | null;
  topics: string[];
  presenter_id: string | null;
  talk_title: string | null;
  article_id: string | null;
  qa_count: number;
  photo_path: string | null;
  created_at: string;
}

export interface RotationRow {
  id: string;
  kind: "deep" | "weekly";
  member_id: string;
  period_label: string;
  period_start: string;
  topic: string | null;
  status: "planned" | "preparing" | "reviewing" | "done";
  created_at: string;
}

export interface SyncLogEntry {
  at: string;
  level: "info" | "warn" | "error" | "done";
  msg: string;
}

export interface SyncRunRow {
  id: string;
  kind: "geeknews" | "trend";
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

export interface AttachmentRow {
  id: string;
  article_id: string | null;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  chunk_size_bytes: number;
  chunk_count: number;
  received_chunks: number;
  status: "pending" | "uploading" | "assembling" | "stored" | "failed";
  storage_path: string | null;
  uploaded_by: string | null;
  error: string | null;
  /** 업로드 진행 중에만 존재하는 임시 AES 키 (완료 시 null) */
  encryption_key?: string | null;
  created_at: string;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// 모바일 소셜 로그인 (0010_google_identities.sql · 0011_apple_identities.sql)
// ---------------------------------------------------------------------------

/** 모바일 앱이 쓰는 소셜 로그인 수단. 표 이름과 열 이름이 이 값으로 갈린다. */
export type SocialProvider = "google" | "apple";

export interface MemberGoogleIdentityRow {
  /** OpenID Connect sub. 이메일이 바뀌어도 유지되는 불변 식별자 */
  google_sub: string;
  member_id: string;
  google_email: string;
  email_verified: boolean;
  /** Workspace 도메인(hd 클레임). 개인 Gmail 은 null */
  hosted_domain: string | null;
  display_name: string | null;
  picture_url: string | null;
  linked_at: string;
  last_login_at: string | null;
}

export interface MemberAppleIdentityRow {
  /** Apple ID 토큰의 sub. 개발자 팀 단위로 고유하다 */
  apple_sub: string;
  member_id: string;
  /** 「이메일 가리기」면 릴레이 주소이고, 재로그인 때 빠져 올 수도 있다 */
  apple_email: string | null;
  email_verified: boolean;
  is_private_email: boolean;
  /** Apple 이 최초 인증에서 한 번만 주는 이름 */
  display_name: string | null;
  linked_at: string;
  last_login_at: string | null;
}

export interface MemberRefreshTokenRow {
  id: string;
  member_id: string;
  /** 원문이 아니라 sha256 해시 */
  token_hash: string;
  device_label: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

// ---------------------------------------------------------------------------
// 조인 결과 (화면에서 쓰는 형태)
// ---------------------------------------------------------------------------

export interface ArticleWithAuthor extends ArticleRow {
  author: Pick<MemberRow, "id" | "name" | "role" | "initial" | "avatar_tone"> | null;
}

export interface ArticleFull extends ArticleWithAuthor {
  sources: ArticleSourceRow[];
  comments: CommentRow[];
}

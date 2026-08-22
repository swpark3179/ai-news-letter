/**
 * Supabase 테이블에 대응하는 행 타입.
 * supabase/migrations/*.sql 과 손으로 맞춰 둔다 (gen types 도입 시 대체 가능).
 */

// ---------------------------------------------------------------------------
// 공통
// ---------------------------------------------------------------------------

/** 기사 본문 블록. trend_items.body / articles.body 공통 구조. */
export type BlockType = "text" | "head" | "quote";

export interface Block {
  type: BlockType;
  t: string;
}

export type MemberRole = "unit_lead" | "member" | "subscriber";
export type AvatarTone = "purple" | "blue" | "green" | "yellow" | "gray";
export type SectionKey = "geek" | "trend" | "review" | "deep";
/** 유닛원이 직접 쓰는 두 카테고리. */
export type WritableSection = "review" | "deep";
export type SourceKind = "gh" | "hn" | "ax" | "gk";
export type TrendSource = "github" | "hn" | "arxiv" | "geeknews";
export type LlmProviderName = "gemini" | "openai";

// ---------------------------------------------------------------------------
// 테이블 행
// ---------------------------------------------------------------------------

export interface MemberRow {
  id: string;
  emp_no: string;
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
// 조인 결과 (화면에서 쓰는 형태)
// ---------------------------------------------------------------------------

export interface ArticleWithAuthor extends ArticleRow {
  author: Pick<MemberRow, "id" | "name" | "role" | "initial" | "avatar_tone"> | null;
}

export interface ArticleFull extends ArticleWithAuthor {
  sources: ArticleSourceRow[];
  comments: CommentRow[];
}

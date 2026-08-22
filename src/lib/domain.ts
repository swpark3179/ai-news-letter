import type {
  AvatarTone,
  MemberRole,
  SectionKey,
  SourceKind,
  TrendSource,
} from "@/types/db";

/**
 * 디자인 원본(AI 뉴스레터.dc.html)의 SECTIONS / SRC / AV 상수를 옮긴 것.
 * 화면 여러 곳에서 같은 라벨과 색을 써야 하므로 한 곳에 모은다.
 */

// ---------------------------------------------------------------------------
// 카테고리 (원본 1371~1376행)
// ---------------------------------------------------------------------------

export interface SectionDef {
  key: SectionKey;
  ko: string;
  en: string;
  note: string;
  /** 자동 수집 카테고리인지 — 관리자 글 작성 화면에서 선택 불가 */
  automated: boolean;
}

export const SECTIONS: readonly SectionDef[] = [
  {
    key: "geek",
    ko: "긱뉴스 데일리",
    en: "GeekNews Daily",
    note: "매일 07:00 자동 수집 · 원문 링크로 바로 이동",
    automated: true,
  },
  {
    key: "trend",
    ko: "트렌드 브리핑",
    en: "Trend Briefing",
    note: "GitHub Trending · Hacker News · arXiv 를 AI가 한국어로 요약",
    automated: true,
  },
  {
    key: "review",
    ko: "위클리 리뷰",
    en: "Weekly Review",
    note: "유닛원이 매주 한 주제를 골라 직접 읽고 쓴 글",
    automated: false,
  },
  {
    key: "deep",
    ko: "심층 분석",
    en: "Deep Dive",
    note: "월 1회 정기 발표 · 발표 자료와 현장 사진 포함",
    automated: false,
  },
] as const;

export const SECTION_MAP: Record<SectionKey, SectionDef> = Object.fromEntries(
  SECTIONS.map((s) => [s.key, s]),
) as Record<SectionKey, SectionDef>;

export function isSectionKey(v: string): v is SectionKey {
  return SECTIONS.some((s) => s.key === v);
}

// ---------------------------------------------------------------------------
// 출처 배지 (원본 1378~1383행)
// ---------------------------------------------------------------------------

export interface SourceStyle {
  tag: string;
  bg: string;
  fg: string;
  label: string;
}

export const SRC: Record<SourceKind, SourceStyle> = {
  gh: {
    tag: "GITHUB",
    bg: "var(--gray-100)",
    fg: "var(--gray-800)",
    label: "GitHub Trending",
  },
  hn: {
    tag: "HN",
    bg: "var(--yellow-50)",
    fg: "var(--yellow-800)",
    label: "Hacker News",
  },
  ax: {
    tag: "ARXIV",
    bg: "var(--red-50)",
    fg: "var(--red-700)",
    label: "arXiv",
  },
  gk: {
    tag: "GEEKNEWS",
    bg: "var(--blue-50)",
    fg: "var(--blue-800)",
    label: "긱뉴스",
  },
};

/** trend_items.source(DB 값) → 배지 키 */
export const TREND_SOURCE_TO_KIND: Record<TrendSource, SourceKind> = {
  github: "gh",
  hn: "hn",
  arxiv: "ax",
  geeknews: "gk",
};

export function sourceStyleOf(source: TrendSource): SourceStyle {
  return SRC[TREND_SOURCE_TO_KIND[source]];
}

/** 1면 "오늘 요약된 게시물" 3열 그룹 순서 */
export const TREND_GROUPS: readonly TrendSource[] = ["github", "hn", "arxiv"];

// ---------------------------------------------------------------------------
// 아바타 (원본 1364~1369행)
// ---------------------------------------------------------------------------

export interface AvatarStyle {
  bg: string;
  fg: string;
}

export const AVATAR_TONES: Record<AvatarTone, AvatarStyle> = {
  purple: { bg: "var(--purple-50)", fg: "var(--purple-700)" },
  blue: { bg: "var(--blue-50)", fg: "var(--blue-700)" },
  green: { bg: "var(--green-50)", fg: "var(--green-700)" },
  yellow: { bg: "var(--yellow-50)", fg: "var(--yellow-700)" },
  gray: { bg: "var(--gray-100)", fg: "var(--gray-700)" },
};

export function avatarOf(person: {
  name: string;
  initial?: string | null;
  avatar_tone?: AvatarTone | null;
}): AvatarStyle & { init: string } {
  const tone = AVATAR_TONES[person.avatar_tone ?? "gray"] ?? AVATAR_TONES.gray;
  return { ...tone, init: person.initial || person.name.slice(-2) };
}

export const ROLE_LABEL: Record<MemberRole, string> = {
  unit_lead: "Unit 장",
  member: "유닛원",
  subscriber: "구독자",
};

// ---------------------------------------------------------------------------
// 헤더 내비게이션 (원본 1898~1905행) — 모바일 항목은 제외
// ---------------------------------------------------------------------------

export interface NavItem {
  label: string;
  href: string;
  /** 활성 판정에 쓰는 경로 접두사 */
  match: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "1면", href: "/", match: "/" },
  { label: "긱뉴스", href: "/sections/geek", match: "/sections/geek" },
  { label: "트렌드 브리핑", href: "/sections/trend", match: "/sections/trend" },
  { label: "위클리 리뷰", href: "/sections/review", match: "/sections/review" },
  { label: "심층 분석", href: "/sections/deep", match: "/sections/deep" },
  { label: "아카이브", href: "/meetings", match: "/meetings" },
] as const;

// ---------------------------------------------------------------------------
// 관리자 LNB (원본 2158~2163행)
// ---------------------------------------------------------------------------

export const ADMIN_NAV: readonly NavItem[] = [
  { label: "대시보드", href: "/admin", match: "/admin" },
  { label: "수집 파이프라인", href: "/admin#pipeline", match: "/admin#pipeline" },
  { label: "보관 통계", href: "/admin/scraps", match: "/admin/scraps" },
  { label: "업로드 이력", href: "/admin/uploads", match: "/admin/uploads" },
  { label: "유닛 멤버", href: "/admin/members", match: "/admin/members" },
] as const;

// ---------------------------------------------------------------------------
// 발행 정책
// ---------------------------------------------------------------------------

/** 사내 1회 전송 한도. 초과분은 분할 암호화 업로드로 처리한다. */
export const MAX_SINGLE_TRANSFER_BYTES = 10 * 1024 * 1024;
/** 기본 조각 크기 (디자인 기본값 4MB) */
export const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;

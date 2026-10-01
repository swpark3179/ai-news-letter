import type { SectionKey, SourceKind, TrendSource } from "@/types/db";

/**
 * 디자인 원본(AI 뉴스레터.dc.html)의 SECTIONS / SRC 상수를 옮긴 것.
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
}

export const SECTIONS: readonly SectionDef[] = [
  {
    key: "geek",
    ko: "긱뉴스 데일리",
    en: "GeekNews Daily",
    note: "매일 07:00 자동 수집 · 원문 링크로 바로 이동",
  },
  {
    key: "trend",
    ko: "트렌드 브리핑",
    en: "Trend Briefing",
    note: "GitHub Trending · Hacker News · arXiv 를 AI가 한국어로 요약",
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
] as const;

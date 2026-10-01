import type { CategoryKey, SourceKind, TrendSource } from "@/types/db";

/**
 * 디자인 원본(AI 뉴스레터.dc.html)의 SECTIONS / SRC 상수를 옮긴 것.
 * 화면 여러 곳에서 같은 라벨과 색을 써야 하므로 한 곳에 모은다.
 */

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
  sh: {
    tag: "SHOW",
    bg: "var(--green-50)",
    fg: "var(--green-700)",
    label: "쇼케이스",
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

// ---------------------------------------------------------------------------
// 카테고리 — 앱의 탭 · 칩과 같은 다섯 갈래
// ---------------------------------------------------------------------------

export interface CategoryDef {
  key: CategoryKey;
  ko: string;
  en: string;
  note: string;
  badge: SourceStyle;
  /** 트렌드 카테고리면 trend_items.source 값, 긱뉴스 · 쇼케이스는 null */
  trendSource: TrendSource | null;
}

export const CATEGORIES: readonly CategoryDef[] = [
  {
    key: "geek",
    ko: "긱뉴스",
    en: "GeekNews",
    note: "news.hada.io 에 올라온 글 — 매일 07:00 수집, 본문까지 이 사이트에서 읽는다",
    badge: SRC.gk,
    trendSource: null,
  },
  {
    key: "show",
    ko: "쇼케이스",
    en: "Show GN",
    note: "news.hada.io/show — 직접 만든 것을 소개하는 글",
    badge: SRC.sh,
    trendSource: null,
  },
  {
    key: "github",
    ko: "GitHub",
    en: "GitHub Trending",
    note: "GitHub Trending 저장소를 AI 가 한국어로 요약",
    badge: SRC.gh,
    trendSource: "github",
  },
  {
    key: "hn",
    ko: "Hacker News",
    en: "Hacker News",
    note: "Hacker News 상위 글을 AI 가 한국어로 요약",
    badge: SRC.hn,
    trendSource: "hn",
  },
  {
    key: "arxiv",
    ko: "arXiv",
    en: "arXiv",
    note: "arXiv 새 논문을 AI 가 한국어로 요약",
    badge: SRC.ax,
    trendSource: "arxiv",
  },
] as const;

export const CATEGORY_MAP: Record<CategoryKey, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c]),
) as Record<CategoryKey, CategoryDef>;

export function isCategoryKey(v: string): v is CategoryKey {
  return CATEGORIES.some((c) => c.key === v);
}

/** 트렌드 항목이 속한 카테고리. trend_items.source 가 geeknews 인 행은 긱뉴스로 보낸다. */
export function categoryOfTrend(source: TrendSource): CategoryKey {
  return source === "geeknews" ? "geek" : source;
}

/** 1면 3열에 세우는 트렌드 카테고리 순서 */
export const TREND_CATEGORIES = ["github", "hn", "arxiv"] as const satisfies readonly CategoryKey[];

// ---------------------------------------------------------------------------
// 헤더 내비게이션 (원본 1898~1905행)
// ---------------------------------------------------------------------------

export interface NavItem {
  label: string;
  href: string;
  /** 활성 판정에 쓰는 경로 접두사들 — 목록과 그 상세가 같은 탭에 불이 들어온다 */
  match: readonly string[];
}

export const NAV_ITEMS: readonly NavItem[] = [
  { label: "1면", href: "/", match: ["/"] },
  { label: "긱뉴스", href: "/sections/geek", match: ["/sections/geek", "/articles/geek"] },
  { label: "쇼케이스", href: "/sections/show", match: ["/sections/show", "/articles/show"] },
  { label: "GitHub", href: "/sections/github", match: ["/sections/github"] },
  { label: "Hacker News", href: "/sections/hn", match: ["/sections/hn"] },
  { label: "arXiv", href: "/sections/arxiv", match: ["/sections/arxiv"] },
] as const;

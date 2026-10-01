import { categoryOfTrend } from "@/lib/domain";
import type { CategoryKey, TrendSource } from "@/types/db";
import type { FeedItem } from "@/types/feed";

/**
 * 링크 경로를 한 곳에서 만든다.
 *
 * 트렌드 브리핑 항목의 PK 는 원본 URL 이라 주소에 그대로 넣을 수 없다.
 * DB 의 generated column public_id(= md5(source_url) 앞 12자)를 쓴다.
 *
 * 긱뉴스 · 쇼케이스의 키는 news.hada.io 의 토픽 URL 이다. 모양이 둘뿐이라
 * 경로로 되돌릴 수 있게 옮긴다 (hadaPath · hadaKeyFrom).
 *   https://news.hada.io/topic?id=34575        → /articles/geek/34575
 *   https://news.hada.io/article/code-outruns   → /articles/geek/article/code-outruns
 */

export type HadaKind = "geek" | "show";

const HADA_TOPIC = /^https:\/\/news\.hada\.io\/topic\?id=(\d+)$/;
const HADA_ARTICLE = /^https:\/\/news\.hada\.io\/article\/([A-Za-z0-9-]+)$/;

export interface CategoryQuery {
  /** 이 날(포함)까지 7일치 */
  until?: string;
  q?: string;
}

export const routes = {
  home: "/",

  category(key: CategoryKey, opts: CategoryQuery = {}): string {
    const params = new URLSearchParams();
    if (opts.q) params.set("q", opts.q);
    if (opts.until) params.set("until", opts.until);
    const qs = params.toString();
    return qs ? `/sections/${key}?${qs}` : `/sections/${key}`;
  },

  search(q?: string): string {
    return q ? `/search?${new URLSearchParams({ q })}` : "/search";
  },

  /** 트렌드 행은 public_id 가 항상 있다 (generated column). 없으면 그 출처 목록으로 보낸다. */
  trend(item: { public_id: string | null; source: TrendSource | null }): string {
    if (item.public_id) return `/articles/trend/${item.public_id}`;
    return routes.category(item.source ? categoryOfTrend(item.source) : "github");
  },

  /** 긱뉴스 · 쇼케이스 상세. 모르는 모양의 키면 null — 그때는 원문 링크만 건다. */
  hada(kind: HadaKind, key: string): string | null {
    const topic = HADA_TOPIC.exec(key);
    if (topic) return `/articles/${kind}/${topic[1]}`;
    const article = HADA_ARTICLE.exec(key);
    if (article) return `/articles/${kind}/article/${article[1]}`;
    return null;
  },

  /** 목록 한 줄이 가리키는 이 사이트 안의 상세. 없으면 null. */
  item(item: FeedItem): string | null {
    if (item.type === "trend") return routes.trend(item);
    return routes.hada(item.type, item.key);
  },
};

/** routes.hada 의 역방향 — 상세 라우트의 경로 조각에서 토픽 URL 을 되살린다. */
export function hadaKeyFrom(segments: string[]): string | null {
  if (segments.length === 1 && /^\d+$/.test(segments[0])) {
    return `https://news.hada.io/topic?id=${segments[0]}`;
  }
  if (segments.length === 2 && segments[0] === "article" && /^[A-Za-z0-9-]+$/.test(segments[1])) {
    return `https://news.hada.io/article/${segments[1]}`;
  }
  return null;
}

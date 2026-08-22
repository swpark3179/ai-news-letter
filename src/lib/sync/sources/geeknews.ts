import * as cheerio from "cheerio";
import { absoluteUrl, fetchText } from "../http";

/**
 * news.hada.io 목록 페이지 파서.
 *
 * robots.txt 는 User-agent: * 에 Allow: / 이고 /api/ /login 등만 막는다.
 * 목록 페이지 수집은 허용 범위 안이며, 저장하는 모든 항목은 원문 링크와 출처를
 * 함께 표기한다.
 *
 * 실측한 행 구조 (2026-08 기준)
 *
 *   <div class='topic_row' data-topic-state-id='32708'>
 *     <div class=topictitle>
 *       <a href='<원문 사이트>' class='topic-title-link'>
 *         <h2 class='topic-title-heading'>제목</h2></a>
 *       <span class=topicurl>(runjs.app)</span></div>
 *     <div class='topicdesc'>
 *       <a href='topic?id=32708' class='c99 breakall'>요약…</a></div>   ← 이 href 가 PK
 *     <div class='topicinfo'>
 *       <span id='tp32708'>18</span> points by <a href='/@kciter1'>kciter1</a>
 *       <time datetime="2026-08-21T01:13:20+09:00">10시간전</time>
 *       | <a href='topic?id=…&go=comments' data-topic-comment-count='2'>댓글 2개</a></div>
 *   </div>
 *
 * 주의할 예외 — 긱뉴스가 직접 쓴 글(ARTICLE 배지)은 요약부 href 가
 * `https://news.hada.io/article/<slug>` 형태다. 이것도 고유·안정 URL 이므로
 * 그대로 PK 로 쓴다.
 */

export const GEEKNEWS_BASE = "https://news.hada.io";

export interface GeekNewsItem {
  /** PK — 요약부 링크의 절대 URL */
  url: string;
  title: string;
  summary: string;
  publishedAt: Date;
  externalUrl: string | null;
  sourceDomain: string | null;
  points: number;
  commentCount: number;
  submitter: string | null;
}

export interface CrawlResult {
  items: GeekNewsItem[];
  /** 파싱은 했지만 기간 밖이라 버린 건수 */
  outOfRange: number;
  pagesFetched: number;
}

function parseIntSafe(v: string | undefined | null): number {
  const n = parseInt((v ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/** 목록 HTML 한 장을 파싱한다. */
export function parseListPage(html: string): GeekNewsItem[] {
  const $ = cheerio.load(html);
  const out: GeekNewsItem[] = [];

  $("div.topic_row").each((_, el) => {
    const row = $(el);

    // --- PK: 요약부 링크 -------------------------------------------------
    const descAnchor = row.find("div.topicdesc > a").first();
    const rawHref = descAnchor.attr("href");
    if (!rawHref) return;

    const url = absoluteUrl(rawHref, `${GEEKNEWS_BASE}/`);
    if (!url) return;

    const summary = descAnchor.text().trim();

    // --- 제목 / 원문 -----------------------------------------------------
    const titleAnchor = row.find("div.topictitle a.topic-title-link").first();
    const title =
      titleAnchor.find("h2.topic-title-heading").text().trim() ||
      titleAnchor.text().trim();
    if (!title) return;

    const externalHref = titleAnchor.attr("href");
    const externalUrl = externalHref
      ? absoluteUrl(externalHref, `${GEEKNEWS_BASE}/`)
      : null;

    const domainRaw = row.find("div.topictitle span.topicurl").text().trim();
    const sourceDomain = domainRaw ? domainRaw.replace(/^\(|\)$/g, "") : null;

    // --- 메타 ------------------------------------------------------------
    const info = row.find("div.topicinfo");

    const timeEl = info.find("time").first();
    const datetime = timeEl.attr("datetime");
    const timestamp = timeEl.attr("data-timestamp");

    let publishedAt: Date | null = null;
    if (datetime) {
      const d = new Date(datetime);
      if (!Number.isNaN(d.getTime())) publishedAt = d;
    }
    if (!publishedAt && timestamp) {
      const n = Number(timestamp);
      if (Number.isFinite(n)) publishedAt = new Date(n * 1000);
    }
    // 시각을 못 읽으면 기간 필터를 걸 수 없으므로 버린다.
    if (!publishedAt) return;

    const points = parseIntSafe(info.find("span[id^='tp']").first().text());

    const commentAnchor = info.find("a[data-topic-comment-count]").first();
    const commentCount = parseIntSafe(commentAnchor.attr("data-topic-comment-count"));

    const submitter =
      info.find("a[href^='/@']").first().text().trim() ||
      info.find("span.geeknews-article-author").first().text().trim() ||
      null;

    out.push({
      url,
      title,
      summary,
      publishedAt,
      externalUrl,
      sourceDomain,
      points,
      commentCount,
      submitter: submitter || null,
    });
  });

  return out;
}

export interface CrawlOptions {
  /** 이 시각 이후에 올라온 것만 수집 */
  since: Date;
  maxPages: number;
  /** 요청 간 대기 (기본 1.5초) */
  delayMs?: number;
  onPage?: (page: number, kept: number, total: number) => void;
}

/**
 * 목록 페이지를 순회한다.
 *
 * 목록은 점수순이라 오래된 글이 중간에 섞여 있다. 그래서 "이 페이지에서 기간 안
 * 항목이 하나도 안 나온" 상태가 2번 연속되면 멈춘다.
 */
export async function crawlGeekNews(opts: CrawlOptions): Promise<CrawlResult> {
  const { since, maxPages, delayMs = 1500, onPage } = opts;

  const byUrl = new Map<string, GeekNewsItem>();
  let outOfRange = 0;
  let emptyStreak = 0;
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? `${GEEKNEWS_BASE}/` : `${GEEKNEWS_BASE}/?page=${page}`;
    const html = await fetchText(url, { delayMs: page === 1 ? 0 : delayMs });
    pagesFetched++;

    const rows = parseListPage(html);
    if (rows.length === 0) break; // 더 이상 페이지가 없다

    let kept = 0;
    for (const r of rows) {
      if (r.publishedAt.getTime() < since.getTime()) {
        outOfRange++;
        continue;
      }
      if (!byUrl.has(r.url)) {
        byUrl.set(r.url, r);
        kept++;
      }
    }

    onPage?.(page, kept, rows.length);

    emptyStreak = kept === 0 ? emptyStreak + 1 : 0;
    if (emptyStreak >= 2) break;
  }

  return {
    items: [...byUrl.values()].sort(
      (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
    ),
    outOfRange,
    pagesFetched,
  };
}

/**
 * Atom 피드에서 더 긴 요약을 가져와 보강한다 (약 50건 ≈ 최근 2일치).
 * 피드의 <id> 가 목록의 topic URL 과 같은 값이라 그대로 매칭된다.
 * 실패해도 동기화를 막지 않는다.
 */
export async function fetchFeedSummaries(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  try {
    const xml = await fetchText(`${GEEKNEWS_BASE}/rss/news`, {
      accept: "application/atom+xml,application/xml;q=0.9",
    });
    const $ = cheerio.load(xml, { xmlMode: true });

    $("entry").each((_, el) => {
      const entry = $(el);
      const id = entry.find("id").first().text().trim();
      if (!id) return;

      const contentHtml = entry.find("content").first().text();
      if (!contentHtml) return;

      // <ul><li>…</li></ul> 를 문장 단위로 펼친다.
      const text = cheerio
        .load(contentHtml)("li")
        .map((__, li) => cheerio.load(contentHtml)(li).text().trim())
        .get()
        .filter(Boolean)
        .join(" ");

      const plain = text || cheerio.load(contentHtml).root().text().trim();
      if (plain) map.set(id, plain);
    });
  } catch {
    // 피드가 죽어도 목록 파싱 결과만으로 충분하다.
  }

  return map;
}

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
 *
 * 이 파일은 news.hada.io 의 **모든** 목록 화면을 담당한다. 메인(`/`)과
 * 쇼케이스(`/show`)가 같은 topic_row 템플릿을 쓰므로, 경로만 갈아 끼우는
 * crawlHadaList 하나로 순회 로직을 공유한다 (sources/hada-show.ts 참고).
 */

export const GEEKNEWS_BASE = "https://news.hada.io";
/** 같은 값이지만 "긱뉴스"가 아니라 "사이트"를 가리킬 때 쓰는 이름. */
export const HADA_BASE = GEEKNEWS_BASE;

export interface HadaListItem {
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

/** 긱뉴스 쪽 기존 이름 — 호출부를 그대로 두기 위한 별칭. */
export type GeekNewsItem = HadaListItem;

export interface CrawlResult {
  items: HadaListItem[];
  /** 파싱은 했지만 기간 밖이라 버린 건수 */
  outOfRange: number;
  pagesFetched: number;
}

function parseIntSafe(v: string | undefined | null): number {
  const n = parseInt((v ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export interface ParseListOptions {
  /**
   * 요약부(div.topicdesc)가 없는 행을 버릴지. 기본 true.
   *
   * 메인 목록은 요약이 항상 붙는다. 거기서 요약부가 없다는 것은 대개 마크업이
   * 바뀌어 파싱이 어긋났다는 뜻이라, 억지로 살리기보다 버리는 편이 안전하다.
   *
   * 반면 쇼케이스(/show)는 소개문 없이 링크만 올리는 글이 있다. 거기서 이 옵션을
   * 켜 두면 멀쩡한 글이 조용히 누락되므로, 토픽 id 로 PK 를 복원하고 요약은 빈
   * 문자열로 둔다.
   */
  requireSummary?: boolean;
}

/**
 * 행에서 토픽 id 를 캐낸다.
 * 요약부 링크가 없을 때 PK 를 복원하는 유일한 근거다.
 *
 * 댓글 링크의 href 는 `topic?id=32708&go=comments` 라 그대로 쓰면 요약부 href
 * (`topic?id=32708`)와 다른 문자열이 되어 같은 글이 두 행으로 쌓인다.
 * 그래서 id 만 뽑아 정규 URL 을 다시 만든다.
 */
function topicIdOf(
  stateId: string | undefined,
  commentHref: string | undefined,
): string | null {
  if (stateId && /^\d+$/.test(stateId)) return stateId;

  const m = commentHref?.match(/[?&]id=(\d+)/);
  return m ? m[1] : null;
}

/** 목록 HTML 한 장을 파싱한다. */
export function parseListPage(
  html: string,
  opts: ParseListOptions = {},
): HadaListItem[] {
  const { requireSummary = true } = opts;

  const $ = cheerio.load(html);
  const out: HadaListItem[] = [];

  $("div.topic_row").each((_, el) => {
    const row = $(el);

    // --- PK: 요약부 링크 -------------------------------------------------
    const descAnchor = row.find("div.topicdesc > a").first();
    const rawHref = descAnchor.attr("href");

    let url = rawHref ? absoluteUrl(rawHref, `${HADA_BASE}/`) : null;
    let summary = descAnchor.text().trim();

    if (!url) {
      if (requireSummary) return;

      const id = topicIdOf(
        row.attr("data-topic-state-id"),
        row.find("a[data-topic-comment-count]").first().attr("href"),
      );
      if (!id) return;
      url = `${HADA_BASE}/topic?id=${id}`;
      summary = "";
    }

    // --- 제목 / 원문 -----------------------------------------------------
    const titleAnchor = row.find("div.topictitle a.topic-title-link").first();
    const title =
      titleAnchor.find("h2.topic-title-heading").text().trim() ||
      titleAnchor.text().trim();
    if (!title) return;

    const externalHref = titleAnchor.attr("href");
    const externalUrl = externalHref
      ? absoluteUrl(externalHref, `${HADA_BASE}/`)
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

export interface HadaListCrawlOptions extends CrawlOptions, ParseListOptions {
  /** 목록 경로 — "/" (메인) 또는 "/show" (쇼케이스) */
  listPath: string;
  /**
   * 1페이지에서 topic_row 를 한 행도 못 찾았을 때 예외를 던질지. 기본 false.
   *
   * "오늘 새 글이 없다"와 "셀렉터가 안 맞는다"는 결과가 똑같이 0건이라 구분되지
   * 않는다. 새로 붙이는 수집기는 이걸 켜서 후자를 빨간 실패로 드러낸다.
   */
  failOnEmptyFirstPage?: boolean;
}

export class EmptyListError extends Error {
  constructor(url: string) {
    super(
      `목록에서 항목을 하나도 찾지 못했습니다 — ${url}\n` +
        `마크업(div.topic_row)이 바뀌었거나 WAF 에 막혔을 수 있습니다.`,
    );
    this.name = "EmptyListError";
  }
}

function listUrl(listPath: string, page: number): string {
  return page === 1
    ? `${HADA_BASE}${listPath}`
    : `${HADA_BASE}${listPath}?page=${page}`;
}

/**
 * news.hada.io 목록 경로 하나를 페이지 단위로 순회한다.
 *
 * 목록은 점수순이라 오래된 글이 중간에 섞여 있다. 그래서 "이 페이지에서 기간 안
 * 항목이 하나도 안 나온" 상태가 2번 연속되면 멈춘다.
 */
export async function crawlHadaList(
  opts: HadaListCrawlOptions,
): Promise<CrawlResult> {
  const {
    listPath,
    since,
    maxPages,
    delayMs = 1500,
    onPage,
    requireSummary,
    failOnEmptyFirstPage = false,
  } = opts;

  const byUrl = new Map<string, HadaListItem>();
  let outOfRange = 0;
  let emptyStreak = 0;
  let pagesFetched = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = listUrl(listPath, page);
    const html = await fetchText(url, { delayMs: page === 1 ? 0 : delayMs });
    pagesFetched++;

    const rows = parseListPage(html, { requireSummary });
    if (rows.length === 0) {
      if (page === 1 && failOnEmptyFirstPage) throw new EmptyListError(url);
      break; // 더 이상 페이지가 없다
    }

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

/** 긱뉴스 메인 목록(`/`) 순회. */
export async function crawlGeekNews(opts: CrawlOptions): Promise<CrawlResult> {
  return crawlHadaList({ ...opts, listPath: "/" });
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

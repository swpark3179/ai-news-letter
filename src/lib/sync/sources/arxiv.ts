import * as cheerio from "cheerio";
import { HttpError, fetchText, type RetryInfo } from "../http";

/**
 * arXiv — 공식 Atom API.
 *   https://export.arxiv.org/api/query?search_query=...&sortBy=submittedDate
 *
 * abstract 가 응답에 그대로 들어 있어 추가 요청 없이 기사 작성이 가능하다.
 *
 * export.arxiv.org 는 IP 단위로 요청량을 재는데, GitHub Actions 러너는 다른
 * 사용자들과 IP 대역을 공유한다. 그래서 우리가 하루 한 번만 불러도 첫 요청부터
 * 429 가 돌아오는 날이 있다. 이를 견디려고 세 가지를 둔다.
 *
 *   1. 약관이 요구하는 대로 요청자를 밝히는 User-Agent (브라우저 UA 로 위장한
 *      데이터센터 IP 는 더 빨리 조여진다) + 3초 간격 + 넉넉한 재시도
 *   2. 응답의 Retry-After 를 따르는 백오프 (http.ts)
 *   3. 그래도 안 되면 rss.arxiv.org 의 당일 공지 RSS 로 대체 수집.
 *      RSS 는 API 와 다른 경로로 서빙돼 API 가 막혀도 살아 있는 경우가 많다.
 */

const API_ENDPOINT = "https://export.arxiv.org/api/query";
const RSS_ENDPOINT = "https://rss.arxiv.org/rss";

/**
 * arXiv API 이용 약관은 "요청자를 알아볼 수 있는 User-Agent" 를 요구한다.
 * ARXIV_USER_AGENT 로 덮어쓸 수 있다 (연락처를 넣어 두면 차단 시 문의가 온다).
 */
const DEFAULT_ARXIV_UA =
  "ai-news-letter/1.0 (+https://github.com/swpark3179/ai-news-letter) arxiv-api-client";

/** arXiv 가 권고하는 요청 간격. */
const ARXIV_DELAY_MS = 3000;

export const ARXIV_CATEGORIES = ["cs.AI", "cs.CL", "cs.IR", "cs.LG"] as const;
export type ArxivCategory = (typeof ARXIV_CATEGORIES)[number];

export interface ArxivPaper {
  /** https://arxiv.org/abs/2508.11204 */
  url: string;
  arxivId: string;
  title: string;
  summary: string;
  authors: string[];
  category: string;
  published: Date | null;
}

function arxivUserAgent(): string {
  return process.env.ARXIV_USER_AGENT || DEFAULT_ARXIV_UA;
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 여러 개를 한 줄에 늘어놓을 때 쓰는 짧은 형태 (URL 은 뺀다). */
function shortErrMessage(e: unknown): string {
  return e instanceof HttpError ? `HTTP ${e.status}` : errMessage(e);
}

export function parseArxivFeed(xml: string): ArxivPaper[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out: ArxivPaper[] = [];

  $("entry").each((_, el) => {
    const entry = $(el);

    const rawId = entry.find("id").first().text().trim();
    if (!rawId) return;

    // http://arxiv.org/abs/2508.11204v1 → 2508.11204
    const m = rawId.match(/abs\/([^v\s]+)/);
    const arxivId = m ? m[1] : rawId.split("/").pop() ?? rawId;

    const title = normalizeWhitespace(entry.find("title").first().text());
    const summary = normalizeWhitespace(entry.find("summary").first().text());
    if (!title || !summary) return;

    const authors = entry
      .find("author > name")
      .map((__, a) => $(a).text().trim())
      .get()
      .filter(Boolean);

    const category =
      entry.find("primary_category").first().attr("term") ||
      entry.find("category").first().attr("term") ||
      "cs.AI";

    const publishedRaw = entry.find("published").first().text().trim();
    const published = publishedRaw ? new Date(publishedRaw) : null;

    out.push({
      url: `https://arxiv.org/abs/${arxivId}`,
      arxivId,
      title,
      summary,
      authors,
      category,
      published: published && !Number.isNaN(published.getTime()) ? published : null,
    });
  });

  return out;
}

/** description 의 "arXiv:2508.11204v1 Announce Type: new / Abstract: …" 머리말을 걷어낸다. */
function stripRssPreamble(desc: string): string {
  const at = desc.indexOf("Abstract:");
  const body =
    at >= 0
      ? desc.slice(at + "Abstract:".length)
      : desc.replace(/^\s*arXiv:\S+\s*(Announce Type:\s*\S+)?/i, "");

  // 예전 형식은 <p> 가 섞여 오기도 했다.
  return normalizeWhitespace(body.replace(/<[^>]+>/g, " "));
}

/** 2508.11204v1 · oai:arXiv.org:2508.11204v1 · https://arxiv.org/abs/2508.11204 → 2508.11204 */
function extractArxivId(s: string): string | null {
  const m = s.match(/(?:abs\/|arXiv[.:]org[.:]|arXiv:)?(\d{4}\.\d{4,5})(?:v\d+)?/i);
  return m ? m[1] : null;
}

/**
 * rss.arxiv.org 의 당일 공지 RSS 파싱.
 *
 * API 와 달리 카테고리별 피드이고 그날 공지된 것만 담긴다. 초록은
 * <description> 안에 머리말과 함께 들어 있어 잘라 써야 한다.
 */
export function parseArxivRss(xml: string, fallbackCategory = "cs.AI"): ArxivPaper[] {
  const $ = cheerio.load(xml, { xmlMode: true });

  const channelDate = $("channel > pubDate").first().text().trim();
  const channelPublished = channelDate ? new Date(channelDate) : null;

  const out: ArxivPaper[] = [];

  $("item").each((_, el) => {
    const item = $(el);

    const link = item.find("link").first().text().trim();
    const guid = item.find("guid").first().text().trim();
    const rawDesc = item.find("description").first().text();

    const arxivId =
      extractArxivId(link) || extractArxivId(guid) || extractArxivId(rawDesc);
    if (!arxivId) return;

    // 개정판(replace) 은 이미 다룬 논문의 v2 라 새 소식이 아니다.
    const announce = item.find("arxiv\\:announce_type").first().text().trim().toLowerCase();
    if (announce.startsWith("replace")) return;

    // 예전 형식의 제목에는 "…. (arXiv:2508.11204v1 [cs.AI])" 가 붙어 있었다.
    const title = normalizeWhitespace(
      item.find("title").first().text().replace(/\(arXiv:\S+\s*\[[^\]]+\]\)\s*$/i, ""),
    );
    const summary = stripRssPreamble(rawDesc);
    if (!title || !summary) return;

    const authors = item
      .find("dc\\:creator")
      .first()
      .text()
      .split(/\s*,\s*/)
      .map((a) => a.trim())
      .filter(Boolean);

    const itemDate = item.find("pubDate").first().text().trim();
    const published = itemDate ? new Date(itemDate) : channelPublished;

    out.push({
      url: `https://arxiv.org/abs/${arxivId}`,
      arxivId,
      title,
      summary,
      authors,
      category: item.find("category").first().text().trim() || fallbackCategory,
      published: published && !Number.isNaN(published.getTime()) ? published : null,
    });
  });

  return out;
}

export interface FetchPapersOptions {
  categories?: readonly string[];
  limit?: number;
  /** 재시도·대체 수집 상황을 남길 로거 (기본: 조용히 진행) */
  log?: (msg: string, level?: "info" | "warn") => void;
}

/** Atom API 로 최신 논문을 가져온다. */
async function fetchFromApi(
  cats: readonly string[],
  limit: number,
  log: NonNullable<FetchPapersOptions["log"]>,
): Promise<ArxivPaper[]> {
  const query = cats.map((c) => `cat:${c}`).join("+OR+");
  const url =
    `${API_ENDPOINT}?search_query=${query}` +
    `&start=0&sortBy=submittedDate&sortOrder=descending&max_results=${limit}`;

  const xml = await fetchText(url, {
    accept: "application/atom+xml,application/xml;q=0.9",
    headers: { "user-agent": arxivUserAgent() },
    delayMs: ARXIV_DELAY_MS,
    // 429 는 잠깐 뒤 풀리는 경우가 많아 기본(3회)보다 넉넉히 기다려 본다.
    retries: 4,
    timeoutMs: 30_000,
    maxBackoffMs: 45_000,
    onRetry: (i: RetryInfo) =>
      log(
        `arXiv API 재시도 ${i.attempt}/${i.retries} · ${Math.round(i.waitMs / 1000)}초 대기 — ${i.error.message}`,
        "warn",
      ),
  });

  const papers = parseArxivFeed(xml);
  // 과부하 때는 200 에 빈 피드가 오기도 한다. 빈 결과는 실패로 보고 RSS 로 넘긴다.
  if (papers.length === 0) throw new Error("arXiv API 응답에 논문이 없습니다");

  return papers;
}

/** API 가 막혔을 때 쓰는 카테고리별 공지 RSS. */
async function fetchFromRss(
  cats: readonly string[],
  limit: number,
  log: NonNullable<FetchPapersOptions["log"]>,
): Promise<ArxivPaper[]> {
  const byId = new Map<string, ArxivPaper>();
  const errors: string[] = [];

  for (const [i, cat] of cats.entries()) {
    try {
      const xml = await fetchText(`${RSS_ENDPOINT}/${cat}`, {
        accept: "application/rss+xml,application/xml;q=0.9",
        headers: { "user-agent": arxivUserAgent() },
        delayMs: i === 0 ? 0 : ARXIV_DELAY_MS,
        retries: 2,
        timeoutMs: 30_000,
      });

      const found = parseArxivRss(xml, cat);
      log(`arXiv RSS ${cat} · ${found.length}건`);
      for (const p of found) if (!byId.has(p.arxivId)) byId.set(p.arxivId, p);
    } catch (e) {
      errors.push(`${cat}: ${shortErrMessage(e)}`);
    }
  }

  if (byId.size === 0) {
    throw new Error(`RSS 대체 수집도 실패 — ${errors.join(" · ") || "항목 없음"}`);
  }
  if (errors.length > 0) log(`arXiv RSS 일부 실패 — ${errors.join(" · ")}`, "warn");

  return [...byId.values()]
    .sort((a, b) => (b.published?.getTime() ?? 0) - (a.published?.getTime() ?? 0))
    .slice(0, limit);
}

export async function fetchRecentPapers(opts: FetchPapersOptions = {}): Promise<ArxivPaper[]> {
  const cats = opts.categories ?? ARXIV_CATEGORIES;
  const limit = opts.limit ?? 40;
  const log = opts.log ?? (() => {});

  let apiError: string;
  try {
    return await fetchFromApi(cats, limit, log);
  } catch (e) {
    apiError = errMessage(e);
    log(`arXiv API 수집 실패 (${apiError}) — RSS 피드로 대체합니다`, "warn");
  }

  try {
    return await fetchFromRss(cats, limit, log);
  } catch (e) {
    throw new Error(`API: ${apiError} · ${errMessage(e)}`);
  }
}

export function paperContext(p: ArxivPaper): string {
  return [
    `제목: ${p.title}`,
    `arXiv: ${p.arxivId} (${p.category})`,
    p.authors.length ? `저자: ${p.authors.slice(0, 6).join(", ")}` : "",
    `초록:\n${p.summary}`,
  ]
    .filter(Boolean)
    .join("\n");
}

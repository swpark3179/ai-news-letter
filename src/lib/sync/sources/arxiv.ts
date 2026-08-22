import * as cheerio from "cheerio";
import { fetchText } from "../http";

/**
 * arXiv — 공식 Atom API.
 *   http://export.arxiv.org/api/query?search_query=...&sortBy=submittedDate
 *
 * abstract 가 응답에 그대로 들어 있어 추가 요청 없이 기사 작성이 가능하다.
 */

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

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
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

export async function fetchRecentPapers(opts: {
  categories?: readonly string[];
  limit?: number;
}): Promise<ArxivPaper[]> {
  const cats = opts.categories ?? ARXIV_CATEGORIES;
  const limit = opts.limit ?? 40;

  const query = cats.map((c) => `cat:${c}`).join("+OR+");
  const url =
    `http://export.arxiv.org/api/query?search_query=${query}` +
    `&sortBy=submittedDate&sortOrder=descending&max_results=${limit}`;

  const xml = await fetchText(url, {
    accept: "application/atom+xml",
    // arXiv 는 3초 간격 요청을 권고한다.
    delayMs: 3000,
  });

  return parseArxivFeed(xml);
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

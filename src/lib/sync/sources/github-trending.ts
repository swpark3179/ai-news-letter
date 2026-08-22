import * as cheerio from "cheerio";
import { fetchText } from "../http";

/**
 * GitHub Trending.
 *
 * 공식 API 가 없어 https://github.com/trending 을 파싱한다.
 * daily / weekly / monthly 를 각각 조회해 합집합으로 모은다 — 같은 저장소가
 * 여러 기간에 걸쳐도 URL 이 PK 라 자연히 중복 제거된다.
 */

export type TrendingPeriod = "daily" | "weekly" | "monthly";

export const TRENDING_PERIODS: TrendingPeriod[] = ["daily", "weekly", "monthly"];

export interface TrendingRepo {
  /** https://github.com/{owner}/{repo} */
  url: string;
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  starsInPeriod: number;
  period: TrendingPeriod;
}

function parseNum(s: string | undefined): number {
  if (!s) return 0;
  const n = parseInt(s.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export function parseTrendingHtml(html: string, period: TrendingPeriod): TrendingRepo[] {
  const $ = cheerio.load(html);
  const out: TrendingRepo[] = [];

  $("article.Box-row").each((_, el) => {
    const row = $(el);

    const href = row.find("h2 a").first().attr("href");
    if (!href) return;

    const fullName = href.replace(/^\//, "").trim();
    if (!fullName.includes("/")) return;

    const description = row.find("p").first().text().trim() || null;
    const language =
      row.find('[itemprop="programmingLanguage"]').first().text().trim() || null;

    const stars = parseNum(row.find('a[href$="/stargazers"]').first().text());

    // "4,812 stars this week" 형태의 우측 텍스트
    const periodText = row.find("span.d-inline-block.float-sm-right").first().text();
    const starsInPeriod = parseNum(periodText);

    out.push({
      url: `https://github.com/${fullName}`,
      fullName,
      description,
      language,
      stars,
      starsInPeriod: starsInPeriod || stars,
      period,
    });
  });

  return out;
}

export async function fetchTrending(period: TrendingPeriod): Promise<TrendingRepo[]> {
  const html = await fetchText(`https://github.com/trending?since=${period}`, {
    delayMs: 800,
  });
  return parseTrendingHtml(html, period);
}

/** 세 기간을 모두 조회해 URL 기준으로 합친다. 먼저 발견한 기간을 유지한다. */
export async function fetchAllTrending(
  onPeriod?: (period: TrendingPeriod, count: number) => void,
): Promise<TrendingRepo[]> {
  const merged = new Map<string, TrendingRepo>();

  for (const period of TRENDING_PERIODS) {
    const repos = await fetchTrending(period);
    onPeriod?.(period, repos.length);
    for (const r of repos) {
      if (!merged.has(r.url)) merged.set(r.url, r);
    }
  }

  return [...merged.values()];
}

/**
 * 기사 작성용 컨텍스트. README 앞부분을 가져온다.
 * 기본 브랜치 이름을 몰라도 되도록 HEAD 를 쓴다. 실패하면 설명만으로 쓴다.
 */
export async function fetchRepoContext(
  repo: TrendingRepo,
  maxChars = 4000,
): Promise<string> {
  const parts = [
    `저장소: ${repo.fullName}`,
    repo.language ? `주 언어: ${repo.language}` : "",
    `별: 총 ${repo.stars.toLocaleString("en-US")} · ${repo.period} 기준 +${repo.starsInPeriod.toLocaleString("en-US")}`,
    repo.description ? `설명: ${repo.description}` : "",
  ].filter(Boolean);

  for (const name of ["README.md", "readme.md", "README.rst"]) {
    try {
      const raw = await fetchText(
        `https://raw.githubusercontent.com/${repo.fullName}/HEAD/${name}`,
        { accept: "text/plain", retries: 0, delayMs: 300 },
      );
      if (raw.trim()) {
        parts.push(`README:\n${raw.slice(0, maxChars)}`);
        break;
      }
    } catch {
      // 다음 후보 파일명으로
    }
  }

  return parts.join("\n");
}

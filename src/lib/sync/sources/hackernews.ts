import { fetchJson } from "../http";

/**
 * Hacker News — 공식 Firebase API 를 쓴다 (스크레이핑 불필요).
 *   https://hacker-news.firebaseio.com/v0/topstories.json
 *   https://hacker-news.firebaseio.com/v0/item/{id}.json
 *
 * PK 로는 외부 링크가 아니라 HN 스레드 URL 을 쓴다. 같은 기사를 여러 번 제출해도
 * 스레드는 하나이고, 우리가 요약하는 대상이 "스레드의 논의"이기 때문이다.
 */

const API = "https://hacker-news.firebaseio.com/v0";

export interface HnStory {
  /** https://news.ycombinator.com/item?id={id} */
  url: string;
  id: number;
  title: string;
  score: number;
  descendants: number;
  externalUrl: string | null;
  by: string | null;
  time: number;
}

interface HnItem {
  id: number;
  type?: string;
  title?: string;
  score?: number;
  descendants?: number;
  url?: string;
  by?: string;
  time?: number;
  dead?: boolean;
  deleted?: boolean;
}

export function threadUrl(id: number): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

export async function fetchTopStories(opts: {
  minScore: number;
  limit: number;
  /** 후보로 훑어볼 상위 id 개수 */
  scan?: number;
}): Promise<HnStory[]> {
  const ids = await fetchJson<number[]>(`${API}/topstories.json`);
  const scan = Math.min(ids.length, opts.scan ?? 90);

  const out: HnStory[] = [];

  // 동시 요청 12개씩 끊어서 — Firebase API 는 관대하지만 예의는 지킨다.
  const CHUNK = 12;
  for (let i = 0; i < scan && out.length < opts.limit; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    const items = await Promise.all(
      batch.map((id) =>
        fetchJson<HnItem | null>(`${API}/item/${id}.json`, { retries: 1 }).catch(
          () => null,
        ),
      ),
    );

    for (const it of items) {
      if (!it || it.deleted || it.dead) continue;
      if (it.type !== "story" || !it.title) continue;
      if ((it.score ?? 0) < opts.minScore) continue;

      out.push({
        url: threadUrl(it.id),
        id: it.id,
        title: it.title,
        score: it.score ?? 0,
        descendants: it.descendants ?? 0,
        externalUrl: it.url ?? null,
        by: it.by ?? null,
        time: it.time ?? 0,
      });
    }
  }

  return out.sort((a, b) => b.score - a.score).slice(0, opts.limit);
}

/**
 * 기사 작성용 컨텍스트 — Algolia API 로 상위 댓글을 가져온다.
 * 스레드의 논지는 대체로 상위 댓글에 담겨 있다.
 */
interface AlgoliaNode {
  text?: string | null;
  points?: number | null;
  children?: AlgoliaNode[];
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchStoryContext(
  story: HnStory,
  topN = 5,
  maxChars = 3500,
): Promise<string> {
  const parts = [
    `제목: ${story.title}`,
    `점수: ${story.score} · 댓글 ${story.descendants}개`,
    story.externalUrl ? `링크: ${story.externalUrl}` : "링크 없음 (Ask/Show HN)",
  ];

  try {
    const item = await fetchJson<AlgoliaNode>(
      `https://hn.algolia.com/api/v1/items/${story.id}`,
      { retries: 1, delayMs: 250 },
    );

    const comments = (item.children ?? [])
      .filter((c) => c.text)
      .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
      .slice(0, topN)
      .map((c, i) => `[댓글 ${i + 1} · ${c.points ?? 0}점] ${stripHtml(c.text ?? "")}`);

    if (comments.length > 0) {
      parts.push(`상위 댓글:\n${comments.join("\n").slice(0, maxChars)}`);
    }
  } catch {
    // 댓글을 못 가져와도 제목·점수만으로 요약할 수 있다.
  }

  return parts.join("\n");
}

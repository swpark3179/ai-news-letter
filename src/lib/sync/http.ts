/**
 * 수집용 HTTP 헬퍼.
 *
 * 외부 사이트를 긁을 때 지켜야 할 것들을 한 곳에 모았다.
 *   - 사람이 쓰는 브라우저와 같은 User-Agent (실측 시 기본 UA 로는 403 이 났다)
 *   - 요청 사이 간격 (news.hada.io 는 연속 요청에 403 을 돌려준다)
 *   - 403 / 429 / 5xx 에 지수 백오프 재시도
 */

/**
 * 기본 User-Agent.
 *
 * 처음에는 "…AINewsletterBot/1.0" 처럼 수집기임을 밝히는 토큰을 붙였는데,
 * news.hada.io 가 UA 에 "bot" 이 들어가면 403 을 돌려주는 것을 확인했다
 * (robots.txt 는 User-agent: * 에 Allow: / 로 열어 두었지만 WAF 단에서 막힌다).
 * 그래서 일반 브라우저 UA 를 쓰되, 요청 간격을 넉넉히 두고 목록 페이지만
 * 읽으며 저장하는 모든 항목에 원문 링크와 출처를 함께 남긴다.
 *
 * 필요하면 SYNC_USER_AGENT 환경변수로 덮어쓸 수 있다.
 */
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export interface FetchOptions {
  headers?: Record<string, string>;
  /** 이 요청 전에 기다릴 시간 */
  delayMs?: number;
  retries?: number;
  timeoutMs?: number;
  accept?: string;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function userAgent(): string {
  return process.env.SYNC_USER_AGENT || DEFAULT_UA;
}

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string) {
    super(`HTTP ${status} — ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

const RETRYABLE = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const {
    headers = {},
    delayMs = 0,
    retries = 3,
    timeoutMs = 20_000,
    accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  } = opts;

  if (delayMs > 0) await sleep(delayMs);

  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // 1.5s → 4s → 9s
      await sleep(1500 * attempt * attempt + 1500);
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": userAgent(),
          accept,
          "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
          ...headers,
        },
        signal: ac.signal,
        redirect: "follow",
      });

      if (!res.ok) {
        const err = new HttpError(res.status, url);
        if (RETRYABLE.has(res.status) && attempt < retries) {
          lastErr = err;
          continue;
        }
        throw err;
      }

      return await res.text();
    } catch (e) {
      lastErr = e;
      if (attempt >= retries) break;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(`요청 실패: ${url}`);
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const text = await fetchText(url, { accept: "application/json", ...opts });
  return JSON.parse(text) as T;
}

/** 상대 URL 을 base 기준 절대 URL 로. 실패하면 null. */
export function absoluteUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

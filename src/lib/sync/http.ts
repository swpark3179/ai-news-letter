/**
 * 수집용 HTTP 헬퍼.
 *
 * 외부 사이트를 긁을 때 지켜야 할 것들을 한 곳에 모았다.
 *   - 사람이 쓰는 브라우저와 같은 User-Agent (실측 시 기본 UA 로는 403 이 났다)
 *   - 요청 사이 간격 (news.hada.io 는 연속 요청에 403 을 돌려준다)
 *   - 403 / 429 / 5xx 에 지수 백오프 재시도 (Retry-After 헤더가 오면 그쪽을 따른다)
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
 * 반대로 arXiv 처럼 "요청자를 밝히는 UA" 를 약관으로 요구하는 곳도 있다.
 * 그런 출처는 headers 로 user-agent 를 덮어쓴다 (sources/arxiv.ts 참고).
 *
 * 필요하면 SYNC_USER_AGENT 환경변수로 덮어쓸 수 있다.
 */
const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/** Retry-After 를 따르더라도 한 번에 이만큼 넘게는 기다리지 않는다. */
const DEFAULT_MAX_BACKOFF_MS = 60_000;

export interface RetryInfo {
  url: string;
  /** 1부터 센 재시도 회차 */
  attempt: number;
  retries: number;
  waitMs: number;
  error: Error;
}

export interface FetchOptions {
  headers?: Record<string, string>;
  /** 이 요청 전에 기다릴 시간 */
  delayMs?: number;
  retries?: number;
  timeoutMs?: number;
  accept?: string;
  /** 재시도 한 번에 기다리는 상한 (Retry-After 가 길어도 여기서 잘린다) */
  maxBackoffMs?: number;
  /** 재시도 직전에 불린다. 오래 걸리는 수집의 진행 상황 로그용 */
  onRetry?: (info: RetryInfo) => void;
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
  /** 응답의 Retry-After 를 ms 로 환산한 값 (헤더가 없으면 null) */
  readonly retryAfterMs: number | null;

  constructor(status: number, url: string, retryAfterMs: number | null = null) {
    super(`HTTP ${status} — ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.retryAfterMs = retryAfterMs;
  }
}

const RETRYABLE = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

/** 1.5s → 4s(=7.5s) → 15s … 회차가 늘수록 제곱으로 벌어진다. */
function backoffMs(attempt: number): number {
  const n = attempt + 1;
  return 1500 * n * n + 1500;
}

/**
 * Retry-After 파싱. 초 단위 숫자와 HTTP-date 두 형식을 모두 받는다.
 * 값이 없거나 이상하면 null (그러면 지수 백오프를 쓴다).
 */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;

  return Math.max(0, at - now);
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const {
    headers = {},
    delayMs = 0,
    retries = 3,
    timeoutMs = 20_000,
    accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
    onRetry,
  } = opts;

  if (delayMs > 0) await sleep(delayMs);

  let lastErr: Error = new Error(`요청 실패: ${url}`);

  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let retryAfterMs: number | null = null;

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

      if (res.ok) return await res.text();

      // 재시도해도 결과가 달라지지 않는 상태 코드(404 등)는 바로 던진다.
      // 예전에는 여기서 던진 것을 아래 catch 가 받아 다시 재시도했다.
      const err = new HttpError(res.status, url, parseRetryAfter(res.headers.get("retry-after")));
      if (!RETRYABLE.has(res.status)) throw err;

      lastErr = err;
      retryAfterMs = err.retryAfterMs;
    } catch (e) {
      if (e instanceof HttpError && !RETRYABLE.has(e.status)) throw e;
      lastErr = e instanceof Error ? e : new Error(String(e));
    } finally {
      clearTimeout(timer);
    }

    if (attempt >= retries) break;

    // 서버가 "언제 다시 오라" 고 알려 주면 그 말을 따른다. 429 를 돌려주는
    // 쪽(arXiv 등)은 대개 백오프 계산보다 긴 시간을 요구한다.
    const wait = Math.min(Math.max(retryAfterMs ?? 0, backoffMs(attempt)), maxBackoffMs);
    onRetry?.({ url, attempt: attempt + 1, retries, waitMs: wait, error: lastErr });
    await sleep(wait);
  }

  throw lastErr;
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

/**
 * 링크 URL 검증.
 *
 * new URL() 로 파싱만 되면 통과시키면 javascript: 와 data: 도 통과한다 —
 * 수집한 본문의 링크를 그대로 <a href> 로 내보내면 저장형 XSS 가 된다.
 * 그래서 http(s) 만 허용한다 (sync/html-markdown.ts).
 */

const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

export function isHttpUrl(v: string): boolean {
  try {
    return SAFE_PROTOCOLS.has(new URL(v).protocol);
  } catch {
    return false;
  }
}

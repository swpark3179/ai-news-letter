/**
 * 링크 URL 검증.
 *
 * zod 의 z.string().url() 은 new URL() 로 파싱만 되면 통과시킨다.
 * 즉 javascript: 와 data: 도 통과한다 — 원문 소스 링크는 기사 화면에서
 * <a href>로 그대로 렌더되므로 그대로 두면 저장형 XSS 가 된다.
 * 관리자만 쓰던 동안에는 드러나지 않았지만, 이제 모든 회원이 글을 쓴다.
 */

const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

export function isHttpUrl(v: string): boolean {
  try {
    return SAFE_PROTOCOLS.has(new URL(v).protocol);
  } catch {
    return false;
  }
}

/** 렌더 직전 방어 — 이미 DB 에 들어간 값도 막는다. 안전하지 않으면 null. */
export function safeHref(v: string | null | undefined): string | null {
  if (!v) return null;
  return isHttpUrl(v) ? v : null;
}

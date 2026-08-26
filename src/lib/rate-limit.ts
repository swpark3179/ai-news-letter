/**
 * 아주 단순한 고정창(fixed window) 리미터.
 *
 * **인스턴스 메모리에만 산다.** 서버리스에서는 인스턴스마다 따로 세므로 이것을
 * 보안 경계로 삼으면 안 된다. 실제 차단은 등록사용자 대조(resolveMemberFromSso)가
 * 한다. 여기서 얻는 것은 자동화된 반복 시도가 로그와 응답에서 눈에 띄게 되는 것뿐이다.
 *
 * 정식으로 막아야 하면 Vercel 의 엣지 미들웨어 레이트리밋이나 Upstash 같은
 * 외부 저장소로 옮겨야 한다.
 */

const buckets = new Map<string, { n: number; resetAt: number }>();

/** 상한을 넘었으면 true. 넘지 않았으면 카운트를 올리고 false. */
export function hitRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);

  if (!b || b.resetAt <= now) {
    buckets.set(key, { n: 1, resetAt: now + windowMs });

    // 만료된 항목을 이때 같이 걷어낸다. 타이머를 두면 서버리스에서 인스턴스가
    // 잠들지 못하므로, 쓰기가 일어날 때만 청소한다.
    if (buckets.size > 5_000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return false;
  }

  b.n += 1;
  return b.n > limit;
}

/**
 * 요청자 IP. 프록시 뒤라 헤더를 본다.
 *
 * 헤더는 위조할 수 있으므로 이 값도 신뢰 경계가 아니다 — 위 주석과 같은 이유로
 * 「눈에 띄게 하는 용도」로만 쓴다.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return xff?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

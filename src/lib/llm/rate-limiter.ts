/**
 * 호출 간 최소 간격을 강제하는 단순 리미터.
 *
 * Gemini 무료 티어는 gemini-2.5-flash 기준 10 RPM 이라 7초 간격이면 안전하다.
 * (429 를 맞고 재시도하는 것보다 애초에 천천히 보내는 편이 총 시간이 짧다.)
 */
export class RateLimiter {
  private readonly minIntervalMs: number;
  private last = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(minIntervalMs: number) {
    this.minIntervalMs = Math.max(0, minIntervalMs);
  }

  /** 호출을 직렬화하고 간격을 보장한다. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.chain.then(async () => {
      const wait = this.minIntervalMs - (Date.now() - this.last);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
    });

    this.chain = task.catch(() => {});
    return task.then(fn);
  }
}

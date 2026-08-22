import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

/**
 * 사내 프록시 뒤에서 fetch 가 동작하도록 한다.
 *
 * curl 이나 npm 은 HTTP_PROXY / HTTPS_PROXY 환경변수를 알아서 쓰지만, Node 의
 * fetch 는 기본적으로 무시한다. 그대로 두면 프록시 환경에서 다음이 전부 죽는다.
 *
 *   - Supabase 클라이언트 (내부적으로 fetch 사용) → "TypeError: fetch failed"
 *   - 수집 스크립트의 외부 사이트 요청        → ConnectTimeoutError
 *   - LLM API 호출
 *
 * Node 24 의 NODE_USE_ENV_PROXY=1 은 프로세스 시작 시점에 읽히므로 코드에서
 * process.env 에 넣어도 늦다. 그래서 undici 의 EnvHttpProxyAgent 를 전역
 * 디스패처로 직접 꽂는다. NO_PROXY 도 이 에이전트가 함께 처리한다.
 *
 * 호출 지점
 *   - Next 서버        : src/instrumentation.ts (서버 부팅 시 1회)
 *   - 수집 CLI         : scripts/sync/cli.ts
 *
 * GitHub Actions 처럼 프록시가 없는 환경에서는 아무 일도 하지 않는다.
 */

let applied = false;

export function enableEnvProxy(): string | null {
  const proxy =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy;

  if (!proxy) return null;
  if (applied) return proxy;

  setGlobalDispatcher(new EnvHttpProxyAgent());
  applied = true;
  return proxy;
}

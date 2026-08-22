/**
 * Next 서버가 뜰 때 한 번 실행된다.
 *
 * 사내 프록시 환경에서는 Node 의 fetch 가 HTTP_PROXY 를 무시하기 때문에
 * Supabase 클라이언트 호출이 전부 "TypeError: fetch failed" 로 죽는다.
 * 첫 요청이 들어오기 전에 전역 디스패처를 프록시로 바꿔 둔다.
 *
 * Edge 런타임에는 undici 를 쓸 수 없으므로 nodejs 런타임에서만 적용한다.
 * (proxy.ts 는 프록시 환경변수가 없으면 아무 일도 하지 않는다.)
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { enableEnvProxy } = await import("@/lib/proxy");
  const proxy = enableEnvProxy();
  if (proxy) {
    console.log(`[instrumentation] 사내 프록시 적용: ${proxy}`);
  }
}

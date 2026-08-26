import { ssoPublicEnv } from "@/lib/env";
import { KnoxTraySsoClient } from "./client";
import { MockSsoClient } from "./client.mock";
import type { SsoClient, SsoFailureCode } from "./types";

export * from "./types";
export { AUTH_FAILURES, failureOf, isFailureCode } from "./failures";

/**
 * 실행 모드에 따라 SSO 클라이언트를 고른다.
 *
 *   NEXT_PUBLIC_SSO_MODE=mock (기본) → MockSsoClient
 *   NEXT_PUBLIC_SSO_MODE=real        → KnoxTraySsoClient (getknoxsso)
 *
 * 실 모드로 넘길 때 화면 코드는 손대지 않는다 — 이 함수만 호출하기 때문이다.
 * 실 모드에 필요한 값은 NEXT_PUBLIC_SSO_TRAY_WS_URL · NEXT_PUBLIC_SSO_TRAY_APP_CODE.
 */
export function createSsoClient(forcedFailure: SsoFailureCode | null = null): SsoClient {
  if (ssoPublicEnv.mode === "real") {
    return new KnoxTraySsoClient();
  }
  return new MockSsoClient(forcedFailure);
}

export const isMockSso = ssoPublicEnv.mode === "mock";

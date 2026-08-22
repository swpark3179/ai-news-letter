import { ssoPublicEnv } from "@/lib/env";
import { WebSocketSsoClient } from "./client";
import { MockSsoClient } from "./client.mock";
import type { SsoClient, SsoFailureCode } from "./types";

export * from "./types";
export { AUTH_FAILURES, failureOf, isFailureCode } from "./failures";

/**
 * 실행 모드에 따라 SSO 클라이언트를 고른다.
 *
 *   NEXT_PUBLIC_SSO_MODE=mock (기본) → MockSsoClient
 *   NEXT_PUBLIC_SSO_MODE=real        → WebSocketSsoClient
 *
 * 실구현이 준비되면 .env 값만 바꾸면 된다. 화면 코드는 이 함수만 호출한다.
 */
export function createSsoClient(forcedFailure: SsoFailureCode | null = null): SsoClient {
  if (ssoPublicEnv.mode === "real") {
    return new WebSocketSsoClient();
  }
  return new MockSsoClient(forcedFailure);
}

export const isMockSso = ssoPublicEnv.mode === "mock";

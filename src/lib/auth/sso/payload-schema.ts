import { z } from "zod";
import type { SsoTrayPayload } from "./types";

/**
 * 트레이 페이로드 요청 본문 규격.
 *
 * 페이로드 종류를 태그로 구분한다 (types.ts 의 SsoTrayPayload 와 같은 모양).
 * 하나의 opaque 문자열로 받으면 「지금 모드에 맞는 페이로드인가」를 확인할 수
 * 없다 — 실 모드에 목업 페이로드가 들어오면 임의의 EPID 로 세션이 만들어진다.
 * 실제 거절은 decodeSsoPayload 가 한다.
 *
 * **실제 로그인(api/auth/sso)과 진단 드라이런(api/auth/sso/diag)이 같은 스키마를
 * 쓴다.** 진단이 받아 주는 입력과 로그인이 받아 주는 입력이 다르면, 진단에서
 * 통과한 페이로드가 로그인에서 400 이 되는 일이 생긴다.
 */
export const ssoPayloadSchema: z.ZodType<SsoTrayPayload> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("mock"),
    encoded: z.string().min(1).max(8_192),
  }),
  z.object({
    kind: z.literal("knox"),
    userInfo: z.string().min(1).max(8_192),
    privateKey: z.string().min(1).max(8_192),
  }),
]);

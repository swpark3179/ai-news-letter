import "server-only";

import { ssoPublicEnv, ssoServerEnv } from "@/lib/env";
import type { DecodedUser } from "./types";

/* ===========================================================================
 * ★ 실구현 자리 — 서버 측 SSO 페이로드 디코딩
 * ===========================================================================
 *
 * 브라우저가 트레이 모듈에서 받아 온 `encoded` 문자열을 서버에서 해석해
 * 사용자 정보를 얻는다. 이 함수의 시그니처(입력 string → DecodedUser)는
 * 고정이며, 호출부(app/api/auth/sso/route.ts)는 수정할 필요가 없다.
 *
 * 실구현에서 반드시 처리해야 할 것
 *   1. 복호화        — 알고리즘/모드/IV 규격. 키는 SSO_DECODE_KEY 환경변수
 *   2. 서명 검증     — 사내 인증서버가 서명했는지 (위조 페이로드 차단)
 *   3. 만료 확인     — issuedAt / expiresAt 이 현재 시각 기준 유효한지
 *   4. 대상 확인     — audience 가 이 애플리케이션인지
 *
 * 2~4번을 빠뜨리면 누구든 임의의 사번으로 로그인할 수 있게 되므로
 * 실운영 전환 시 체크리스트로 삼을 것.
 * ------------------------------------------------------------------------ */

export class SsoDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsoDecodeError";
  }
}

export async function decodeSsoPayload(encoded: string): Promise<DecodedUser> {
  if (!encoded || typeof encoded !== "string") {
    throw new SsoDecodeError("페이로드가 비어 있습니다.");
  }

  if (ssoPublicEnv.mode === "real") {
    return decodeReal(encoded);
  }
  return decodeMock(encoded);
}

// ---------------------------------------------------------------------------
// 실구현 (미완성 — 사내 규격 확정 후 채울 것)
// ---------------------------------------------------------------------------

async function decodeReal(encoded: string): Promise<DecodedUser> {
  const key = ssoServerEnv.decodeKey;
  if (!key) {
    throw new SsoDecodeError(
      "SSO_DECODE_KEY 가 설정되지 않았습니다. real 모드에서는 필수입니다.",
    );
  }

  // TODO(사내연동): 아래 4단계를 실제 규격으로 구현
  //
  //   const raw   = Buffer.from(encoded, 'base64');
  //   const iv    = raw.subarray(0, 12);
  //   const tag   = raw.subarray(raw.length - 16);
  //   const data  = raw.subarray(12, raw.length - 16);
  //   const dec   = createDecipheriv('aes-256-gcm', keyBuf, iv);
  //   dec.setAuthTag(tag);
  //   const json  = JSON.parse(Buffer.concat([dec.update(data), dec.final()]).toString());
  //
  //   verifySignature(json);                       // 2. 서명 검증
  //   if (json.exp * 1000 < Date.now()) throw ...;  // 3. 만료 확인
  //   if (json.aud !== 'ai-newsletter') throw ...;  // 4. 대상 확인
  //
  //   return { empNo: json.sub, name: json.name, email: json.email, dept: json.dept };

  void encoded;
  throw new SsoDecodeError(
    "실 SSO 디코딩이 아직 구현되지 않았습니다. src/lib/auth/sso/decode.ts 의 decodeReal() 을 채우세요.",
  );
}

// ---------------------------------------------------------------------------
// 목업 — client.mock.ts 가 만든 "mock.<base64url(json)>" 을 되돌린다
// ---------------------------------------------------------------------------

interface MockPayload {
  empNo?: string;
  name?: string;
  email?: string | null;
  dept?: string | null;
  mock?: boolean;
}

async function decodeMock(encoded: string): Promise<DecodedUser> {
  const body = encoded.startsWith("mock.") ? encoded.slice(5) : encoded;

  let parsed: MockPayload;
  try {
    const normalized = body.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(normalized, "base64").toString("utf8");
    parsed = JSON.parse(json) as MockPayload;
  } catch {
    throw new SsoDecodeError("목업 페이로드를 해석하지 못했습니다.");
  }

  if (!parsed.empNo || !parsed.name) {
    throw new SsoDecodeError("페이로드에 사번 또는 이름이 없습니다.");
  }

  return {
    empNo: String(parsed.empNo),
    name: String(parsed.name),
    email: parsed.email ?? null,
    dept: parsed.dept ?? null,
  };
}

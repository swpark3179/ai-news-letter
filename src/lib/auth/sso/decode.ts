import "server-only";

import { ssoPublicEnv } from "@/lib/env";
import { decodeKnoxPayload } from "./decode-knox";
import { newDecodeTrace, type DecodeTrace } from "./diag-types";
import { SsoDecodeError, type DecodedUser, type SsoTrayPayload } from "./types";

/* ===========================================================================
 * 서버 측 SSO 페이로드 디코딩 — 진입점
 * ===========================================================================
 *
 * 브라우저가 트레이 모듈에서 받아 온 값을 서버에서 해석해 사용자 정보를 얻는다.
 * 호출부(app/api/auth/sso/route.ts)는 이 함수 하나만 본다.
 *
 * 실제 규격이 들어 있는 곳은 decode-knox.ts 다. 이 파일은 세 가지만 한다.
 *   1. 모드와 페이로드 종류가 맞는지 교차 확인
 *   2. 종류에 맞는 디코더 호출
 *   3. 결과를 마지막 관문(assertDecodedUser)에 통과시킨다
 * ------------------------------------------------------------------------ */

/** route.ts 의 기존 import 경로를 유지한다. 정의는 types.ts 에 있다. */
export { SsoDecodeError };

/**
 * [trace] 를 넘기면 어느 전략이 왜 실패했는지가 구조화된 형태로 담긴다. 라우트가
 * 서버 로그에 남기고(진단용 상관 ID 와 함께), 진단 화면이 그대로 표시한다.
 * 넘기지 않아도 동작은 같다.
 */
export async function decodeSsoPayload(
  payload: SsoTrayPayload,
  trace: DecodeTrace = newDecodeTrace(),
): Promise<DecodedUser> {
  const real = ssoPublicEnv.mode === "real";
  trace.kind = payload.kind;

  // 모드와 페이로드 종류가 어긋나면 즉시 거절한다.
  //
  // 이 검사가 없으면 실 모드 배포에 목업 페이로드(누구나 만들 수 있는
  // base64 JSON)를 POST 해서 **임의의 EPID 로 세션을 받을 수 있다.** 종류를
  // 태그로 갖고 다니는 이유가 여기에 있다 (types.ts 의 SsoTrayPayload).
  if (real && payload.kind !== "knox") {
    throw new SsoDecodeError("실 모드에서는 트레이 페이로드만 받습니다.");
  }
  if (!real && payload.kind !== "mock") {
    throw new SsoDecodeError("목업 모드에서는 목업 페이로드만 받습니다.");
  }

  const decoded =
    payload.kind === "knox"
      ? await decodeKnoxPayload(payload, trace)
      : await decodeMock(payload.encoded);

  // 어떤 경로로 왔든 반드시 이 관문을 통과한다.
  return assertDecodedUser(decoded);
}

/**
 * 마지막 관문 — 확인되지 않은 값이 세션·DB 까지 흘러가지 못하게 한다.
 *
 * 진단 드라이런(diagnostics.ts)도 이 함수를 그대로 쓴다 — 진단이 「통과」라고
 * 말한 페이로드가 실제 로그인에서 막히면 진단의 의미가 없기 때문이다. 그래서
 * export 해 두었다. 검사 자체는 여기 한 곳에만 있다.
 *
 * 복호화 규격이 아직 없어도 여기서 할 수 있는 검사는 지금 다 해 둔다. 디코더가
 * 무엇을 돌려주든(전략을 잘못 골라 쓰레기를 뽑았든) 이 함수를 통과해야 한다.
 */
export function assertDecodedUser(u: DecodedUser): DecodedUser {
  const epid = clean(u.epid);
  const empNo = clean(u.empNo) || epid;
  const name = clean(u.name);

  if (!epid) throw new SsoDecodeError("EPID 를 추출하지 못했습니다.");
  if (!name) throw new SsoDecodeError("이름을 추출하지 못했습니다.");

  // 식별자에 허용할 문자 — DB 조회 키이자 로그에 남는 값이라 좁게 잡는다.
  const ID = /^[A-Za-z0-9._@-]{1,64}$/;
  if (!ID.test(epid)) throw new SsoDecodeError("EPID 형식이 올바르지 않습니다.");
  if (!ID.test(empNo)) throw new SsoDecodeError("사번 형식이 올바르지 않습니다.");
  if (name.length > 64) throw new SsoDecodeError("이름 길이가 규격을 벗어났습니다.");

  return {
    epid,
    empNo,
    name,
    email: clean(u.email ?? "") || null,
    dept: clean(u.dept ?? "") || null,
  };
}

/** 앞뒤 공백과 제어문자를 걷어낸다. 로그·DB 로 흘러가는 값이라 여기서 정리한다. */
function clean(v: string | null | undefined): string {
  return (v ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

// ---------------------------------------------------------------------------
// 목업 — client.mock.ts 가 만든 "mock.<base64url(json)>" 을 되돌린다
// ---------------------------------------------------------------------------

interface MockPayload {
  epid?: string;
  empNo?: string;
  name?: string;
  email?: string | null;
  dept?: string | null;
  mock?: boolean;
}

export async function decodeMock(encoded: string): Promise<DecodedUser> {
  const body = encoded.startsWith("mock.") ? encoded.slice(5) : encoded;

  let parsed: MockPayload;
  try {
    const normalized = body.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(normalized, "base64").toString("utf8");
    parsed = JSON.parse(json) as MockPayload;
  } catch {
    throw new SsoDecodeError("목업 페이로드를 해석하지 못했습니다.");
  }

  if (!parsed.name) {
    throw new SsoDecodeError("페이로드에 이름이 없습니다.");
  }

  // 목업에서도 EPID 를 필수로 본다 — 실 경로와 같은 관문을 밟게 하려는 것이다.
  const epid = String(parsed.epid ?? "");
  if (!epid) throw new SsoDecodeError("페이로드에 EPID 가 없습니다.");

  return {
    epid,
    empNo: String(parsed.empNo ?? epid),
    name: String(parsed.name),
    email: parsed.email ?? null,
    dept: parsed.dept ?? null,
  };
}

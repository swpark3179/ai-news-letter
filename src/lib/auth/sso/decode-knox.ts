import "server-only";

import { ssoServerEnv } from "@/lib/env";
import { newDecodeTrace, type DecodeAttempt, type DecodeTrace } from "./diag-types";
import { SsoDecodeError, type DecodedUser } from "./types";

/* ===========================================================================
 * ★ 미확정 규격은 이 파일 하나뿐 ★  Knox SSO 페이로드 디코딩 어댑터
 * ===========================================================================
 *
 * ── 아는 것 (첨부받은 레거시 코드에서) ────────────────────────────────────
 *  · 트레이는 {"data":{"userInfo": …, "key": …}} 를 준다.
 *  · 레거시 브라우저는 이 둘을 각각 userInfo · privateKey 라는 이름으로
 *    ssoLoginService.jsp 에 POST 했다 (ssoLogin.js:18~24).
 *  · 서버는 Secu.decode(str, "SSO") 계열로 풀었다 (Secu.java).
 *  · Secu 의 SSO baseKey 는 코드포인트 1~126 짜리 32글자다 (SecuKeyGen.java 의
 *    makeKey2(32) — 8진 이스케이프로 소스에 박혀 있다).
 *  · 파라미터 이름이 wb64str → 입력은 web-safe base64 로 보인다.
 *  · encode/decode 와 encodeTime/decodeTime 두 쌍이 있다 → 시각이 함께 실리는
 *    변형이 존재한다. 만료 검사를 붙일 자리가 거기다.
 *
 * ── 모르는 것 (SecuBase.java 와 ssoLoginService.jsp 를 받지 못했다) ────────
 *  · 알고리즘 자체. Secu 는 baseKey 만 고르고 실제 암복호화는 부모 클래스
 *    SecuBase 에 있는데 그 파일이 없다.
 *  · privateKey 와 userInfo 의 관계 — 후보 셋
 *      (A) userInfo 를 baseKey 로 풀면 되고 key 는 무결성 확인용
 *      (B) key 를 풀면 세션키가 나오고 그것으로 userInfo 를 푼다
 *      (C) 둘 다 baseKey 로 풀리는 독립된 값
 *  · 평문의 필드 이름 (epid / EPID / knoxId …)
 *  · 시각 필드의 형식과 허용 오차
 *
 * ── 지금 하고 있는 것 ─────────────────────────────────────────────────────
 *  「단순 인코딩」을 가정하고 후보 전략을 순서대로 시도해, EPID 가 나오는 첫
 *  전략을 채택한다. 실제 트레이에 한 번 붙여 보면 어느 전략이 통하는지(또는
 *  전부 실패하는지)가 그대로 드러나고, 그것이 담당자에게 보낼 질문의 근거가 된다.
 *  → docs/SSO_KNOX_PROTOCOL.md
 *
 * ⚠ 이 가정은 **페이로드의 무결성을 확인하지 않는다.** userInfo 가 실제로
 *   base64 평문이라면 누구든 임의의 EPID 로 위조할 수 있다. 그래서 운영 빌드에서는
 *   ssoServerEnv.allowUnverifiedPayload 가 막고 있다 (env.ts 참고).
 *
 * ⇒ 규격이 오면 **이 파일만** 고친다. 시그니처는 고정이다.
 *      decodeKnoxPayload(payload) => Promise<DecodedUser>
 *    STRATEGIES 를 진짜 secuDecode 하나로 바꾸고, allowUnverifiedPayload 게이트를
 *    제거하면 된다. 호출부(decode.ts)·라우트·화면은 손대지 않는다.
 *
 *    무엇을 돌려주든 decode.ts 의 assertDecodedUser 관문을 통과해야 세션까지 간다.
 * =========================================================================== */

/** 한 필드의 최대 길이. 트레이 응답이 이보다 크면 규격 밖이다. */
const MAX_FIELD = 8 * 1024;

/**
 * 「단순 인코딩」 후보. 위에서부터 시도하고 EPID 가 나오는 첫 번째를 채택한다.
 *
 * 실 규격을 받으면 이 배열 전체가 secuDecode 한 줄로 바뀐다.
 */
const STRATEGIES: {
  name: string;
  /**
   * 이 전략을 **시도조차 할 수 없는** 이유. null 이면 시도할 수 있다.
   *
   * 「키가 없어서 못 했다」와 「돌려 봤지만 텍스트가 아니었다」를 갈라 두는 자리다.
   * 앞은 환경변수 문제, 뒤는 규격 문제 — 진단에서 이 둘을 섞으면 엉뚱한 곳을
   * 고치게 된다 (진단 3단계의 전략 표에 그대로 나온다).
   */
  blocked?: (privateKey: string) => string | null;
  run: (userInfo: string, privateKey: string) => string | null;
}[] = [
  // 그대로 JSON/쿼리스트링인 경우. 가장 먼저 보는 이유는 base64 디코딩이
  // 아무 문자열이나 받아 쓰레기를 뱉기 때문이다 — 평문 판정을 먼저 끝낸다.
  { name: "raw-plain", run: (u) => u },

  // web-safe base64 → UTF-8
  { name: "wb64-plain", run: (u) => wb64ToText(u) },

  // base64 디코딩 후 baseKey(SSO_DECODE_KEY) 로 반복 XOR — 후보 (A)/(C)
  {
    name: "wb64-xor-basekey",
    blocked: () =>
      baseKeyBytes()
        ? null
        : "SSO_DECODE_KEY 가 비어 있거나 32바이트로 되돌려지지 않습니다 (환경변수 문제)",
    run: (u) => {
      const key = baseKeyBytes();
      return key ? bytesToText(xor(wb64ToBytes(u), key)) : null;
    },
  },

  // base64 디코딩 후 privateKey 를 키로 반복 XOR — 후보 (B)
  {
    name: "wb64-xor-privatekey",
    blocked: (k) =>
      wb64ToBytes(k).length > 0 ? null : "트레이가 준 key 가 비어 있거나 base64 가 아닙니다",
    run: (u, k) => {
      const key = wb64ToBytes(k);
      return key.length > 0 ? bytesToText(xor(wb64ToBytes(u), key)) : null;
    },
  },
];

export interface KnoxPayload {
  userInfo: string;
  privateKey: string;
}

/**
 * 실 경로 — 무결성 게이트를 통과해야만 디코딩한다.
 *
 * [trace] 를 넘기면 어느 전략이 무엇 때문에 실패했는지, 채택된 전략이 무엇인지가
 * 구조화된 형태로 담긴다. 라우트는 그것을 서버 로그에 남기고, 진단 화면은 그대로
 * 표시한다 — 「단순 인코딩」 가정이 맞는지 확인할 유일한 근거다.
 */
export async function decodeKnoxPayload(
  payload: KnoxPayload,
  trace: DecodeTrace = newDecodeTrace(),
): Promise<DecodedUser> {
  trace.kind = "knox";
  assertPayloadSize(payload);

  // 무결성을 확인할 수단이 없는 동안, 운영 빌드에서는 세션을 내주지 않는다.
  if (!ssoServerEnv.allowUnverifiedPayload) {
    trace.gate = "blocked";
    throw new SsoDecodeError(
      "SecuBase 복호화 규격이 아직 반영되지 않아, 운영 환경에서는 사내 SSO 로그인을 " +
        "허용하지 않습니다. src/lib/auth/sso/decode-knox.ts 를 실제 규격으로 채우세요. " +
        "(임시로 열려면 SSO_ALLOW_UNVERIFIED_PAYLOAD=1 — 위조 위험을 감수하는 것입니다.)",
    );
  }

  trace.gate = "open";
  return runStrategies(payload, trace);
}

/**
 * ★ 진단 드라이런 전용 ★ — 무결성 게이트를 지나쳐 디코딩만 해 본다.
 *
 * 운영에서 실 모드가 게이트에 막혀 있으면 「무엇이 문제인지」를 확인할 방법이
 * 게이트 메시지밖에 없다. 그래서 진단 경로만 게이트를 지나 실제 전략을 돌려 보고,
 * 어느 전략이 통하는지·클레임 키가 무엇인지까지 보고한다.
 *
 * **세션을 발급하는 경로에서는 절대 호출하지 않는다.** 호출부는
 * lib/auth/sso/diagnostics.ts 의 dryRunSso 하나뿐이고, 그 함수는 쿠키를 만들지
 * 않는다. 진단 자체도 토큰(SSO_DEBUG_TOKEN)이나 관리자 세션이 있어야 열린다.
 */
export async function decodeKnoxPayloadForDiagnostics(
  payload: KnoxPayload,
  trace: DecodeTrace,
): Promise<DecodedUser> {
  trace.kind = "knox";
  assertPayloadSize(payload);
  trace.gate = ssoServerEnv.allowUnverifiedPayload ? "open" : "diagnostics-bypass";
  return runStrategies(payload, trace);
}

function assertPayloadSize(payload: KnoxPayload): void {
  if (payload.userInfo.length > MAX_FIELD || payload.privateKey.length > MAX_FIELD) {
    throw new SsoDecodeError("페이로드가 너무 큽니다.");
  }
}

/** 후보 전략을 순서대로 시도하고, EPID 가 나오는 첫 번째를 채택한다. */
async function runStrategies(
  payload: KnoxPayload,
  trace: DecodeTrace,
): Promise<DecodedUser> {
  for (const s of STRATEGIES) {
    const blocked = s.blocked?.(payload.privateKey) ?? null;
    if (blocked) {
      record(trace, { strategy: s.name, outcome: "skipped", detail: blocked });
      continue;
    }

    let text: string | null;
    try {
      text = s.run(payload.userInfo, payload.privateKey);
    } catch (e) {
      record(trace, {
        strategy: s.name,
        outcome: "error",
        detail: e instanceof Error ? e.message : "알 수 없는 예외",
      });
      continue;
    }
    if (!text) {
      record(trace, {
        strategy: s.name,
        outcome: "unreadable",
        detail: "복호화 결과가 유효한 UTF-8 텍스트가 아님 (제어문자가 섞여도 실패로 본다)",
      });
      continue;
    }

    const claims = parseClaims(text);
    if (!claims) {
      record(trace, {
        strategy: s.name,
        outcome: "unreadable",
        detail: "JSON·쿼리스트링 어느 쪽으로도 해석되지 않음",
      });
      continue;
    }

    const user = toDecodedUser(claims);
    if (!user.epid) {
      record(trace, {
        strategy: s.name,
        outcome: "no-epid",
        detail: "클레임은 해석됐지만 EPID 로 볼 필드가 없음",
        claimKeys: Object.keys(claims).slice(0, 24),
      });
      continue;
    }

    record(trace, {
      strategy: s.name,
      outcome: "adopted",
      claimKeys: Object.keys(claims).slice(0, 24),
    });
    trace.adopted = s.name;

    if (process.env.NODE_ENV !== "production") {
      // 실제 트레이를 처음 붙일 때 이 한 줄이 규격을 알려 준다.
      console.warn(
        `[sso] ⚠ 무결성 미검증 디코딩 — 전략 "${s.name}", 클레임 키:`,
        Object.keys(claims),
      );
    }
    return user;
  }

  throw new SsoDecodeError(
    "userInfo 에서 EPID 를 얻지 못했습니다. 「단순 인코딩」 가정이 틀렸을 수 있습니다 — " +
      "SecuBase.java 규격이 필요합니다. 시도한 전략: " +
      summarize(trace),
  );
}

function record(trace: DecodeTrace, attempt: DecodeAttempt): void {
  trace.attempts.push(attempt);
}

/** 기존 오류 메시지 형식을 유지한다 — "이름(이유)" 를 " / " 로 이었다. */
function summarize(trace: DecodeTrace): string {
  const REASON: Record<DecodeAttempt["outcome"], string> = {
    adopted: "채택",
    skipped: "건너뜀",
    unreadable: "해석 불가",
    "no-epid": "EPID 없음",
    error: "예외",
  };
  return trace.attempts
    .map((a) => {
      const keys = a.claimKeys?.length ? `: ${a.claimKeys.slice(0, 12).join(",")}` : "";
      return `${a.strategy}(${REASON[a.outcome]}${keys})`;
    })
    .join(" / ");
}

/**
 * 평문을 클레임 맵으로.
 *
 * 두 형태를 받는다.
 *   · JSON 객체            {"EPID":"...","USER_NM":"..."}
 *   · 쿼리스트링            EPID=...&USER_NM=...       ← 사내 시스템에 흔한 형태
 */
export function parseClaims(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t) return null;

  if (t.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(t);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* 쿼리스트링일 수 있으므로 계속 */
    }
  }

  // key=value 쌍이 하나도 없으면 복호화가 안 된 쓰레기다.
  if (!/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(t)) return null;

  const out: Record<string, unknown> = {};
  for (const [k, v] of new URLSearchParams(t)) out[k] = v;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 클레임 맵 → DecodedUser.
 *
 * 필드 이름이 확정되지 않아 후보를 순서대로 본다. 규격이 오면 첫 항목만 남긴다.
 * 여기서 뽑아낸 EPID 가 곧 「성공」의 기준이자 등록사용자 대조의 키다.
 */
export function toDecodedUser(c: Record<string, unknown>): DecodedUser {
  const epid = pick(c, ["epid", "EPID", "epId", "EP_ID", "knoxId", "KNOXID", "knoxID"]);
  const empNo = pick(c, [
    "empNo",
    "EMPNO",
    "emp_no",
    "EMP_NO",
    "sabun",
    "SABUN",
    "employeeNo",
    "USER_ID",
    "userId",
  ]);
  const name = pick(c, ["name", "userName", "USER_NM", "userNm", "korName", "KOR_NM", "empName"]);
  const email = pick(c, ["email", "EMAIL", "mail", "MAIL", "mailAddr", "EMAIL_ADDR"]);
  const dept = pick(c, ["dept", "DEPT", "deptName", "DEPT_NM", "deptNm", "orgName", "department"]);

  return {
    epid,
    // 사번이 따로 안 실려 오면 EPID 를 그대로 쓴다. 이 경우 사번 폴백 조회는
    // 아무것도 못 찾고 EPID 로만 대조된다 — 틀린 사번을 지어내는 것보다 낫다.
    empNo: empNo || epid,
    name,
    email: email || null,
    dept: dept || null,
  };
}

function pick(c: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = c[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

// ---------------------------------------------------------------------------
// 인코딩 유틸
// ---------------------------------------------------------------------------

function wb64ToBytes(s: string): Uint8Array {
  const norm = s.trim().replace(/-/g, "+").replace(/_/g, "/");
  return new Uint8Array(Buffer.from(norm, "base64"));
}

function wb64ToText(s: string): string | null {
  const bytes = wb64ToBytes(s);
  return bytes.length > 0 ? bytesToText(bytes) : null;
}

/**
 * UTF-8 로 해석하되, 복호화가 틀려 쓰레기가 나온 경우를 걸러 낸다.
 *
 * 이 걸러 내기가 전략 선택의 핵심이다. base64 디코딩은 아무 입력이나 받아
 * 바이트를 뱉으므로, 「해석이 되는가」를 여기서 판정하지 않으면 첫 전략이 항상
 * 이겨 버린다.
 */
function bytesToText(bytes: Uint8Array): string | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null; // 유효한 UTF-8 이 아니면 이 전략은 틀린 것이다
  }
  // 제어문자가 섞여 있어도 복호화 실패로 본다 (탭 \t · 개행 \n \r 은 허용).
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
  return text;
}

function xor(data: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
  return out;
}

function baseKeyBytes(): Uint8Array | null {
  const raw = ssoServerEnv.decodeKey;
  if (!raw) return null;
  try {
    return decodeBaseKey(raw);
  } catch {
    return null;
  }
}

/**
 * SSO_DECODE_KEY 를 32바이트로 되돌린다.
 *
 * 두 표기를 받는다.
 *   · Java 소스의 8진 이스케이프 — "\47\10\167\32…"  (Secu.java 에서 그대로 복사)
 *   · base64                     — .env 에 넣기 안전한 형태 (**권장**)
 *
 * SecuKeyGen.makeKey2 가 코드포인트 1~126 만 쓰므로 한 글자 = 1바이트다.
 * .env 파일에는 제어문자를 그대로 담을 수 없어 base64 쪽을 권한다.
 */
export function decodeBaseKey(raw: string): Uint8Array {
  const s = raw.trim();

  const octal = s.match(/\\[0-7]{1,3}/g);
  const bytes = octal
    ? Uint8Array.from(octal.map((m) => parseInt(m.slice(1), 8)))
    : wb64ToBytes(s);

  if (bytes.length !== 32) {
    throw new SsoDecodeError(
      `SSO_DECODE_KEY 가 32바이트가 아닙니다 (${bytes.length}바이트). ` +
        "Secu.java 의 SSO baseKey 를 8진 이스케이프 그대로 넣거나 base64 로 바꿔 넣으세요.",
    );
  }
  return bytes;
}

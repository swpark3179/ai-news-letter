import "server-only";

import {
  constants as cryptoConstants,
  createDecipheriv,
  createPrivateKey,
  privateDecrypt,
  type KeyObject,
} from "node:crypto";
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
 * ── 나중에 알아낸 것 (레거시 운영 코드의 `rsaprivkey8`) ───────────────────
 *  레거시 서버가 **RSA 개인키**를 들고 있었다. 대칭키(baseKey)만으로 푸는 구조가
 *  아니라는 뜻이다 — 위 후보 중 (B)에 해당하는 하이브리드 암호로 보인다.
 *
 *      트레이의 key      = 세션키를 서버 공개키로 암호화한 것
 *      트레이의 userInfo = 그 세션키로 암호화한 사용자 정보
 *
 *  그래서 SSO_RSA_PRIVATE_KEY 가 설정돼 있으면 RSA 계열 전략을 **먼저** 돌린다.
 *  세션키를 푼 뒤 대칭 알고리즘(모드·IV)까지는 여전히 확정되지 않아 몇 가지를
 *  차례로 시도하고, 통한 조합을 추적(trace)에 남긴다 — 그것이 곧 규격 확인이다.
 *
 * ── 아직 모르는 것 ───────────────────────────────────────────────────────
 *  · RSA 패딩 (PKCS#1 v1.5 인지 OAEP 인지) — 세 가지를 차례로 시도한다.
 *  · 대칭 알고리즘·모드·IV 위치 — 네 가지 조합을 시도한다.
 *  · 평문의 필드 이름 (epid / EPID / knoxId …)
 *  · 시각 필드의 형식과 허용 오차 (encodeTime 계열이라면)
 *
 * ⚠ **RSA 복호화가 성공해도 위조를 막는 것은 아니다.** 공개키는 공개된 값이라
 *   그것을 가진 사람은 누구든 페이로드를 만들 수 있다 — 기밀성이지 인증이 아니다.
 *   그래서 운영 빌드의 게이트(ssoServerEnv.allowUnverifiedPayload)는 그대로 둔다.
 *   다만 RSA 키가 설정돼 있으면 **평문 전략은 아예 닫는다** — 진짜 키가 있는데도
 *   base64 평문을 받아 주면 그쪽이 그대로 위조 통로가 되기 때문이다.
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
 * 한 번의 디코딩 시도가 공유하는 값.
 *
 * RSA 로 세션키를 푸는 일은 여러 전략이 똑같이 필요로 하므로 한 번만 하고
 * 결과(성공이든 실패든)를 나눠 쓴다. 실패 이유도 그대로 실어 두어야 전략마다
 * 「왜 못 했는지」를 각각 적을 수 있다.
 */
interface DecodeContext {
  userInfo: string;
  /** 트레이가 준 `key` 필드. 레거시 POST 파라미터 이름이 privateKey 였다. */
  privateKey: string;
  session: SessionKey;
  /**
   * 마지막으로 통한 세션키 후보의 설명. 전략이 채워 두면 detail() 이 읽어
   * 추적에 남긴다 — 어느 조합이 맞았는지가 이 작업의 결과물이다.
   */
  hit?: string;
}

/**
 * RSA 로 푼 세션키 **후보들**. error 가 차 있으면 대칭 전략은 전부 건너뛴다.
 *
 * 후보가 여럿인 이유: 푼 결과가 곧바로 키일 수도, 키를 base64·hex 로 적은
 * 문자열일 수도 있다. 규격을 모르는 동안에는 하나만 고르지 않고 전부 시험한다.
 */
type SessionKey =
  | { ok: true; candidates: SessionKeyCandidate[] }
  | { ok: false; error: string };

interface SessionKeyCandidate {
  bytes: Uint8Array;
  /** 이 후보를 어떻게 얻었는지 — 통한 조합이 곧 규격이라 추적에 남긴다. */
  how: string;
}

/**
 * 후보 전략. 위에서부터 시도하고 EPID 가 나오는 첫 번째를 채택한다.
 *
 * **순서가 곧 보안 결정이다.** RSA 계열을 먼저 두고, 평문 계열은 RSA 키가
 * 없을 때만 열린다 (buildStrategies). 진짜 키를 들고도 base64 평문을 받아 주면
 * 그 경로가 위조 통로가 된다.
 *
 * 규격이 확정되면 이 배열 전체가 secuDecode 한 줄로 바뀐다.
 */
interface Strategy {
  name: string;
  /**
   * 이 전략을 **시도조차 할 수 없는** 이유. null 이면 시도할 수 있다.
   *
   * 「키가 없어서 못 했다」와 「돌려 봤지만 텍스트가 아니었다」를 갈라 두는 자리다.
   * 앞은 환경변수 문제, 뒤는 규격 문제 — 진단에서 이 둘을 섞으면 엉뚱한 곳을
   * 고치게 된다 (진단 3단계의 전략 표에 그대로 나온다).
   */
  blocked?: (ctx: DecodeContext) => string | null;
  run: (ctx: DecodeContext) => string | null;
  /** 성공했을 때 추적에 남길 한 줄 — 어느 조합이 통했는지가 곧 규격이다. */
  detail?: (ctx: DecodeContext) => string | undefined;
}

/** RSA 개인키가 필요한 전략들. 세션키를 푼 뒤 대칭 조합을 하나씩 시험한다. */
const RSA_STRATEGIES: Strategy[] = [
  // (B) key → 세션키 → userInfo. 모드·IV 위치만 다른 네 갈래다.
  symStrategy("rsa-key→aes-cbc-iv", (data, key) => aesDecrypt(data, key, "cbc", "prefix")),
  symStrategy("rsa-key→aes-cbc-zero", (data, key) => aesDecrypt(data, key, "cbc", "zero")),
  symStrategy("rsa-key→aes-ecb", (data, key) => aesDecrypt(data, key, "ecb", "none")),
  symStrategy("rsa-key→xor", (data, key) => bytesToText(xor(data, key))),

  // userInfo 자체를 개인키로 푸는 경우 (짧은 페이로드라면 가능하다).
  {
    name: "rsa-userinfo",
    blocked: () => (rsaKey() ? null : "SSO_RSA_PRIVATE_KEY 가 없습니다 (환경변수 문제)"),
    run: (ctx) => {
      for (const o of rsaDecryptAll(wb64ToBytes(ctx.userInfo))) {
        const text = bytesToText(o.bytes);
        if (text) {
          ctx.hit = `rsa-${o.padding}`;
          return text;
        }
      }
      return null;
    },
    detail: (ctx) => ctx.hit,
  },
];

/** RSA 키가 없을 때만 여는 「단순 인코딩」 후보. */
const PLAIN_STRATEGIES: Strategy[] = [
  // 그대로 JSON/쿼리스트링인 경우. 가장 먼저 보는 이유는 base64 디코딩이
  // 아무 문자열이나 받아 쓰레기를 뱉기 때문이다 — 평문 판정을 먼저 끝낸다.
  { name: "raw-plain", run: (ctx) => ctx.userInfo },

  // web-safe base64 → UTF-8
  { name: "wb64-plain", run: (ctx) => wb64ToText(ctx.userInfo) },

  // base64 디코딩 후 baseKey(SSO_DECODE_KEY) 로 반복 XOR — 후보 (A)/(C)
  {
    name: "wb64-xor-basekey",
    blocked: () =>
      baseKeyBytes()
        ? null
        : "SSO_DECODE_KEY 가 비어 있거나 32바이트로 되돌려지지 않습니다 (환경변수 문제)",
    run: (ctx) => {
      const key = baseKeyBytes();
      return key ? bytesToText(xor(wb64ToBytes(ctx.userInfo), key)) : null;
    },
  },

  // base64 디코딩 후 트레이가 준 key 를 그대로 키로 반복 XOR — 후보 (B)의 평문판
  {
    name: "wb64-xor-privatekey",
    blocked: (ctx) =>
      wb64ToBytes(ctx.privateKey).length > 0
        ? null
        : "트레이가 준 key 가 비어 있거나 base64 가 아닙니다",
    run: (ctx) => {
      const key = wb64ToBytes(ctx.privateKey);
      return key.length > 0 ? bytesToText(xor(wb64ToBytes(ctx.userInfo), key)) : null;
    },
  },
];

/**
 * 이번 시도에 쓸 전략 목록.
 *
 * RSA 개인키가 설정돼 있으면 평문 전략을 **닫는다**. 「혹시 모르니 남겨 두자」가
 * 곧 위조 통로다 — 공격자는 항상 가장 약한 전략을 고른다.
 */
function buildStrategies(): { list: Strategy[]; plainClosed: boolean } {
  if (rsaKey()) return { list: RSA_STRATEGIES, plainClosed: true };
  return { list: [...PLAIN_STRATEGIES, ...RSA_STRATEGIES], plainClosed: false };
}

/** 세션키로 userInfo 를 푸는 전략을 만든다 — 대칭 조합만 갈아 끼운다. */
function symStrategy(
  name: string,
  decrypt: (data: Uint8Array, key: Uint8Array) => string | null,
): Strategy {
  return {
    name,
    blocked: (ctx) => (ctx.session.ok ? null : ctx.session.error),
    run: (ctx) => {
      if (!ctx.session.ok) return null;
      const data = wb64ToBytes(ctx.userInfo);
      for (const c of ctx.session.candidates) {
        const text = decrypt(data, c.bytes);
        if (text) {
          ctx.hit = c.how;
          return text;
        }
      }
      return null;
    },
    detail: (ctx) => ctx.hit,
  };
}

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
  const ctx: DecodeContext = {
    userInfo: payload.userInfo,
    privateKey: payload.privateKey,
    session: openSessionKey(payload.privateKey),
  };
  const { list, plainClosed } = buildStrategies();

  // 닫아 둔 것도 추적에 남긴다 — 「왜 raw-plain 이 안 보이지?」로 헤매지 않게.
  if (plainClosed) {
    for (const s of PLAIN_STRATEGIES) {
      record(trace, {
        strategy: s.name,
        outcome: "skipped",
        detail: "RSA 개인키가 설정돼 있어 평문 전략은 닫혀 있습니다 (위조 방지)",
      });
    }
  }

  for (const s of list) {
    const blocked = s.blocked?.(ctx) ?? null;
    if (blocked) {
      record(trace, { strategy: s.name, outcome: "skipped", detail: blocked });
      continue;
    }

    let text: string | null;
    try {
      text = s.run(ctx);
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
      detail: s.detail?.(ctx),
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
    "userInfo 에서 EPID 를 얻지 못했습니다. 가정한 조합 중 맞는 것이 없습니다 — " +
      "SecuBase.java(또는 ssoLoginService.jsp) 규격이 필요합니다. 시도한 전략: " +
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

// ---------------------------------------------------------------------------
// RSA — 레거시의 rsaprivkey8 에 해당하는 자리
// ---------------------------------------------------------------------------

/**
 * RSA 패딩 후보. 레거시 Java 의 기본값(`RSA/ECB/PKCS1Padding`)을 먼저 본다.
 *
 * ⚠ **성공한 첫 패딩을 정답으로 삼으면 안 된다.** OpenSSL 3 은 PKCS#1 v1.5
 * 복호화에 「암묵적 거부(implicit rejection)」를 적용해서, 패딩이 틀려도 예외를
 * 던지지 않고 **임의 길이의 쓰레기**를 돌려준다 (Bleichenbacher 대응).
 * 실제로 OAEP 암문을 pkcs1 으로 풀면 3바이트짜리 쓰레기가 나온다.
 *
 * 그래서 모든 패딩을 다 돌려 후보로 모으고, 판정은 그다음 단계(세션키 길이 ·
 * 대칭 복호화 결과)에 맡긴다.
 */
const RSA_PADDINGS = [
  { name: "pkcs1", opts: { padding: cryptoConstants.RSA_PKCS1_PADDING } },
  {
    name: "oaep-sha1",
    opts: { padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
  },
  {
    name: "oaep-sha256",
    opts: { padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
  },
] as const;

/** 파싱된 개인키를 프로세스 수명 동안 재사용한다. 환경변수는 런타임에 안 바뀐다. */
let rsaCache: { raw: string; key: KeyObject | null } | null = null;

function rsaKey(): KeyObject | null {
  const raw = ssoServerEnv.rsaPrivateKey.trim();
  if (!raw) return null;
  if (rsaCache?.raw === raw) return rsaCache.key;

  let key: KeyObject | null = null;
  try {
    key = parseRsaPrivateKey(raw, ssoServerEnv.rsaPrivateKeyPassphrase).key;
  } catch {
    key = null; // 이유는 진단 화면이 parseRsaPrivateKey 를 직접 불러 보여 준다
  }
  rsaCache = { raw, key };
  return key;
}

/** 개인키로 푼 결과 — 패딩마다 하나씩. 어느 것이 진짜인지는 여기서 못 정한다. */
function rsaDecryptAll(data: Uint8Array): { bytes: Uint8Array; padding: string }[] {
  const key = rsaKey();
  if (!key || data.length === 0) return [];

  const out: { bytes: Uint8Array; padding: string }[] = [];
  for (const p of RSA_PADDINGS) {
    try {
      const plain = privateDecrypt({ key, ...p.opts }, Buffer.from(data));
      out.push({ bytes: new Uint8Array(plain), padding: p.name });
    } catch {
      /* OAEP 는 틀리면 예외다. pkcs1 은 예외 없이 쓰레기를 준다 — 위 주석 참고 */
    }
  }
  return out;
}

/**
 * 트레이가 준 key 를 풀어 대칭 세션키를 얻는다.
 *
 * 푼 결과가 곧바로 키 길이(16·24·32바이트)면 그대로 쓰고, 아니면 텍스트로 보고
 * base64·hex·그대로를 차례로 시험한다. 사내 코드에서 「16글자 문자열을 키로
 * 쓴다」가 드물지 않아 마지막 후보를 남겨 두었다.
 */
function openSessionKey(privateKeyField: string): SessionKey {
  if (!rsaKey()) return { ok: false, error: "SSO_RSA_PRIVATE_KEY 가 없습니다 (환경변수 문제)" };

  const cipher = wb64ToBytes(privateKeyField);
  if (cipher.length === 0) {
    return { ok: false, error: "트레이가 준 key 가 비어 있거나 base64 가 아닙니다" };
  }

  const opened = rsaDecryptAll(cipher);
  if (opened.length === 0) {
    return {
      ok: false,
      error:
        "개인키로 key 를 풀지 못했습니다 (pkcs1 · oaep-sha1 · oaep-sha256 모두 실패). " +
        "키가 이 서비스용이 아니거나, key 가 RSA 로 싸인 값이 아닙니다.",
    };
  }

  const candidates = opened.flatMap((o) =>
    sessionKeyCandidates(o.bytes).map((c) => ({
      bytes: c.bytes,
      how: `rsa-${o.padding} · 세션키 ${c.how}`,
    })),
  );
  if (candidates.length > 0) return { ok: true, candidates: dedupeKeys(candidates) };

  return {
    ok: false,
    error:
      "개인키로 풀리기는 했지만 어느 패딩에서도 대칭키 길이(16·24·32바이트)가 나오지 않았습니다 — " +
      opened.map((o) => `${o.padding} ${o.bytes.length}바이트`).join(" · "),
  };
}

/** 푼 바이트열을 대칭키로 볼 수 있는 후보들. 앞에서부터 그럴듯한 순서다. */
function sessionKeyCandidates(bytes: Uint8Array): SessionKeyCandidate[] {
  const out: SessionKeyCandidate[] = [];
  const keyish = (b: Uint8Array) => b.length === 16 || b.length === 24 || b.length === 32;

  if (keyish(bytes)) out.push({ bytes, how: `원문 ${bytes.length}바이트` });

  const text = tryUtf8(bytes);
  if (text) {
    const t = text.trim();
    const ascii = new Uint8Array(Buffer.from(t, "utf8"));
    if (keyish(ascii)) out.push({ bytes: ascii, how: `문자열 ${ascii.length}자` });

    for (const [enc, label] of [
      ["base64", "base64"],
      ["hex", "hex"],
    ] as const) {
      try {
        const dec = new Uint8Array(Buffer.from(t, enc));
        if (keyish(dec)) out.push({ bytes: dec, how: `${label} → ${dec.length}바이트` });
      } catch {
        /* 그 표기가 아니면 넘어간다 */
      }
    }
  }

  return out;
}

/** 같은 바이트열이 여러 경로로 나올 수 있다 (32바이트가 그대로 32자 문자열인 경우). */
function dedupeKeys(list: SessionKeyCandidate[]): SessionKeyCandidate[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = Buffer.from(c.bytes).toString("hex");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 세션키로 AES 복호화.
 *
 * [iv] — prefix: 암호문 앞 16바이트가 IV · zero: 0으로 채운 IV · none: ECB.
 * 패딩은 PKCS#7 을 먼저 보고, 거기서 예외가 나면 패딩 없이 풀어 꼬리를 직접
 * 걷어낸다 (제로 패딩을 쓰는 구현이 있다).
 */
function aesDecrypt(
  data: Uint8Array,
  key: Uint8Array,
  mode: "cbc" | "ecb",
  iv: "prefix" | "zero" | "none",
): string | null {
  const bits = key.length * 8;
  if (bits !== 128 && bits !== 192 && bits !== 256) return null;

  let body = data;
  let ivBytes = Buffer.alloc(0);
  if (mode === "cbc") {
    if (iv === "prefix") {
      if (data.length <= 16) return null;
      ivBytes = Buffer.from(data.slice(0, 16));
      body = data.slice(16);
    } else {
      ivBytes = Buffer.alloc(16, 0);
    }
  }
  if (body.length === 0 || body.length % 16 !== 0) return null;

  const algo = `aes-${bits}-${mode}`;
  for (const autoPad of [true, false]) {
    try {
      const d = createDecipheriv(algo, Buffer.from(key), mode === "ecb" ? null : ivBytes);
      d.setAutoPadding(autoPad);
      const out = Buffer.concat([d.update(Buffer.from(body)), d.final()]);
      const text = bytesToText(autoPad ? out : stripPadding(new Uint8Array(out)));
      if (text) return text;
    } catch {
      /* 패딩이 안 맞으면 다음 시도 */
    }
  }
  return null;
}

/** PKCS#7 · 제로 패딩을 걷어낸다. 어느 쪽도 아니면 그대로 둔다. */
function stripPadding(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0) return bytes;
  const last = bytes[bytes.length - 1];
  if (last > 0 && last <= 16 && last <= bytes.length) {
    const tail = bytes.slice(bytes.length - last);
    if (tail.every((b) => b === last)) return bytes.slice(0, bytes.length - last);
  }
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return bytes.slice(0, end);
}

function tryUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export interface ParsedRsaKey {
  key: KeyObject;
  /** 어느 표기로 읽었는지 — 진단 화면에 그대로 보여 준다. */
  notation: "PEM" | "PEM(\\n 이스케이프)" | "base64(PEM)" | "base64(DER PKCS#8)" | "base64(DER PKCS#1)";
  /** 모듈러스 길이(비트). 2048 이 보통이다. */
  bits: number;
}

/**
 * SSO_RSA_PRIVATE_KEY 를 KeyObject 로.
 *
 * 표기를 네 가지 받는 이유는 넣는 곳이 제각각이기 때문이다. Vercel 대시보드는
 * 여러 줄을 그대로 받지만 `.env` 파일은 못 받고, 사내에서 건네받는 형태도
 * `.pem`·`.key`·base64 문자열로 갈린다. **base64 로 감싸 넣는 것을 권한다** —
 * 줄바꿈이 사라져도 깨지지 않는 유일한 형태다.
 */
export function parseRsaPrivateKey(raw: string, passphrase = ""): ParsedRsaKey {
  const s = raw.trim();
  if (!s) throw new SsoDecodeError("SSO_RSA_PRIVATE_KEY 가 비어 있습니다.");

  const pass = passphrase.trim() ? { passphrase: passphrase.trim() } : {};
  const attempts: { notation: ParsedRsaKey["notation"]; make: () => KeyObject }[] = [];

  if (s.includes("-----BEGIN")) {
    const escaped = /\\n/.test(s);
    const pem = s.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
    attempts.push({
      notation: escaped ? "PEM(\\n 이스케이프)" : "PEM",
      make: () => createPrivateKey({ key: pem, format: "pem", ...pass }),
    });
  } else {
    const der = Buffer.from(s.replace(/\s+/g, ""), "base64");
    const asText = der.toString("utf8");
    if (asText.includes("-----BEGIN")) {
      attempts.push({
        notation: "base64(PEM)",
        make: () => createPrivateKey({ key: asText, format: "pem", ...pass }),
      });
    } else {
      attempts.push({
        notation: "base64(DER PKCS#8)",
        make: () => createPrivateKey({ key: der, format: "der", type: "pkcs8", ...pass }),
      });
      attempts.push({
        notation: "base64(DER PKCS#1)",
        make: () => createPrivateKey({ key: der, format: "der", type: "pkcs1", ...pass }),
      });
    }
  }

  let last = "";
  for (const a of attempts) {
    try {
      const key = a.make();
      if (key.asymmetricKeyType !== "rsa") {
        throw new Error(`RSA 가 아닌 ${key.asymmetricKeyType} 키입니다.`);
      }
      const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
      return { key, notation: a.notation, bits };
    } catch (e) {
      last = e instanceof Error ? e.message : "알 수 없는 오류";
    }
  }

  throw new SsoDecodeError(
    `SSO_RSA_PRIVATE_KEY 를 개인키로 읽지 못했습니다 (${last}). PEM 그대로, 개행을 ` +
      "\\n 으로 이스케이프한 PEM, PEM 또는 DER 을 base64 로 감싼 값을 받습니다. " +
      "암호화된 PEM 이면 SSO_RSA_PRIVATE_KEY_PASSPHRASE 도 넣으세요.",
  );
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

import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import {
  KST_TZ,
  normalizeSupabaseUrl,
  runtimeEnvValue,
  sessionEnv,
  ssoDebugEnv,
  ssoPublicEnv,
  ssoServerEnv,
} from "@/lib/env";
import { GUEST_COOKIE, SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { MEMBERS_EPID_MISSING, isMissingColumnError } from "@/lib/supabase/schema";
import type { MemberRow } from "@/types/db";
import { assertDecodedUser, decodeMock } from "./decode";
import {
  decodeBaseKey,
  decodeKnoxPayloadForDiagnostics,
  parseRsaPrivateKey,
} from "./decode-knox";
import {
  DIAG_TOKEN_HEADER,
  newDecodeTrace,
  type DiagCheck,
  type DiagGroup,
  type DiagVerdict,
  type MemberProbe,
  type SsoDiagSnapshot,
  type SsoDryRun,
} from "./diag-types";
import { analyzeField } from "./shape";
import type { DecodedUser, SsoTrayPayload } from "./types";

/* ===========================================================================
 * SSO 진단 — 「로직 문제인가, 변수 로드 문제인가」를 가른다
 * ===========================================================================
 *
 * 로그인이 안 될 때 원인 후보가 세 층으로 나뉜다.
 *
 *   (A) 변수 로드   배포에 값이 없거나, 값을 넣었지만 빌드에 박힌 옛 값이 돌고 있다.
 *   (B) 연동 로직   변수는 정상인데 트레이 통신·복호화 규격·등록 대조가 어긋난다.
 *   (C) DB 스키마   둘 다 정상인데 배포된 DB 에 코드가 쓰는 컬럼이 없다
 *                   (수동 적용이라 실제로 생긴다 — members-epid 항목).
 *
 * 화면만 보면 셋이 똑같이 「SSO_TRAY_NOT_RUNNING」이나 「디코딩 실패」·「미등록」으로
 * 보인다. 그래서 이 파일이 (A)를 먼저 전부 확인해 주고, (A)가 깨끗할 때만 (B)·(C)를
 * 의심하게 만든다. 화면은 app/login/diag, 입구는 api/auth/sso/diag 다.
 *
 * ⚠ 여기서 나가는 값은 전부 마스킹·모양 요약이다. 복호화 키·서비스 롤 키·세션
 *   시크릿은 **존재 여부와 길이만** 담는다 (mask · shape 참고).
 * ------------------------------------------------------------------------ */

// ---------------------------------------------------------------------------
// 접근 통제
// ---------------------------------------------------------------------------

export type DiagAccess =
  | { ok: true; via: "dev" | "token" | "admin" }
  | { ok: false; status: 403; message: string };

/**
 * 진단을 열어도 되는지.
 *
 * 세션을 요구하지 않는 것이 핵심이다 — 진단해야 하는 상황이 바로 「로그인이 안
 * 되는 상황」이라, 로그인을 요구하면 쓸 수 없다. 대신 셋 중 하나를 요구한다.
 *
 *   admin  이미 관리자 세션이 있다 (다른 기기에서 들어온 경우)
 *   token  SSO_DEBUG_TOKEN 과 일치하는 값을 헤더·쿼리로 보냈다
 *   dev    운영 빌드가 아니다 (개발·스테이징은 그냥 열어 둔다)
 */
export async function authorizeDiag(req: Request): Promise<DiagAccess> {
  const jar = await cookies();
  const cookie = jar.get(SESSION_COOKIE)?.value;
  if (cookie) {
    const payload = await verifySession(cookie);
    if (payload?.isAdmin) return { ok: true, via: "admin" };
  }

  const expected = ssoDebugEnv.token;
  const supplied = suppliedToken(req);
  if (expected && supplied && sameSecret(supplied, expected)) {
    return { ok: true, via: "token" };
  }

  if (ssoDebugEnv.openWithoutToken) return { ok: true, via: "dev" };

  return {
    ok: false,
    status: 403,
    message: expected
      ? "진단 토큰이 올바르지 않습니다. SSO_DEBUG_TOKEN 값을 확인하세요."
      : "SSO_DEBUG_TOKEN 이 설정되지 않아 운영 배포에서는 진단이 닫혀 있습니다. " +
        "환경변수에 임의의 값을 넣고 재배포한 뒤 /login/diag?token=<값> 으로 여세요.",
  };
}

function suppliedToken(req: Request): string {
  const header = req.headers.get(DIAG_TOKEN_HEADER);
  if (header?.trim()) return header.trim();
  try {
    return new URL(req.url).searchParams.get("token")?.trim() ?? "";
  } catch {
    return "";
  }
}

/** 길이까지 감추기 위해 양쪽을 해시한 뒤 상수 시간 비교한다. */
function sameSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// ---------------------------------------------------------------------------
// 1단계 — 환경변수 · DB 스냅샷
// ---------------------------------------------------------------------------

export async function collectSsoDiagnostics(
  req: Request,
  via: "dev" | "token" | "admin",
): Promise<SsoDiagSnapshot> {
  const groups: DiagGroup[] = [
    publicEnvGroup(),
    serverEnvGroup(),
    await sessionGroup(req),
    await supabaseGroup(),
  ];

  return {
    at: new Date().toISOString(),
    via,
    runtime: {
      nodeEnv: process.env.NODE_ENV ?? "(없음)",
      nextRuntime: runtimeEnvValue("NEXT_RUNTIME") ?? "nodejs",
      vercelEnv: runtimeEnvValue("VERCEL_ENV") ?? null,
      region: runtimeEnvValue("VERCEL_REGION") ?? null,
      serverTimeKst: new Date().toLocaleString("ko-KR", { timeZone: KST_TZ }),
    },
    groups,
    verdict: verdictFor(groups),
  };
}

/**
 * 같은 이름의 환경변수를 두 갈래로 읽는다.
 *
 *   compiled  코드가 보는 값 (NEXT_PUBLIC_ 은 빌드 시점에 박힌다)
 *   runtime   프로세스가 지금 가진 값
 *
 * 이 둘이 다르면 「값은 넣었는데 재배포하지 않은」 상태다. 증상은 로직 오류처럼
 * 보이지만 원인은 변수 로드다 — 이 진단의 존재 이유이기도 하다.
 */
interface EnvPair {
  name: string;
  compiled: string;
  runtime: string;
  /** 정규화 전의 런타임 값 — 「비어 있음」과 「기본값으로 접힘」을 갈라야 한다. */
  runtimeRaw: string;
  mismatch: boolean;
}

function envPair(
  name: string,
  compiled: string,
  normalize: (v: string) => string = (v) => v,
): EnvPair {
  const raw = (runtimeEnvValue(name) ?? "").trim();
  const c = normalize(compiled.trim());
  const r = normalize(raw);
  return { name, compiled: c, runtime: r, runtimeRaw: raw, mismatch: c !== r };
}

function shown(v: string): string {
  return v ? `"${v}"` : "(비어 있음)";
}

/**
 * 브라우저로 나가는 SSO 변수.
 *
 * 여기서 「빌드에 박힌 값」과 「프로세스가 지금 가진 값」을 나란히 본다. 이 둘이
 * 다른 것이 **가장 흔한 「변수 로드 문제」**다 — Vercel 에 값을 넣고 재배포하지
 * 않으면 화면은 계속 옛 값으로 동작하고, 증상은 「인증 모듈 미실행」으로 보인다.
 */
function publicEnvGroup(): DiagGroup {
  const checks: DiagCheck[] = [];

  const mode = envPair("NEXT_PUBLIC_SSO_MODE", ssoPublicEnv.mode, (v) =>
    v === "real" ? "real" : "mock",
  );
  const wsUrl = envPair("NEXT_PUBLIC_SSO_TRAY_WS_URL", ssoPublicEnv.trayWsUrl);
  const appCode = envPair("NEXT_PUBLIC_SSO_TRAY_APP_CODE", ssoPublicEnv.trayAppCode);
  const real = ssoPublicEnv.mode === "real";

  checks.push({
    id: "mode",
    label: "NEXT_PUBLIC_SSO_MODE (코드가 보는 값)",
    status: "ok",
    value: ssoPublicEnv.mode,
    detail: real
      ? "실 모드 — 트레이 모듈(getknoxsso)에 붙는다."
      : "목업 모드 — 트레이에 붙지 않고 화면만 시뮬레이션한다. 실 연동을 시험하려면 real 로 두고 재배포해야 한다.",
  });

  // 어긋난 방향까지 갈라 본다.
  //
  //   런타임에 값이 있는데 빌드가 다르다  → 값을 바꾸고 재배포하지 않았다 (막고 있다)
  //   런타임에는 값이 없고 빌드에만 있다  → 빌드 때만 값을 준 것이다 (지금은 동작한다)
  //
  // 둘을 같은 등급으로 묶으면, 정작 고쳐야 하는 앞의 경우가 뒤섞여 묻힌다.
  const stale = [mode, wsUrl, appCode].filter((p) => p.mismatch);
  const needsRedeploy = stale.filter((p) => p.runtimeRaw !== "");
  const buildOnly = stale.filter((p) => p.runtimeRaw === "");
  checks.push({
    id: "build-sync",
    label: "빌드에 박힌 값 vs 지금 프로세스의 값",
    status: needsRedeploy.length > 0 ? "fail" : buildOnly.length > 0 ? "warn" : "ok",
    value:
      stale.length > 0
        ? stale
            .map((p) => `${p.name}: 빌드 ${shown(p.compiled)} ≠ 런타임 ${shown(p.runtimeRaw)}`)
            .join(" · ")
        : "일치",
    detail:
      needsRedeploy.length > 0
        ? "**재배포가 필요합니다.** NEXT_PUBLIC_ 값은 빌드 시점에 코드로 박히므로, 환경변수만 바꾸고는 반영되지 않습니다 — 화면은 옛 값으로 계속 동작합니다. 이것이 「로그인 로직 문제」로 보이는 대표적인 변수 로드 문제입니다."
        : buildOnly.length > 0
          ? "런타임 환경에는 이 값이 없고, 빌드 시점 값으로 동작하고 있습니다. 빌드 때만 값을 넘기는 CI 라면 정상입니다. Vercel 처럼 빌드·런타임이 같은 환경변수를 쓰는 곳이라면 값이 지워진 것이니 다시 넣고 재배포하세요."
          : "환경변수와 빌드 산출물이 같은 값을 보고 있습니다.",
  });

  checks.push({
    id: "tray-url",
    label: "NEXT_PUBLIC_SSO_TRAY_WS_URL",
    ...urlVerdict(ssoPublicEnv.trayWsUrl, real),
  });

  checks.push({
    id: "tray-app-code",
    label: "NEXT_PUBLIC_SSO_TRAY_APP_CODE",
    ...appCodeVerdict(ssoPublicEnv.trayAppCode, real),
  });

  return {
    id: "public",
    title: "브라우저로 나가는 SSO 변수 (빌드에 박힘)",
    note: "이 값들은 클라이언트 번들에 그대로 들어 있어 비밀이 아니므로 마스킹하지 않는다.",
    checks,
  };
}

function urlVerdict(url: string, real: boolean): Omit<DiagCheck, "id" | "label"> {
  if (!url) {
    return {
      status: real ? "fail" : "warn",
      value: "(비어 있음)",
      detail: real
        ? "실 모드인데 트레이 주소가 없습니다. 로그인 화면이 SSO_CONFIG_MISSING 으로 멈춥니다."
        : "목업 모드에서는 쓰이지 않습니다. 실 모드로 넘기기 전에 채워야 합니다.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      status: "fail",
      value: url,
      detail: "URL 로 해석되지 않습니다. wss://호스트:포트 형식이어야 합니다.",
    };
  }

  if (parsed.protocol === "ws:") {
    return {
      status: "fail",
      value: url,
      detail:
        "ws:// 는 https 페이지에서 혼합 콘텐츠로 차단됩니다. 브라우저 콘솔에만 남고 화면에는 「모듈 미실행」으로 보입니다 — wss:// 를 쓰세요.",
    };
  }
  if (parsed.protocol !== "wss:") {
    return {
      status: "fail",
      value: url,
      detail: `프로토콜이 ${parsed.protocol} 입니다. WebSocket 주소는 wss:// 여야 합니다.`,
    };
  }

  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(parsed.hostname);
  return {
    status: "ok",
    value: url,
    detail: localHost
      ? "PC 트레이 모듈의 로컬 주소입니다. localhost 와 127.0.0.1 은 인증서 SAN 에 따라 다르게 동작하므로 받은 값 그대로 써야 합니다."
      : "로컬 호스트가 아닙니다. 트레이 모듈은 사용자 PC 에서 도는 것이라 보통 localhost 입니다 — 값을 다시 확인하세요.",
  };
}

function appCodeVerdict(code: string, real: boolean): Omit<DiagCheck, "id" | "label"> {
  if (!code) {
    return {
      status: real ? "fail" : "warn",
      value: "(비어 있음)",
      detail: real
        ? "실 모드인데 앱 코드가 없습니다. 로그인 화면이 SSO_CONFIG_MISSING 으로 멈춥니다."
        : "목업 모드에서는 쓰이지 않습니다. 실 모드로 넘기기 전에 발급받아 채워야 합니다.",
    };
  }
  if (code === "KCC60TRAY0109") {
    return {
      status: "warn",
      value: code,
      detail:
        "레거시 교육포털의 코드입니다. 트레이가 애플리케이션을 구분하는 값이라, 이 서비스용 코드를 따로 발급받아야 정상 응답을 받을 가능성이 높습니다.",
    };
  }
  return {
    status: "ok",
    value: code,
    detail: "트레이 요청의 data 필드로 그대로 나갑니다.",
  };
}

/** 서버에서만 읽는 SSO 변수. */
function serverEnvGroup(): DiagGroup {
  const real = ssoPublicEnv.mode === "real";
  const prod = process.env.NODE_ENV === "production";
  const checks: DiagCheck[] = [];

  // --- 복호화 키 ---
  const rawKey = ssoServerEnv.decodeKey;
  if (!rawKey) {
    checks.push({
      id: "decode-key",
      label: "SSO_DECODE_KEY",
      status: real ? "warn" : "skip",
      value: "(비어 있음)",
      detail: real
        ? "SecuBase 의 32바이트 대칭키입니다. RSA 개인키를 쓰는 구조라면 이 값은 필요 없습니다 — 아래 SSO_RSA_PRIVATE_KEY 를 보세요. 비어 있으면 wb64-xor-basekey 전략만 건너뛰어집니다."
        : "목업 모드에서는 쓰이지 않습니다.",
    });
  } else {
    try {
      const bytes = decodeBaseKey(rawKey);
      checks.push({
        id: "decode-key",
        label: "SSO_DECODE_KEY",
        status: "ok",
        value: `${bytes.length}바이트 · ${/\\[0-7]{1,3}/.test(rawKey) ? "8진 이스케이프" : "base64"} 표기 · 입력 ${rawKey.length}자`,
        detail: "32바이트로 되돌려졌습니다. 값 자체는 담지 않습니다.",
      });
    } catch (e) {
      checks.push({
        id: "decode-key",
        label: "SSO_DECODE_KEY",
        status: "fail",
        value: `입력 ${rawKey.length}자 — 되돌리기 실패`,
        detail: e instanceof Error ? e.message : "32바이트로 되돌리지 못했습니다.",
      });
    }
  }

  // --- RSA 개인키 (레거시의 rsaprivkey8) ---
  const rawRsa = ssoServerEnv.rsaPrivateKey.trim();
  if (!rawRsa) {
    checks.push({
      id: "rsa-key",
      label: "SSO_RSA_PRIVATE_KEY",
      status: real ? "warn" : "skip",
      value: "(비어 있음)",
      detail: real
        ? "RSA 계열 전략(rsa-key→…)이 전부 건너뛰어집니다. 레거시 서버가 rsaprivkey8 을 들고 있었다면 이 값이 있어야 userInfo 가 풀립니다."
        : "목업 모드에서는 쓰이지 않습니다.",
    });
  } else {
    try {
      const parsed = parseRsaPrivateKey(rawRsa, ssoServerEnv.rsaPrivateKeyPassphrase);
      checks.push({
        id: "rsa-key",
        label: "SSO_RSA_PRIVATE_KEY",
        status: "ok",
        value: `RSA ${parsed.bits}비트 · ${parsed.notation} 표기 · 입력 ${rawRsa.length}자`,
        detail:
          "개인키로 읽혔습니다. 값 자체는 담지 않습니다. 이 키가 있으면 평문 전략(raw-plain 등)은 " +
          "위조 방지를 위해 닫힙니다 — 3단계 전략 표에 skipped 로 나오는 것이 정상입니다.",
      });
    } catch (e) {
      checks.push({
        id: "rsa-key",
        label: "SSO_RSA_PRIVATE_KEY",
        status: "fail",
        value: `입력 ${rawRsa.length}자 — 읽기 실패`,
        detail: e instanceof Error ? e.message : "개인키로 읽지 못했습니다.",
      });
    }
  }

  // --- 무결성 게이트 — 운영 실 모드가 여기서 멈춘다 ---
  const gateRaw = runtimeEnvValue("SSO_ALLOW_UNVERIFIED_PAYLOAD") ?? "";
  const gateOpen = ssoServerEnv.allowUnverifiedPayload;
  checks.push({
    id: "unverified-gate",
    label: "SSO_ALLOW_UNVERIFIED_PAYLOAD (무결성 미검증 페이로드 게이트)",
    status: gateOpen ? (prod ? "warn" : "ok") : real ? "fail" : "warn",
    value: `${gateRaw ? `"${gateRaw}"` : "(비어 있음)"} → ${gateOpen ? "통과" : "차단"}`,
    detail: gateOpen
      ? prod
        ? "운영에서 열려 있습니다. 위조된 페이로드로 등록된 아무 사용자로나 로그인될 수 있습니다 — SecuBase 규격을 반영하면 이 스위치를 제거하세요."
        : "개발·스테이징은 값과 무관하게 열려 있습니다."
      : "**운영 빌드에서 실 모드 로그인이 이 게이트에서 멈춥니다.** 복호화가 되든 안 되든 SSO_DECODE_FAILED 로 401 이 됩니다. 임시로 열려면 1 로 두고 재배포하세요 (위조 위험을 감수하는 것입니다).",
  });

  // --- 자동 가입 ---
  const autoRaw = runtimeEnvValue("SSO_ALLOW_AUTO_CREATE") ?? "";
  checks.push({
    id: "auto-create",
    label: "SSO_ALLOW_AUTO_CREATE",
    status: "ok",
    value: `${autoRaw ? `"${autoRaw}"` : "(비어 있음 → 모드 기본값)"} → ${ssoServerEnv.autoCreateMembers ? "자동 가입" : "등록된 사용자만"}`,
    detail: ssoServerEnv.autoCreateMembers
      ? "처음 보는 EPID 가 구독자로 생성됩니다."
      : "members 에 없는 EPID 는 403 SSO_NOT_REGISTERED 로 막힙니다. 4단계에서 등록 여부를 확인하세요.",
  });

  // --- 진단 토큰 ---
  checks.push({
    id: "debug-token",
    label: "SSO_DEBUG_TOKEN",
    status: ssoDebugEnv.token ? "ok" : prod ? "warn" : "skip",
    value: ssoDebugEnv.token ? `설정됨 (${ssoDebugEnv.token.length}자)` : "(비어 있음)",
    detail: ssoDebugEnv.token
      ? "운영에서도 이 토큰으로 진단을 열 수 있습니다."
      : prod
        ? "운영 배포에서 진단을 열 수 없습니다. 지금은 관리자 세션으로만 볼 수 있습니다."
        : "개발에서는 토큰 없이 열립니다.",
  });

  return { id: "server", title: "서버 전용 SSO 변수", checks };
}

/**
 * 세션 · 쿠키.
 *
 * 「로그인은 되었는데 그다음이 문제인가」를 여기서 가른다. 쿠키가 있는데 검증이
 * 실패하면 SESSION_SECRET 이 배포 사이에 바뀐 것이고, 쿠키가 아예 안 남으면
 * secure 플래그와 요청 프로토콜이 어긋난 것이다.
 */
async function sessionGroup(req: Request): Promise<DiagGroup> {
  const prod = process.env.NODE_ENV === "production";
  const checks: DiagCheck[] = [];

  // --- SESSION_SECRET ---
  const rawSecret = runtimeEnvValue("SESSION_SECRET") ?? "";
  if (!rawSecret) {
    checks.push({
      id: "session-secret",
      label: "SESSION_SECRET",
      status: prod ? "fail" : "warn",
      value: "(비어 있음)",
      detail: prod
        ? "운영에서는 세션 서명 자체가 예외로 죽습니다 — 로그인 요청이 500 이 됩니다."
        : "개발 기본값으로 서명합니다. 이 값을 나중에 지정하면 지금 발급된 세션은 모두 끊깁니다.",
    });
  } else {
    checks.push({
      id: "session-secret",
      label: "SESSION_SECRET",
      status: rawSecret.length >= 32 ? "ok" : "warn",
      value: `설정됨 (${rawSecret.length}자)`,
      detail:
        rawSecret.length >= 32
          ? "값은 담지 않습니다. 이 값을 바꾸면 웹·앱의 모든 세션이 함께 끊깁니다."
          : "32자 이상을 권합니다.",
    });
  }

  // --- 쿠키가 이 요청에 실려 왔는가 ---
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const guest = jar.get(GUEST_COOKIE)?.value === "1";

  if (!token) {
    checks.push({
      id: "session-cookie",
      label: `세션 쿠키 ${SESSION_COOKIE}`,
      status: "warn",
      value: "없음",
      detail:
        "이 브라우저에 세션이 없습니다. 로그인을 시도한 뒤에도 없다면 쿠키가 저장되지 않은 것입니다 — 아래 secure 항목을 보세요.",
    });
  } else {
    const payload = await verifySession(token);
    if (!payload) {
      checks.push({
        id: "session-cookie",
        label: `세션 쿠키 ${SESSION_COOKIE}`,
        status: "fail",
        value: `있음 (${token.length}자) · 검증 실패`,
        detail:
          "**쿠키는 있는데 서명·만료 검증이 실패했습니다.** 배포 사이에 SESSION_SECRET 이 바뀌었거나 만료된 세션입니다. 로그인은 됐지만 화면이 계속 /login 으로 돌아가는 증상의 원인입니다.",
      });
    } else {
      const expIn = Math.round((payload.exp * 1000 - Date.now()) / 60_000);
      checks.push({
        id: "session-cookie",
        label: `세션 쿠키 ${SESSION_COOKIE}`,
        status: "ok",
        value: `유효 · ${mask(payload.empNo)} · ${payload.role}${payload.isAdmin ? " · 관리자" : ""} · 만료 ${expIn}분 뒤`,
        detail:
          "세션이 정상입니다. 즉 로그인 자체는 통과한 상태이므로, 남은 문제는 SSO 가 아니라 그 뒤(권한·데이터·화면) 쪽입니다.",
      });
    }
  }

  // --- secure 플래그 대비 요청 프로토콜 ---
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    (() => {
      try {
        return new URL(req.url).protocol.replace(":", "");
      } catch {
        return "unknown";
      }
    })();
  const secureCookie = prod;
  checks.push({
    id: "cookie-secure",
    label: "쿠키 secure 플래그 vs 요청 프로토콜",
    status: secureCookie && proto !== "https" ? "fail" : "ok",
    value: `secure=${secureCookie} · 요청 ${proto}`,
    detail:
      secureCookie && proto !== "https"
        ? "**운영 빌드는 secure 쿠키를 발급하는데 이 요청은 https 가 아닙니다.** 브라우저가 쿠키를 조용히 버려서, 로그인 응답은 200 인데 다음 요청에서 다시 로그아웃 상태가 됩니다."
        : "쿠키가 저장될 수 있는 조합입니다.",
  });

  checks.push({
    id: "guest-cookie",
    label: `게스트 쿠키 ${GUEST_COOKIE}`,
    status: "skip",
    value: guest ? "있음" : "없음",
    detail: "목업 모드 전용 열람 경로입니다. 실 모드·운영에서는 무시됩니다.",
  });

  return {
    id: "session",
    title: "세션 · 쿠키",
    note: `수명 ${sessionEnv.maxAgeSec / 3600}시간 · SameSite=lax`,
    checks,
  };
}

/** Supabase 연결과 members 테이블 — 등록 대조가 여기에 걸린다. */
async function supabaseGroup(): Promise<DiagGroup> {
  const checks: DiagCheck[] = [];
  const rawUrl = runtimeEnvValue("SUPABASE_URL") ?? "";
  const rawKey = runtimeEnvValue("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!rawUrl) {
    checks.push({
      id: "supabase-url",
      label: "SUPABASE_URL",
      status: "fail",
      value: "(비어 있음)",
      detail: "members 를 볼 수 없으니 SSO 가 통과해도 세션이 나오지 않습니다.",
    });
  } else {
    const normalized = normalizeSupabaseUrl(rawUrl);
    checks.push({
      id: "supabase-url",
      label: "SUPABASE_URL",
      status: normalized === rawUrl.trim() ? "ok" : "warn",
      value: normalized,
      detail:
        normalized === rawUrl.trim()
          ? "Project URL 형식입니다."
          : "REST 엔드포인트(.../rest/v1/)가 들어와 경로를 걷어냈습니다. 값을 Project URL 로 고쳐 두는 편이 낫습니다.",
    });
  }

  const jwtish = rawKey.split(".").length === 3;
  checks.push({
    id: "supabase-key",
    label: "SUPABASE_SERVICE_ROLE_KEY",
    status: rawKey ? (jwtish ? "ok" : "warn") : "fail",
    value: rawKey ? `설정됨 (${rawKey.length}자)` : "(비어 있음)",
    detail: rawKey
      ? jwtish
        ? "값은 담지 않습니다. anon 키가 아니라 service_role 키여야 RLS 를 지나 members 를 읽습니다."
        : "JWT 모양(점 3조각)이 아닙니다. 값이 잘려 들어갔을 수 있습니다."
      : "service_role 키가 없으면 members 조회가 전부 실패합니다.",
  });

  if (!rawUrl || !rawKey) {
    checks.push({
      id: "members",
      label: "members 테이블",
      status: "skip",
      value: "확인 못 함",
      detail: "위 변수가 채워진 뒤 다시 실행하세요.",
    });
    return { id: "supabase", title: "Supabase · 등록 사용자", checks };
  }

  try {
    const db = supabaseAdmin();
    // 행을 받아 와서 세지 않는다 — 상한을 두면 「N행」이 실제로는 잘린 수인데도
    // 전체처럼 보인다. 개수만 세는 질의가 더 싸고 정확하다.
    const [total, active] = await Promise.all([
      countMembers(db),
      countMembers(db, (q) => q.eq("is_active", true)),
    ]);

    checks.push({
      id: "members",
      label: "members 테이블",
      status: total > 0 ? "ok" : "fail",
      value: `${total}행 · 활성 ${active}`,
      detail:
        total === 0
          ? "행이 없습니다. supabase/ALL_MIGRATIONS.sql 을 실행했는지 확인하세요 — 등록된 사용자가 없으면 실 모드에서 아무도 로그인할 수 없습니다."
          : "EPID 로 먼저 찾고, 없으면 사번으로 찾습니다.",
    });

    // EPID 는 따로 센다. 같은 질의에 묶으면 컬럼이 없을 때 members 확인 전체가
    // 「조회 실패」로 접히고, 정작 할 일(0012 적용)이 화면에서 사라진다.
    checks.push(await epidColumnCheck(db));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    checks.push({
      id: "members",
      label: "members 테이블",
      status: "fail",
      value: "조회 실패",
      detail:
        `${msg} — ` +
        (/fetch failed/i.test(msg)
          ? "프록시 문제입니다. HTTPS_PROXY 를 설정한 뒤 서버를 재시작하세요."
          : /relation|does not exist|schema/i.test(msg)
            ? "스키마가 없습니다. supabase/ALL_MIGRATIONS.sql 을 SQL Editor 에서 실행하세요."
            : "URL·키를 다시 확인하세요."),
    });
  }

  return { id: "supabase", title: "Supabase · 등록 사용자", checks };
}

/**
 * members.epid 컬럼 확인 — **이 저장소에서 실제로 겪은 로그인 실패의 원인**이다.
 *
 * 0012_member_epid.sql 을 적용하지 않은 배포에서 로그인하면 PostgREST 가
 * `column members.epid does not exist` 를 돌려준다. 그 원문만 보고 스키마가
 * 통째로 없다고 오해하기 쉬워서, 여기서 「무엇을 실행하면 되는지」까지 적는다.
 */
async function epidColumnCheck(db: ReturnType<typeof supabaseAdmin>): Promise<DiagCheck> {
  const label = "members.epid 컬럼 (0012)";
  // head:true 를 쓰지 않는다. HEAD 응답은 본문이 없어 오류 코드(42703)가 오지
  // 않고, postgrest-js 가 `{ message: "" }` 로 접어 버린다 — 「컬럼이 없다」를
  // 알아볼 근거가 사라진다. limit(1) 로 한 행만 받고 개수는 헤더로 받는다.
  const { count, error } = await db
    .from("members")
    .select("epid", { count: "exact" })
    .not("epid", "is", null)
    .limit(1);

  if (error) {
    if (isMissingColumnError(error, "epid")) {
      return {
        id: "members-epid",
        label,
        status: "fail",
        value: "컬럼 없음",
        detail:
          `${MEMBERS_EPID_MISSING} 적용 전까지는 사번(emp_no)으로만 대조하므로, ` +
          "사번이 등록돼 있지 않은 사람은 로그인할 수 없습니다.",
      };
    }
    return {
      id: "members-epid",
      label,
      status: "warn",
      value: "확인 못 함",
      detail: `${error.message} — 위 members 항목을 먼저 보세요.`,
    };
  }

  const filled = count ?? 0;
  return {
    id: "members-epid",
    label,
    status: "ok",
    value: `있음 · 채워진 행 ${filled}`,
    detail:
      filled === 0
        ? "EPID 가 채워진 행이 없습니다. 첫 SSO 로그인에서 사번으로 찾아 백필하므로 정상일 수 있지만, 사번 체계가 다르면 아무도 매칭되지 않습니다."
        : "EPID 로 먼저 찾고, 없으면 사번으로 찾습니다.",
  };
}

/**
 * 개수만 세는 질의. 한 행만 받고 개수는 Content-Range 헤더로 받는다.
 *
 * head:true 가 아닌 이유: HEAD 응답에는 본문이 없어서 **오류 내용이 통째로
 * 사라진다.** 테이블이 없으면 postgrest-js 가 404 + 빈 본문을 204 로 접어
 * 오류 없이 count=null 을 돌려주고, 진단은 그것을 「0행」이라고 말한다 —
 * 스키마가 통째로 없는 배포를 「등록된 사용자가 없다」로 오진하는 셈이다.
 *
 * 필터는 호출부에서 얹는다 — 활성 여부를 따로 세되, 세는 방법은 한 곳에만 둔다.
 */
async function countMembers(
  db: ReturnType<typeof supabaseAdmin>,
  narrow?: (q: MembersCountQuery) => MembersCountQuery,
): Promise<number> {
  const base = membersCountQuery(db);
  const { count, error } = await (narrow ? narrow(base) : base);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function membersCountQuery(db: ReturnType<typeof supabaseAdmin>) {
  return db.from("members").select("id", { count: "exact" }).limit(1);
}

/** 필터를 얹는 쪽이 볼 타입. 질의 모양이 바뀌어도 여기 한 곳만 따라간다. */
type MembersCountQuery = ReturnType<typeof membersCountQuery>;

/** 1단계의 결론 — 어느 층의 문제인지 한 줄로 못 박는다. */
function verdictFor(groups: DiagGroup[]): DiagVerdict {
  const all = groups.flatMap((g) => g.checks);
  const failed = all.filter((c) => c.status === "fail");
  const warned = all.filter((c) => c.status === "warn");
  const find = (id: string) => all.find((c) => c.id === id);

  if (find("build-sync")?.status === "fail") {
    return {
      kind: "build",
      status: "fail",
      headline: "환경변수는 들어왔지만 빌드에 박힌 값이 다릅니다 — 재배포하세요.",
      next: [
        "NEXT_PUBLIC_ 값을 바꾼 뒤 재배포했는지 확인 (값만 바꾸면 반영되지 않습니다)",
        "재배포 후 이 진단을 다시 실행해 build-sync 가 ok 인지 확인",
      ],
    };
  }

  if (find("members-epid")?.status === "fail") {
    return {
      kind: "schema",
      status: "fail",
      headline:
        "환경변수가 아니라 DB 가 원인입니다 — members.epid 컬럼이 없어 등록 대조가 막힙니다.",
      next: [
        "supabase/migrations/0012_member_epid.sql 을 Supabase SQL Editor 에서 실행",
        "supabase/VERIFY.sql 의 ⑩번 블록으로 epid 컬럼과 members_epid_key 확인",
        "DB 쪽 변경이라 Vercel 재배포는 필요 없습니다 — 실행 후 다시 로그인하세요",
      ],
    };
  }

  if (find("session-cookie")?.status === "fail") {
    return {
      kind: "session",
      status: "fail",
      headline: "세션 쿠키는 있는데 검증이 실패했습니다 — SSO 가 아니라 세션 쪽 문제입니다.",
      next: [
        "배포 사이에 SESSION_SECRET 이 바뀌지 않았는지 확인",
        "쿠키를 지우고 다시 로그인해 재현되는지 확인",
      ],
    };
  }

  if (failed.length > 0) {
    return {
      kind: "config",
      status: "fail",
      headline: `환경변수·배포 설정에서 ${failed.length}건이 막고 있습니다 — 로직을 보기 전에 이것부터 고치세요.`,
      next: failed.map((c) => `${c.label}: ${firstSentence(c.detail)}`),
    };
  }

  const sessionOk = find("session-cookie")?.status === "ok";
  if (sessionOk) {
    return {
      kind: "ok",
      status: warned.length > 0 ? "warn" : "ok",
      headline:
        "변수는 모두 로드됐고 세션도 유효합니다 — 로그인 자체는 통과한 상태입니다.",
      next: [
        "증상이 로그인 실패가 아니라면 권한·데이터 쪽을 보세요 (members.role · is_admin)",
        warned.length > 0 ? `경고 ${warned.length}건은 지금 막고 있지는 않습니다` : "",
      ].filter(Boolean),
    };
  }

  return {
    kind: "ok",
    status: warned.length > 0 ? "warn" : "ok",
    headline: "변수 로드에는 문제가 없습니다 — 2·3단계로 연동 로직을 확인하세요.",
    next: [
      "2단계: 트레이 핸드셰이크 — 소켓이 열리는지, 어떤 프레임이 오는지",
      "3단계: 서버 디코딩 드라이런 — 어느 전략이 통하는지, 클레임 키가 무엇인지",
      warned.length > 0 ? `경고 ${warned.length}건 확인 (지금 막고 있지는 않음)` : "",
    ].filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// 3·4단계 — 드라이런 (세션을 발급하지 않는다)
// ---------------------------------------------------------------------------

/**
 * 실제 로그인과 **같은 경로**를 밟되 쿠키를 만들지 않는다.
 *
 * 실제 라우트(api/auth/sso)와 다른 점은 두 가지뿐이다.
 *   · 무결성 게이트를 지나쳐서라도 디코딩을 시도한다 (막힌 이유만 보고 끝내면
 *     운영에서 아무것도 알 수 없다). 대신 세션은 절대 발급하지 않는다.
 *   · members 를 **읽기만** 한다. EPID 백필·자동 가입은 「일어날 것」으로만 알린다.
 *
 * 관문(assertDecodedUser)은 실제 경로와 같은 함수를 쓴다 — 진단이 통과라고 한
 * 페이로드가 로그인에서 막히면 진단의 의미가 없다.
 */
export async function dryRunSso(payload: SsoTrayPayload): Promise<SsoDryRun> {
  const mode = ssoPublicEnv.mode;
  const trace = newDecodeTrace();
  trace.kind = payload.kind;

  const kindMatchesMode = (mode === "real") === (payload.kind === "knox");

  const shape =
    payload.kind === "knox"
      ? {
          userInfo: analyzeField(payload.userInfo),
          privateKey: analyzeField(payload.privateKey),
        }
      : { encoded: analyzeField(payload.encoded) };

  let user: DecodedUser | null = null;
  let decodeError: string | null = null;
  try {
    if (payload.kind === "knox") {
      user = assertDecodedUser(await decodeKnoxPayloadForDiagnostics(payload, trace));
    } else {
      // 목업 디코더는 전략 루프를 쓰지 않으므로 추적을 직접 남긴다.
      // 디코딩이 끝난 직후에 기록한다 — 관문(assertDecodedUser)에서 걸린 것을
      // 「디코딩 실패」로 적으면 진단이 원인을 한 칸 밀어 말하게 된다.
      const raw = await decodeMock(payload.encoded);
      trace.attempts.push({ strategy: "mock-base64", outcome: "adopted" });
      trace.adopted = "mock-base64";
      user = assertDecodedUser(raw);
    }
  } catch (e) {
    decodeError = e instanceof Error ? e.message : "알 수 없는 오류";
    if (payload.kind === "mock" && trace.attempts.length === 0) {
      trace.attempts.push({
        strategy: "mock-base64",
        outcome: "unreadable",
        detail: decodeError,
      });
    }
  }

  const member = user ? await probeMember(user) : emptyProbe();

  const wouldIssueSession =
    kindMatchesMode &&
    !!user &&
    trace.gate !== "diagnostics-bypass" &&
    (member.found
      ? member.isActive === true
      : // 컬럼이 없으면 기준 키로 찾아본 적이 없으므로 라우트는 자동 가입 대신
        // 503(SSO_SCHEMA_OUTDATED)을 돌려준다 — resolveMemberFromSso 참고.
        !member.epidColumnMissing && member.wouldAutoCreate) &&
    !member.error;

  return {
    at: new Date().toISOString(),
    mode,
    payloadKind: payload.kind,
    kindMatchesMode,
    shape,
    trace,
    decoded: {
      ok: !!user,
      error: decodeError,
      epid: user ? mask(user.epid) : null,
      empNo: user ? mask(user.empNo) : null,
      name: user ? maskName(user.name) : null,
      hasEmail: !!user?.email,
      hasDept: !!user?.dept,
    },
    member,
    wouldIssueSession,
    verdict: dryRunVerdict({ kindMatchesMode, trace, user, decodeError, member, mode }),
  };
}

/** resolveMemberFromSso 와 같은 순서로 찾되 **쓰지 않는다.** */
async function probeMember(u: DecodedUser): Promise<MemberProbe> {
  const probe = emptyProbe();
  probe.wouldAutoCreate = ssoServerEnv.autoCreateMembers;

  try {
    const db = supabaseAdmin();
    // 실제 로그인(resolveMemberFromSso)과 같이, 컬럼이 없으면 사번으로만 찾는다.
    const byEpid = await selectMember(db, "epid", u.epid);
    probe.epidColumnMissing = byEpid.columnMissing;

    let row = byEpid.row;
    if (row) probe.matchedBy = "epid";
    if (!row) {
      row = (await selectMember(db, "emp_no", u.empNo)).row;
      if (row) probe.matchedBy = "emp_no";
    }
    if (!row) return probe;

    probe.found = true;
    probe.isActive = row.is_active;
    probe.role = row.role;
    probe.isAdmin = row.is_admin;
    probe.epidFilled = probe.epidColumnMissing ? null : !!row.epid;
    probe.wouldBackfillEpid = !probe.epidColumnMissing && !row.epid && !!u.epid;
    probe.wouldAutoCreate = false;
    return probe;
  } catch (e) {
    probe.error = e instanceof Error ? e.message : "members 조회 실패";
    return probe;
  }
}

/** current-user.ts 의 findMemberBy 와 같은 규칙 — 「행 없음」과 「컬럼 없음」을 가른다. */
async function selectMember(
  db: ReturnType<typeof supabaseAdmin>,
  col: "epid" | "emp_no",
  value: string,
): Promise<{ row: MemberRow | null; columnMissing: boolean }> {
  if (!value) return { row: null, columnMissing: false };
  const { data, error } = await db
    .from("members")
    .select("*")
    .eq(col, value)
    .maybeSingle<MemberRow>();
  if (error) {
    if (isMissingColumnError(error, col)) return { row: null, columnMissing: true };
    throw new Error(`members 조회 실패(${col}): ${error.message}`);
  }
  return { row: data ?? null, columnMissing: false };
}

function emptyProbe(): MemberProbe {
  return {
    matchedBy: null,
    found: false,
    isActive: null,
    role: null,
    isAdmin: null,
    epidFilled: null,
    epidColumnMissing: false,
    wouldBackfillEpid: false,
    wouldAutoCreate: ssoServerEnv.autoCreateMembers,
    error: null,
  };
}

function dryRunVerdict(x: {
  kindMatchesMode: boolean;
  trace: SsoDryRun["trace"];
  user: DecodedUser | null;
  decodeError: string | null;
  member: MemberProbe;
  mode: "mock" | "real";
}): DiagVerdict {
  if (!x.kindMatchesMode) {
    return {
      kind: "config",
      status: "fail",
      headline: `${x.mode} 모드에 맞지 않는 페이로드입니다 — 실제 라우트는 401 로 거절합니다.`,
      next: [
        "NEXT_PUBLIC_SSO_MODE 와 페이로드 종류를 맞추세요 (real ↔ knox · mock ↔ mock)",
        "모드를 바꿨다면 재배포가 필요합니다",
      ],
    };
  }

  if (x.trace.gate === "diagnostics-bypass") {
    return {
      kind: "config",
      status: "fail",
      headline:
        "디코딩은 진단용으로 지나쳤지만, 실제 로그인은 무결성 게이트에서 막힙니다.",
      next: [
        "운영에서 실 모드를 열려면 SSO_ALLOW_UNVERIFIED_PAYLOAD=1 로 두고 재배포",
        "아래 디코딩 결과는 규격 확인용입니다 — 세션은 발급되지 않았습니다",
      ],
    };
  }

  if (!x.user) {
    return {
      kind: "logic",
      status: "fail",
      headline: "변수는 정상인데 페이로드를 해석하지 못했습니다 — 복호화 규격 문제입니다.",
      next: [
        "아래 전략별 결과를 담당자에게 그대로 전달 (SecuBase.java · ssoLoginService.jsp 요청)",
        "claimKeys 가 찍힌 전략이 있으면 필드 이름만 맞추면 됩니다 — toDecodedUser 의 후보 목록에 추가",
        x.decodeError ?? "",
      ].filter(Boolean),
    };
  }

  if (x.member.error) {
    return {
      kind: "config",
      status: "fail",
      headline: "디코딩은 됐지만 members 조회가 실패했습니다 — Supabase 설정 문제입니다.",
      next: [x.member.error, "1단계의 Supabase 항목을 확인하세요"],
    };
  }

  // 「못 찾았다」보다 먼저 본다 — EPID 로 찾아본 적이 없는 결과를 「미등록」이라고
  // 부르면, 사용자는 등록을 요청하러 가고 진짜 원인인 0012 는 그대로 남는다.
  if (x.member.epidColumnMissing && !x.member.found) {
    return {
      kind: "schema",
      status: "fail",
      headline: "members.epid 컬럼이 없어 등록 대조를 못 합니다 — 503 SSO_SCHEMA_OUTDATED.",
      next: [
        "supabase/migrations/0012_member_epid.sql 을 SQL Editor 에서 실행",
        "supabase/VERIFY.sql 의 ⑩번 블록으로 확인",
        "사용자 등록 문제가 아닙니다 — members 에 행을 추가해도 해결되지 않습니다",
      ],
    };
  }

  if (!x.member.found) {
    return x.member.wouldAutoCreate
      ? {
          kind: "ok",
          status: "warn",
          headline: "등록된 행은 없지만 자동 가입이 켜져 있어 로그인은 통과합니다.",
          next: ["운영 방침이 「등록된 사용자만」이라면 SSO_ALLOW_AUTO_CREATE 를 false 로"],
        }
      : {
          kind: "data",
          status: "fail",
          headline:
            "인증·디코딩은 통과했지만 등록된 사용자가 아닙니다 — 403 SSO_NOT_REGISTERED.",
          next: [
            "members 에 이 EPID 또는 사번으로 행을 추가",
            "EPID 체계가 사번과 다르므로, 사번으로 등록된 행이 있으면 첫 로그인에 EPID 가 백필됩니다",
          ],
        };
  }

  if (x.member.isActive === false) {
    return {
      kind: "data",
      status: "fail",
      headline: "사용이 중지된 계정입니다 (is_active=false).",
      next: ["members.is_active 를 true 로 바꾸세요"],
    };
  }

  // 여기까지 왔으면 사번으로 찾아 로그인은 통과한다. 다만 기준 키(EPID)로는
  // 대조하지 않은 상태라, 사번이 바뀌거나 사번이 없는 사람은 여전히 막힌다.
  if (x.member.epidColumnMissing) {
    return {
      kind: "schema",
      status: "warn",
      headline:
        "사번으로 찾아 로그인은 통과하지만, members.epid 컬럼이 없어 EPID 대조가 빠져 있습니다.",
      next: [
        "supabase/migrations/0012_member_epid.sql 을 SQL Editor 에서 실행",
        "적용 후 첫 로그인에서 EPID 가 백필됩니다 — 재배포는 필요 없습니다",
        "그 전까지는 사번이 등록돼 있지 않은 사람이 503 으로 막힙니다",
      ],
    };
  }

  return {
    kind: "ok",
    status: "ok",
    headline: "이 페이로드로는 로그인이 통과합니다 — 세션이 발급될 조건을 모두 만족합니다.",
    next: x.member.wouldBackfillEpid
      ? ["첫 로그인에서 members.epid 가 백필됩니다"]
      : [],
  };
}

// ---------------------------------------------------------------------------
// 마스킹
// ---------------------------------------------------------------------------

/** current-user.ts 의 maskId 와 같은 규칙. 식별자를 통째로 남기지 않는다. */
function mask(v: string): string {
  return v.length <= 4 ? "****" : `${v.slice(0, 2)}****${v.slice(-2)}`;
}

function maskName(v: string): string {
  return v.length <= 1 ? "*" : `${v.slice(0, 1)}${"*".repeat(v.length - 1)}`;
}

function firstSentence(s: string): string {
  const t = s.replace(/\*\*/g, "");
  const cut = t.search(/[.。]\s|$/);
  return cut > 0 ? t.slice(0, cut + 1) : t;
}

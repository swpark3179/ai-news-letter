import { NextResponse } from "next/server";
import { SsoNotRegisteredError, resolveMemberFromSso } from "@/lib/auth/current-user";
import {
  GUEST_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth/session";
import { newDecodeTrace } from "@/lib/auth/sso/diag-types";
import { SsoDecodeError, decodeSsoPayload } from "@/lib/auth/sso/decode";
import { ssoPayloadSchema } from "@/lib/auth/sso/payload-schema";
import { clientIp, hitRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * 실패한 시도를 서버 로그에서 되짚을 수 있게 하는 상관 ID.
 *
 * 응답 헤더(`x-sso-trace-id`)와 본문에 같은 값을 실어 준다. 사용자가 화면에서
 * 읽어 주는 여덟 글자로 서버 로그의 해당 줄을 찾을 수 있다 — 「로그인이 안 된다」는
 * 제보와 로그를 잇는 유일한 끈이다. 무작위성은 추측 방지용이 아니라 구분용이다.
 */
function traceId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** 모든 응답에 상관 ID 를 싣는다 — 정작 필요한 것은 실패한 응답 쪽이다. */
function jsonWithTrace(body: Record<string, unknown>, status: number, tid: string) {
  const res = NextResponse.json({ ...body, traceId: tid }, { status });
  res.headers.set("x-sso-trace-id", tid);
  return res;
}

/**
 * 브라우저가 트레이 모듈에서 받아 온 페이로드를 넘기면, 서버가 디코딩해 EPID 를
 * 얻고, 등록된 사용자인지 대조한 뒤 세션 쿠키를 발급한다.
 *
 *   디코딩       src/lib/auth/sso/decode.ts → decode-knox.ts
 *   등록 대조     src/lib/auth/current-user.ts 의 resolveMemberFromSso
 */
export async function POST(req: Request) {
  const trace = newDecodeTrace();
  const tid = traceId();

  // 사내망 안이라도 무제한 시도를 열어 두지는 않는다. 인스턴스마다 따로 세는
  // best-effort 라 보안 경계는 아니다 — 실제 차단은 등록사용자 대조가 한다.
  if (hitRateLimit(`sso:${clientIp(req)}`, 10, 60_000)) {
    return jsonWithTrace(
      { error: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.", code: "SSO_RATE_LIMITED" },
      429,
      tid,
    );
  }

  let parsed;
  try {
    parsed = ssoPayloadSchema.parse(await req.json());
  } catch {
    console.warn(`[sso ${tid}] 본문 형식 오류 — 스키마와 맞지 않는 요청`);
    return jsonWithTrace({ error: "잘못된 요청 형식입니다." }, 400, tid);
  }

  let user;
  try {
    const decoded = await decodeSsoPayload(parsed, trace);
    user = await resolveMemberFromSso(decoded);
  } catch (e) {
    // 등록되지 않았거나 중지된 계정 — 화면이 전용 안내 카드를 띄운다.
    if (e instanceof SsoNotRegisteredError) {
      console.warn(`[sso ${tid}] 등록되지 않은 사용자 — ${traceSummary(trace)}`);
      return jsonWithTrace({ error: e.message, code: "SSO_NOT_REGISTERED" }, 403, tid);
    }

    if (e instanceof SsoDecodeError) {
      // 원인은 서버 로그에 남기되, 운영에서는 밖으로 상세를 흘리지 않는다.
      // 어느 전략이 왜 실패했는지가 그대로 나가면 페이로드 위조의 힌트가 된다.
      // 전략별 결과는 구조화해 로그에만 남긴다 — /login/diag 의 3단계가 같은
      // 내용을 토큰으로 보호한 채 화면에 보여 준다.
      console.warn(`[sso ${tid}] 디코딩 실패: ${e.message}`, {
        gate: trace.gate,
        attempts: trace.attempts,
      });
      return jsonWithTrace(
        {
          error:
            process.env.NODE_ENV === "production"
              ? "사내 인증 정보를 확인하지 못했습니다."
              : e.message,
          code: "SSO_DECODE_FAILED",
        },
        401,
        tid,
      );
    }

    const msg = e instanceof Error ? e.message : "인증 처리 중 오류가 발생했습니다.";
    console.error(`[sso ${tid}] 세션 발급 실패: ${msg} — ${traceSummary(trace)}`);
    return jsonWithTrace({ error: msg }, 500, tid);
  }

  const token = await signSession(user);
  const res = NextResponse.json({ user, traceId: tid });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  res.cookies.delete(GUEST_COOKIE);
  res.headers.set("x-sso-trace-id", tid);
  return res;
}

/** 로그 한 줄에 담을 디코딩 경과 요약. */
function traceSummary(trace: ReturnType<typeof newDecodeTrace>): string {
  return `종류 ${trace.kind ?? "?"} · 게이트 ${trace.gate} · 채택 ${trace.adopted ?? "없음"} · 시도 ${trace.attempts.length}건`;
}

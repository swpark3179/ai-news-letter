import { NextResponse } from "next/server";
import {
  authorizeDiag,
  collectSsoDiagnostics,
  dryRunSso,
} from "@/lib/auth/sso/diagnostics";
import { ssoPayloadSchema } from "@/lib/auth/sso/payload-schema";
import { clientIp, hitRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/* ===========================================================================
 * SSO 진단 API — /login/diag 화면의 1·3단계가 호출한다
 * ===========================================================================
 *
 *   GET   환경변수·세션·DB 스냅샷            (「변수 로드」 확인)
 *   POST  페이로드 디코딩 드라이런             (「연동 로직」 확인)
 *
 * 두 가지 원칙.
 *
 *  ① **세션을 만들지 않는다.** POST 는 실제 로그인과 같은 경로를 밟지만 쿠키를
 *     발급하지 않는다. 진단이 로그인의 우회로가 되면 안 된다.
 *  ② **비밀값을 돌려주지 않는다.** 복호화 키·서비스 롤 키·세션 시크릿은 존재
 *     여부와 길이만 나간다 (diagnostics.ts 의 마스킹 참고).
 *
 * 이 경로는 proxy matcher 의 `api/auth` 제외에 걸려 세션 검사를 받지 않는다.
 * 그래서 접근 통제는 authorizeDiag 가 직접 한다 — 로그인이 안 되는 상황을
 * 진단하는 것이 목적이라 세션을 요구할 수 없다.
 * ------------------------------------------------------------------------ */

export async function GET(req: Request) {
  const gate = await guard(req, "diag-get", 30);
  if (!gate.ok) return gate.res;

  try {
    return NextResponse.json(await collectSsoDiagnostics(req, gate.via));
  } catch (e) {
    // 진단이 죽으면 진단할 방법이 없어진다. 원인을 그대로 돌려준다.
    return NextResponse.json(
      {
        error: `진단 수집 중 오류: ${e instanceof Error ? e.message : "알 수 없음"}`,
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const gate = await guard(req, "diag-post", 20);
  if (!gate.ok) return gate.res;

  let payload;
  try {
    payload = ssoPayloadSchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      {
        error:
          "페이로드 형식이 잘못됐습니다. { kind:\"knox\", userInfo, privateKey } 또는 { kind:\"mock\", encoded } 를 보내세요.",
      },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await dryRunSso(payload));
  } catch (e) {
    return NextResponse.json(
      {
        error: `드라이런 중 오류: ${e instanceof Error ? e.message : "알 수 없음"}`,
      },
      { status: 500 },
    );
  }
}

/** 레이트리밋 → 접근 통제 순서로 통과시킨다. */
async function guard(
  req: Request,
  bucket: string,
  limit: number,
): Promise<
  { ok: true; via: "dev" | "token" | "admin" } | { ok: false; res: NextResponse }
> {
  if (hitRateLimit(`sso-${bucket}:${clientIp(req)}`, limit, 60_000)) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요." },
        { status: 429 },
      ),
    };
  }

  const access = await authorizeDiag(req);
  if (!access.ok) {
    return {
      ok: false,
      res: NextResponse.json({ error: access.message }, { status: access.status }),
    };
  }
  return { ok: true, via: access.via };
}

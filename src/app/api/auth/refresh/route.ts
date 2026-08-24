import { NextResponse } from "next/server";
import { z } from "zod";
import { RefreshError, rotateMobileSession } from "@/lib/auth/mobile-session";

export const runtime = "nodejs";

/**
 * 액세스 토큰 갱신.
 *
 * 리프레시 토큰은 쓰는 즉시 폐기되고 새로 발급된다(회전). 앱의 dio 인터셉터가
 * 401 을 만나면 이 경로를 한 번만 호출하고, 실패하면 로그아웃 상태로 떨어진다.
 */

const bodySchema = z.object({ refreshToken: z.string().min(20).max(512) });

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  try {
    const session = await rotateMobileSession(parsed.refreshToken);
    return NextResponse.json(session);
  } catch (e) {
    if (e instanceof RefreshError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    return NextResponse.json({ error: "세션을 갱신하지 못했습니다." }, { status: 500 });
  }
}

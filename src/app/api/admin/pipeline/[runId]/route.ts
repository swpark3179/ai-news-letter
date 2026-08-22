import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/current-user";
import { getSyncRun } from "@/lib/data/ops";

export const runtime = "nodejs";

/** 관리자 화면이 파이프라인 진행 상황을 폴링하는 엔드포인트. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await getSessionUser();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const { runId } = await params;
  const run = await getSyncRun(runId);
  if (!run) {
    return NextResponse.json({ error: "실행 기록을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ run });
}

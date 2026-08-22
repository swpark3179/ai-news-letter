import { NextResponse, after } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { supabaseAdmin } from "@/lib/supabase/server";
import { syncGeekNews } from "@/lib/sync/geeknews";
import { syncTrend } from "@/lib/sync/trend";
import { enableEnvProxy } from "@/lib/proxy";
import { llmEnv, syncEnv } from "@/lib/env";

export const runtime = "nodejs";
// 트렌드 파이프라인은 LLM 호출이 있어 오래 걸린다. 호스팅 플랫폼이 허용하는
// 범위에서 최대한 늘려 둔다 (Vercel Pro 기준 300초).
export const maxDuration = 300;

const bodySchema = z.object({
  kind: z.enum(["geeknews", "trend"]),
  limit: z.number().int().positive().max(100).optional(),
});

/**
 * 관리자 화면의 "최신 트렌드 정보 업데이트하기" 버튼.
 *
 * sync_runs 행을 먼저 만들어 runId 를 즉시 돌려주고, 실제 수집은 after() 로
 * 응답 이후에 돌린다. 화면은 runId 로 진행 상황을 폴링한다.
 *
 * 주의 — after() 도 서버리스 함수의 최대 실행 시간 안에서만 살아 있다.
 * 트렌드 전체 수집(신규 30건)은 무료 티어 Gemini 기준 3~5분이 걸릴 수 있어
 * 플랫폼 한도를 넘길 수 있다. 정기 실행은 GitHub Actions 가 맡고, 이 버튼은
 * 즉시 확인용으로 쓴다. 한도에 걸리면 sync_runs 는 running 상태로 남는다.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: "관리자만 실행할 수 있습니다." }, { status: 403 });
  }

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const db = supabaseAdmin();

  // 같은 종류가 이미 돌고 있으면 중복 실행하지 않는다.
  const { data: running } = await db
    .from("sync_runs")
    .select("id, started_at")
    .eq("kind", parsed.kind)
    .eq("status", "running")
    .gte("started_at", new Date(Date.now() - 15 * 60 * 1000).toISOString())
    .limit(1)
    .maybeSingle<{ id: string; started_at: string }>();

  if (running) {
    return NextResponse.json({ runId: running.id, alreadyRunning: true });
  }

  const provider = parsed.kind === "trend" ? llmEnv.provider : null;

  const { data: created, error } = await db
    .from("sync_runs")
    .insert({
      kind: parsed.kind,
      provider,
      trigger: "admin_ui",
      status: "running",
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !created) {
    return NextResponse.json(
      { error: `실행 기록 생성 실패: ${error?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  const runId = created.id;

  after(async () => {
    enableEnvProxy();
    try {
      if (parsed.kind === "geeknews") {
        await syncGeekNews(db, {
          runId,
          lookbackDays: syncEnv.geekLookbackDays,
          maxPages: syncEnv.geekMaxPages,
        });
      } else {
        await syncTrend(db, {
          runId,
          maxNew: parsed.limit ?? syncEnv.trendMaxNew,
          hnMinScore: syncEnv.hnMinScore,
        });
      }
    } catch (e) {
      // syncXxx 가 이미 sync_runs 를 failed 로 마감한다. 여기서는 로그만.
      console.error("[pipeline]", parsed.kind, e);
    }
  });

  return NextResponse.json({ runId });
}

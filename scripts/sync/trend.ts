import { createAdminClient } from "@/lib/supabase/admin-client";
import { syncTrend } from "@/lib/sync/trend";
import type { TrendSource } from "@/types/db";
import { fail, parseArgs, requireSupabaseEnv } from "./cli";

/**
 * 트렌드 브리핑 동기화 CLI.
 *
 *   npm run sync:trend -- --dry-run              수집 대상만 확인 (LLM 호출 없음)
 *   npm run sync:trend -- --limit=5              신규 5건만 기사화
 *   npm run sync:trend -- --provider=openai      제공자 지정
 *   npm run sync:trend -- --only=github,arxiv    특정 출처만
 */
const VALID_SOURCES: TrendSource[] = ["github", "hn", "arxiv", "geeknews"];

async function main() {
  const args = parseArgs();

  if (args.help) {
    console.log(`
트렌드 브리핑 동기화 (LLM 사용)

  --dry-run              LLM 호출 없이 수집 대상만 출력
  --limit=N              이번 실행에서 기사화할 최대 신규 건수 (기본 TREND_MAX_NEW 또는 30)
  --provider=gemini|openai   LLM_PROVIDER 환경변수를 덮어씀
  --only=github,hn,arxiv,geeknews   특정 출처만 수집
`);
    return;
  }

  requireSupabaseEnv();

  const only = args.only
    ?.filter((s): s is TrendSource => VALID_SOURCES.includes(s as TrendSource));

  if (args.only && (!only || only.length === 0)) {
    console.error(`--only 값이 올바르지 않습니다. 가능: ${VALID_SOURCES.join(", ")}`);
    process.exit(1);
  }

  const db = createAdminClient();
  const result = await syncTrend(db, {
    maxNew: args.limit ?? (Number(process.env.TREND_MAX_NEW) || 30),
    hnMinScore: Number(process.env.HN_MIN_SCORE) || 150,
    dryRun: args.dryRun,
    provider: args.provider,
    only: only && only.length > 0 ? only : undefined,
    trigger: process.env.GITHUB_ACTIONS ? "schedule" : "manual",
    echo: true,
  });

  console.log(
    `\n후보 ${result.fetched}건 · 신규 ${result.fresh}건 · 저장 ${result.inserted}건 · 건너뜀 ${result.skipped}건`,
  );
}

main().catch(fail);

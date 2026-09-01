import { createAdminClient } from "@/lib/supabase/admin-client";
import { syncShowcase } from "@/lib/sync/showcase";
import { fail, parseArgs, requireSupabaseEnv } from "./cli";

/**
 * 쇼케이스 동기화 CLI (news.hada.io/show).
 *
 *   npm run sync:showcase -- --dry-run       파싱 결과만 출력 (DB 미기록)
 *   npm run sync:showcase -- --days=5        5일치 수집
 *   npm run sync:showcase                    실제 적재
 */
async function main() {
  const args = parseArgs();

  if (args.help) {
    console.log(`
쇼케이스 동기화 (LLM 미사용)

  --dry-run     저장하지 않고 파싱 결과만 출력
  --days=N      며칠 전까지 수집할지 (기본 SHOW_LOOKBACK_DAYS 또는 3)
  --limit=N     최대 페이지 수 (기본 SHOW_MAX_PAGES 또는 5)
`);
    return;
  }

  requireSupabaseEnv();

  const db = createAdminClient();
  const result = await syncShowcase(db, {
    lookbackDays: args.days ?? (Number(process.env.SHOW_LOOKBACK_DAYS) || 3),
    maxPages: args.limit ?? (Number(process.env.SHOW_MAX_PAGES) || 5),
    dryRun: args.dryRun,
    trigger: process.env.GITHUB_ACTIONS ? "schedule" : "manual",
    echo: true,
  });

  console.log(
    `\n수집 ${result.fetched}건 · 저장 ${result.inserted}건 · 건너뜀 ${result.skipped}건`,
  );
}

main().catch(fail);

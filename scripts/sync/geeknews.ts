import { createAdminClient } from "@/lib/supabase/admin-client";
import { syncGeekNews } from "@/lib/sync/geeknews";
import { fail, parseArgs, requireSupabaseEnv } from "./cli";

/**
 * 긱뉴스 동기화 CLI.
 *
 *   npm run sync:geeknews -- --dry-run       파싱 결과만 출력 (DB 미기록)
 *   npm run sync:geeknews -- --days=5        5일치 수집
 *   npm run sync:geeknews                    실제 적재
 */
async function main() {
  const args = parseArgs();

  if (args.help) {
    console.log(`
긱뉴스 동기화 (LLM 미사용)

  --dry-run     저장하지 않고 파싱 결과만 출력
  --days=N      며칠 전까지 수집할지 (기본 GEEK_LOOKBACK_DAYS 또는 3)
  --limit=N     최대 페이지 수 (기본 GEEK_MAX_PAGES 또는 8)
`);
    return;
  }

  requireSupabaseEnv();

  const db = createAdminClient();
  const result = await syncGeekNews(db, {
    lookbackDays: args.days ?? (Number(process.env.GEEK_LOOKBACK_DAYS) || 3),
    maxPages: args.limit ?? (Number(process.env.GEEK_MAX_PAGES) || 8),
    dryRun: args.dryRun,
    trigger: process.env.GITHUB_ACTIONS ? "schedule" : "manual",
    echo: true,
  });

  console.log(
    `\n수집 ${result.fetched}건 · 저장 ${result.inserted}건 · 건너뜀 ${result.skipped}건`,
  );
}

main().catch(fail);

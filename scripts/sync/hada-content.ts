import { createAdminClient } from "@/lib/supabase/admin-client";
import { syncHadaContents } from "@/lib/sync/hada-content";
import { fetchText } from "@/lib/sync/http";
import { SyncRun } from "@/lib/sync/run-log";
import { diagnoseTopicPage, parseTopicPage } from "@/lib/sync/sources/hada-topic";
import { fail, parseArgs, requireSupabaseEnv } from "./cli";

/**
 * 긱뉴스 / 쇼케이스 본문 수집 CLI.
 *
 *   npm run sync:hada-content -- --url=https://news.hada.io/topic?id=33087
 *       진단 모드. 상세 페이지 한 장을 받아 어떤 셀렉터가 걸리는지, 마커를
 *       어디서 찾았는지, 뽑아낸 본문이 무엇인지 그대로 보여 준다.
 *       **DB 도 Supabase 환경변수도 필요 없다** — 네트워크만 있으면 돈다.
 *       news.hada.io 에 닿을 수 없는 환경이라면 GitHub Actions 의
 *       "긱뉴스 상세 구조 진단" 워크플로를 dispatch 해서 같은 출력을 얻는다.
 *
 *   npm run sync:hada-content -- --source=geeknews
 *       본문이 없는 항목을 예산만큼 채운다 (평시에는 목록 수집이 알아서 하므로
 *       한 번에 많이 메우고 싶을 때만 쓴다).
 *
 *   npm run sync:hada-content -- --source=showcase --dry-run
 *       받아서 파싱까지만 하고 저장하지 않는다.
 */

const HELP = `
긱뉴스 / 쇼케이스 본문 수집 (LLM 미사용)

  --url=<토픽 URL>   상세 페이지 한 장을 진단한다 (DB 불필요)
  --source=geeknews  긱뉴스 본문 채우기
  --source=showcase  쇼케이스 본문 채우기
  --limit=N          이번 실행에서 받아 올 최대 건수 (기본 HADA_CONTENT_MAX_PER_RUN 또는 40)
  --dry-run          저장하지 않고 파싱 결과만 출력
`;

/** 진단 모드 — 셀렉터를 실측으로 확정하기 위한 출력. */
async function probe(url: string): Promise<void> {
  console.log(`\n▸ ${url}\n`);

  const html = await fetchText(url);
  console.log(`HTML ${html.length.toLocaleString()} bytes\n`);

  const d = diagnoseTopicPage(html);

  console.log("본문 컨테이너 후보 (위에서부터 시도)");
  for (const c of d.candidates) {
    const mark = c.matched ? "✓" : "·";
    console.log(`  ${mark} ${c.selector.padEnd(20)} ${c.matched ? `${c.textChars}자` : "없음"}`);
  }

  console.log("\n관련글 마커");
  console.log(
    d.marker?.found
      ? `  ✓ <${d.marker.tag}> id="${d.marker.id}" class="${d.marker.className}"`
      : `  · 요소 경계에서는 못 찾음 (텍스트 중간에 있을 수 있다)`,
  );

  console.log("\n텍스트가 많은 요소 — 실제 본문 컨테이너를 여기서 고른다");
  for (const h of d.heaviest) {
    const id = h.id ? `#${h.id}` : "";
    const cls = h.className ? `.${h.className.trim().split(/\s+/).join(".")}` : "";
    console.log(`  ${String(h.textChars).padStart(6)}자  ${h.tag}${id}${cls}`);
  }

  const parsed = parseTopicPage(html, { baseUrl: url });
  console.log(
    `\n추출 결과 — status=${parsed.status} container=${parsed.container ?? "-"} ` +
      `chars=${parsed.chars} truncated=${parsed.truncated}`,
  );

  if (parsed.bodyMd.includes("함께 보면 좋은 글")) {
    console.log("\n⚠️  본문에 관련글 마커가 남아 있습니다 — 절단이 안 먹혔습니다.");
  }

  console.log("\n──────── 본문 ────────");
  console.log(parsed.bodyMd || "(비어 있음)");
  console.log("──────────────────────\n");
}

async function main() {
  const args = parseArgs();

  if (args.help) {
    console.log(HELP);
    return;
  }

  // 진단 모드가 먼저다 — Supabase 없이도 돌아야 한다.
  if (args.url) {
    await probe(args.url);
    return;
  }

  if (!args.source) {
    console.error("--url 또는 --source 가 필요합니다.");
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  requireSupabaseEnv();

  const db = createAdminClient();
  const run = await SyncRun.start(db, {
    kind: args.source,
    trigger: process.env.GITHUB_ACTIONS ? "schedule" : "manual",
    dryRun: args.dryRun,
    echo: true,
  });

  try {
    const result = await syncHadaContents(db, {
      source: args.source,
      maxPerRun: args.limit ?? undefined,
      dryRun: args.dryRun,
      run,
    });

    run.fetched = result.attempted;
    run.inserted = result.ok;
    await run.finish("success");

    console.log(
      `\n시도 ${result.attempted}건 · 성공 ${result.ok}건 · 실패 ${result.failed}건` +
        (result.remaining > 0 ? ` · 남은 대상 ${result.remaining}건` : ""),
    );
  } catch (e) {
    await run.finish("failed", e instanceof Error ? e.message : String(e));
    throw e;
  }
}

main().catch(fail);

import { appendFileSync } from "node:fs";
import { createAdminClient } from "@/lib/supabase/admin-client";
import { DEFAULT_TREND_SOURCES, syncTrend, type TrendPreview } from "@/lib/sync/trend";
import type { TrendSource } from "@/types/db";
import { fail, parseArgs, requireSupabaseEnv } from "./cli";

/**
 * 트렌드 브리핑 동기화 CLI.
 *
 *   npm run sync:trend                           기본 출처(github,hn,arxiv) 전부
 *   npm run sync:trend -- --dry-run              수집 대상만 확인 (LLM 호출 없음)
 *   npm run sync:trend -- --preview --limit=6    기사를 만들어 보기만 함 (저장 안 함)
 *   npm run sync:trend -- --limit=5              신규 5건만 기사화
 *   npm run sync:trend -- --provider=openai      제공자 지정
 *   npm run sync:trend -- --only=github,arxiv    특정 출처만
 *
 * 긱뉴스는 '긱뉴스 동기화'(npm run sync:geeknews)가 담당하므로 기본 출처에서
 * 빠져 있다. 굳이 기사화하려면 --only=geeknews 로 명시한다.
 */
const VALID_SOURCES: TrendSource[] = ["github", "hn", "arxiv", "geeknews"];

async function main() {
  const args = parseArgs();

  if (args.help) {
    console.log(`
트렌드 브리핑 동기화 (LLM 사용)

  --dry-run              LLM 호출 없이 수집 대상만 출력
  --preview              기사를 만들어 출력만 하고 저장하지 않음. 이미 실린 항목도
                         다시 써 보므로 프롬프트를 고친 뒤 비교할 때 쓴다 (--limit 를 작게)
  --limit=N              이번 실행에서 기사화할 최대 신규 건수 (기본 TREND_MAX_NEW 또는 30)
                         상한은 출처별로 번갈아 나눠 담는다
  --provider=gemini|openai   LLM_PROVIDER 환경변수를 덮어씀
  --only=github,hn,arxiv,geeknews   특정 출처만 수집
                         기본값 ${DEFAULT_TREND_SOURCES.join(",")} — 긱뉴스는 별도 동기화가 담당
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
    preview: args.preview,
    provider: args.provider,
    only: only && only.length > 0 ? only : undefined,
    trigger: process.env.GITHUB_ACTIONS ? "schedule" : "manual",
    echo: true,
  });

  console.log(
    `\n후보 ${result.fetched}건 · 신규 ${result.fresh}건 · 저장 ${result.inserted}건 · 건너뜀 ${result.skipped}건`,
  );

  if (args.preview && !args.dryRun) {
    const md = previewMarkdown(result.previews);
    console.log(`\n${md}`);
    // Actions 에서는 실행 화면의 Summary 탭에 렌더된 채로 보이게 한다.
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
    }
  }

  // 일부 출처가 죽어도 나머지로 기사를 만들었으면 실패가 아니다(종료 코드 0).
  // 다만 조용히 넘어가면 며칠씩 빠진 걸 모르므로 Actions 로그에 경고를 남긴다.
  if (result.failedSources.length > 0) {
    const msg =
      `수집하지 못한 출처: ${result.failedSources.join(", ")} — ` +
      `나머지 출처로만 기사를 만들었습니다.`;
    console.warn(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `! ${msg}`);
  }
}

/** 미리보기 기사를 마크다운으로. 콘솔과 Actions Step Summary 가 같이 쓴다. */
function previewMarkdown(previews: TrendPreview[]): string {
  const out: string[] = [
    `## 트렌드 브리핑 미리보기 — ${previews.length}건 (저장하지 않음)`,
  ];
  previews.forEach((p, n) => {
    out.push("", "---", "", `### ${n + 1}. [${p.source}] ${p.title}`, "", `<${p.sourceUrl}> · ${p.sourceLabel}`);
    if (p.deck) out.push("", `**덱** ${p.deck}`);
    if (p.previous) {
      out.push("", `> 지금 실린 것 — **${p.previous.title}**${p.previous.deck ? ` / ${p.previous.deck}` : ""}`);
    }
    for (const b of p.body) {
      if (b.type === "head") out.push("", `#### ${b.t}`);
      else if (b.type === "quote") out.push("", `> ${b.t}`);
      else if (b.type === "list") out.push("", "*한눈에 보기*", ...b.t.split("\n").map((l) => `- ${l}`));
      else out.push("", b.t);
    }
    if (p.tags.length > 0) out.push("", `\`${p.tags.join("` `")}\``);
  });
  return out.join("\n");
}

main().catch(fail);

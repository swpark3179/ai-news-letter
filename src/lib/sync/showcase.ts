import type { SupabaseClient } from "@supabase/supabase-js";
import { kstDateString } from "@/lib/format";
import { SyncRun } from "./run-log";
import { kstMidnightDaysAgo } from "./geeknews";
import { crawlHadaShow, type ShowcaseItem } from "./sources/hada-show";

/**
 * 쇼케이스 동기화 — 긱뉴스와 마찬가지로 LLM 을 전혀 쓰지 않는다.
 *
 * news.hada.io/show 는 사람들이 직접 만든 것을 소개하는 게시판이다. 제목과
 * 소개문을 원문 그대로 저장하고, 저장하는 모든 항목에 원문 링크와 출처를 남긴다.
 *
 * 멱등성: PK 가 토픽 URL 이라 on conflict do nothing 으로 기존 항목을 자동으로
 * 건너뛴다. 같은 명령을 여러 번 돌려도 행 수가 늘지 않는다.
 *
 * 긱뉴스와 저장 테이블을 나눈 이유는 성격이 달라서다. 한 테이블에 섞으면
 * "오늘의 뉴스"와 "누가 뭘 만들었나"를 화면에서 구분할 수 없다.
 */

export interface ShowcaseSyncOptions {
  lookbackDays?: number;
  maxPages?: number;
  dryRun?: boolean;
  trigger?: "schedule" | "manual" | "admin_ui";
  echo?: boolean;
  /** API 가 미리 만들어 둔 sync_runs 행에 이어 쓸 때 */
  runId?: string;
}

export interface ShowcaseSyncResult {
  runId: string | null;
  fetched: number;
  inserted: number;
  skipped: number;
  items: ShowcaseItem[];
}

export async function syncShowcase(
  db: SupabaseClient,
  opts: ShowcaseSyncOptions = {},
): Promise<ShowcaseSyncResult> {
  const lookbackDays = opts.lookbackDays ?? 3;
  // /show 는 메인보다 글이 뜸해 5페이지면 며칠치가 다 들어온다.
  const maxPages = opts.maxPages ?? 5;

  const run = opts.runId
    ? SyncRun.attach(db, opts.runId, { kind: "showcase", echo: opts.echo })
    : await SyncRun.start(db, {
        kind: "showcase",
        trigger: opts.trigger ?? "manual",
        dryRun: opts.dryRun,
        echo: opts.echo,
      });

  try {
    const since = kstMidnightDaysAgo(lookbackDays);
    run.log(
      `쇼케이스 수집 시작 · ${since.toISOString().slice(0, 10)} 이후 · 최대 ${maxPages}페이지`,
    );

    // --- 1. 목록 페이지 순회 ---------------------------------------------
    // 1페이지에서 한 건도 못 뽑으면 crawlHadaShow 가 예외를 던진다 —
    // "새 글이 없다"와 "파싱이 깨졌다"를 구분하기 위해서다.
    const crawled = await crawlHadaShow({
      since,
      maxPages,
      onPage: (page, kept, total) =>
        run.log(`page ${page} · ${total}건 중 기간 내 ${kept}건`),
    });

    run.fetched = crawled.items.length;
    run.log(
      `${crawled.pagesFetched}페이지에서 ${crawled.items.length}건 수집 (기간 밖 ${crawled.outOfRange}건 제외)`,
    );

    if (crawled.items.length === 0) {
      run.log("기간 내 신규 항목이 없습니다.", "warn");
      await run.finish("success");
      return { runId: run.id, fetched: 0, inserted: 0, skipped: 0, items: [] };
    }

    // --- 2. 기존 URL 확인 -------------------------------------------------
    const urls = crawled.items.map((i) => i.url);
    const { data: existing, error: selErr } = await db
      .from("showcase_items")
      .select("url")
      .in("url", urls)
      .returns<{ url: string }[]>();

    if (selErr) throw new Error(`기존 항목 조회 실패: ${selErr.message}`);

    const known = new Set((existing ?? []).map((r) => r.url));
    const fresh = crawled.items.filter((i) => !known.has(i.url));

    run.fresh = fresh.length;
    run.skipped = crawled.items.length - fresh.length;
    run.log(`신규 ${fresh.length}건 · 이미 있는 항목 ${run.skipped}건 건너뜀`);

    if (fresh.length === 0) {
      await run.finish("success");
      return {
        runId: run.id,
        fetched: crawled.items.length,
        inserted: 0,
        skipped: run.skipped,
        items: [],
      };
    }

    // --- 3. 저장 -----------------------------------------------------------
    if (opts.dryRun) {
      run.log(`[dry-run] 저장하지 않고 종료 — 신규 ${fresh.length}건`, "warn");
      for (const i of fresh.slice(0, 10)) {
        run.log(`  · ${i.title}  (${i.url})`);
      }
      if (fresh.length > 10) run.log(`  … 외 ${fresh.length - 10}건`);
      await run.finish("success");
      return {
        runId: run.id,
        fetched: crawled.items.length,
        inserted: 0,
        skipped: run.skipped,
        items: fresh,
      };
    }

    const rows = fresh.map((i) => ({
      url: i.url,
      title: i.title,
      summary: i.summary,
      published_at: i.publishedAt.toISOString(),
      external_url: i.externalUrl,
      source_domain: i.sourceDomain,
      points: i.points,
      comment_count: i.commentCount,
      submitter: i.submitter,
      collected_date: kstDateString(),
    }));

    // PK 충돌은 무시 — 크롤 중 새 글이 올라와 경합해도 안전하다.
    const { data: inserted, error: insErr } = await db
      .from("showcase_items")
      .upsert(rows, { onConflict: "url", ignoreDuplicates: true })
      .select("url")
      .returns<{ url: string }[]>();

    if (insErr) throw new Error(`저장 실패: ${insErr.message}`);

    run.inserted = inserted?.length ?? 0;
    await run.finish("success");

    return {
      runId: run.id,
      fetched: crawled.items.length,
      inserted: run.inserted,
      skipped: run.skipped,
      items: fresh,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await run.finish("failed", msg);
    throw e;
  }
}

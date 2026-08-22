import type { SupabaseClient } from "@supabase/supabase-js";
import { kstDateString } from "@/lib/format";
import { SyncRun } from "./run-log";
import {
  crawlGeekNews,
  fetchFeedSummaries,
  type GeekNewsItem,
} from "./sources/geeknews";

/**
 * 긱뉴스 동기화 — LLM 을 전혀 쓰지 않는다.
 *
 * 사용자 요구: 제목과 요약부를 "그대로" 가져온다. 원문이 이미 한국어 요약이라
 * 모델을 태울 이유가 없고, 그래야 비용도 환각도 없다.
 *
 * 멱등성: PK 가 요약부 링크 URL 이라 on conflict do nothing 으로 기존 항목을
 * 자동으로 건너뛴다. 같은 명령을 여러 번 돌려도 행 수가 늘지 않는다.
 */

export interface GeekSyncOptions {
  lookbackDays?: number;
  maxPages?: number;
  dryRun?: boolean;
  trigger?: "schedule" | "manual" | "admin_ui";
  echo?: boolean;
  /** API 가 미리 만들어 둔 sync_runs 행에 이어 쓸 때 */
  runId?: string;
}

export interface GeekSyncResult {
  runId: string | null;
  fetched: number;
  inserted: number;
  skipped: number;
  items: GeekNewsItem[];
}

/** KST 기준 N일 전 00:00 */
export function kstMidnightDaysAgo(days: number, now = new Date()): Date {
  const [y, m, d] = kstDateString(now).split("-").map(Number);
  // KST 자정 = UTC 전날 15:00
  const utc = Date.UTC(y, m - 1, d - days, 0, 0, 0) - 9 * 60 * 60 * 1000;
  return new Date(utc);
}

export async function syncGeekNews(
  db: SupabaseClient,
  opts: GeekSyncOptions = {},
): Promise<GeekSyncResult> {
  const lookbackDays = opts.lookbackDays ?? 3;
  const maxPages = opts.maxPages ?? 8;

  const run = opts.runId
    ? SyncRun.attach(db, opts.runId, { kind: "geeknews", echo: opts.echo })
    : await SyncRun.start(db, {
        kind: "geeknews",
        trigger: opts.trigger ?? "manual",
        dryRun: opts.dryRun,
        echo: opts.echo,
      });

  try {
    const since = kstMidnightDaysAgo(lookbackDays);
    run.log(
      `긱뉴스 수집 시작 · ${since.toISOString().slice(0, 10)} 이후 · 최대 ${maxPages}페이지`,
    );

    // --- 1. 목록 페이지 순회 ---------------------------------------------
    const crawled = await crawlGeekNews({
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

    // --- 2. Atom 피드로 요약 보강 ----------------------------------------
    const feed = await fetchFeedSummaries();
    if (feed.size > 0) {
      let enriched = 0;
      for (const item of crawled.items) {
        const better = feed.get(item.url);
        if (better && better.length > item.summary.length) {
          item.summary = better;
          enriched++;
        }
      }
      run.log(`Atom 피드로 요약 ${enriched}건 보강`);
    }

    // --- 3. 기존 URL 확인 -------------------------------------------------
    const urls = crawled.items.map((i) => i.url);
    const { data: existing, error: selErr } = await db
      .from("geek_news")
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

    // --- 4. 저장 -----------------------------------------------------------
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
      .from("geek_news")
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

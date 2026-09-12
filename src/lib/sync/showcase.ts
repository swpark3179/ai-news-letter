import type { SupabaseClient } from "@supabase/supabase-js";
import { kstDateString } from "@/lib/format";
import { runContentStage } from "./hada-content";
import { finishHandover, findGeekNewsOverlap } from "./hada-dedup";
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
 *
 * 긱뉴스와의 중복: `/show` 글은 메인 목록에도 함께 뜨고, 일정이 긱뉴스(07:00) →
 * 쇼케이스(07:20) 라 그날치가 긱뉴스에 먼저 들어가 있다. 겹치면 쇼케이스가
 * 이기므로 그 행을 수집 이력째 넘겨받고 긱뉴스에서 지운다 (sync/hada-dedup.ts).
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

  /** 본문 단계 — 긱뉴스와 같다 (src/lib/sync/hada-content.ts 주석 참고). */
  const collectBodies = (freshUrls: string[]) =>
    runContentStage(db, {
      source: "showcase",
      freshUrls,
      dryRun: opts.dryRun,
      maxPerRun: opts.trigger === "admin_ui" ? 15 : undefined,
      run,
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
      await collectBodies([]);
      await run.finish("success");
      return { runId: run.id, fetched: 0, inserted: 0, skipped: 0, items: [] };
    }

    // --- 2. 긱뉴스가 먼저 담아 둔 항목 확인 --------------------------------
    // 적재 전에 읽어 둔다 — 수집 이력과 숨김 여부를 그대로 이어받기 위해서다.
    // 실제 삭제는 적재가 끝난 뒤(5번)에 한다.
    const urls = crawled.items.map((i) => i.url);
    const handover = await findGeekNewsOverlap(db, urls);
    const handoverUrls = [...handover.keys()];

    if (handover.size > 0) {
      run.log(`긱뉴스에 들어가 있는 ${handover.size}건을 쇼케이스로 이관합니다.`);
    }

    // --- 3. 기존 URL 확인 -------------------------------------------------
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
      // 신규가 없어도 이관은 남아 있을 수 있다 — 쇼케이스에 이미 있는 글이
      // 긱뉴스에도 한 행 더 쌓여 있는 경우다.
      await finishHandover(db, handoverUrls, { run, dryRun: opts.dryRun });
      await collectBodies([]);
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
      await finishHandover(db, handoverUrls, { run, dryRun: true });
      await collectBodies(fresh.map((i) => i.url));
      await run.finish("success");
      return {
        runId: run.id,
        fetched: crawled.items.length,
        inserted: 0,
        skipped: run.skipped,
        items: fresh,
      };
    }

    const now = new Date().toISOString();
    const today = kstDateString();

    const rows = fresh.map((i) => {
      // 이관분은 긱뉴스가 처음 퍼온 시각·숨김 여부를 그대로 이어받는다.
      // 오늘 처음 본 글로 다시 적으면 지난 날짜의 "오늘 몇 건" 집계가 흔들리고,
      // 운영자가 감춰 둔 글이 도로 나타난다.
      const prior = handover.get(i.url);

      return {
        url: i.url,
        title: i.title,
        summary: i.summary,
        published_at: i.publishedAt.toISOString(),
        external_url: i.externalUrl,
        source_domain: i.sourceDomain,
        points: i.points,
        comment_count: i.commentCount,
        submitter: i.submitter,
        is_hidden: prior?.is_hidden ?? false,
        // 벌크 insert 는 모든 행의 키가 같아야 해서, 이관분이 아니어도 값을 적는다
        // (열 기본값과 같은 값이다).
        collected_at: prior?.collected_at ?? now,
        collected_date: prior?.collected_date ?? today,
      };
    });

    // PK 충돌은 무시 — 크롤 중 새 글이 올라와 경합해도 안전하다.
    const { data: inserted, error: insErr } = await db
      .from("showcase_items")
      .upsert(rows, { onConflict: "url", ignoreDuplicates: true })
      .select("url")
      .returns<{ url: string }[]>();

    if (insErr) throw new Error(`저장 실패: ${insErr.message}`);

    run.inserted = inserted?.length ?? 0;

    // --- 5. 이관 마무리 -----------------------------------------------------
    // 적재가 끝난 뒤에 지운다. 먼저 지우면 적재가 실패했을 때 그 항목이 어느
    // 테이블에도 남지 않는다.
    await finishHandover(db, handoverUrls, { run, dryRun: opts.dryRun });

    await collectBodies(fresh.map((i) => i.url));
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

import type { SupabaseClient } from "@supabase/supabase-js";
import { kstDateString } from "@/lib/format";
import {
  TREND_BATCH_SCHEMA,
  TREND_SYSTEM_PROMPT,
  buildTrendUserPrompt,
  getLlm,
  type LlmProvider,
  type TrendDraftBatch,
  type TrendSourceInput,
} from "@/lib/llm";
import type { GeekNewsRow, TrendMetrics, TrendSource } from "@/types/db";
import { SyncRun } from "./run-log";
import { fetchRecentPapers, paperContext } from "./sources/arxiv";
import { fetchAllTrending, fetchRepoContext } from "./sources/github-trending";
import { fetchStoryContext, fetchTopStories } from "./sources/hackernews";

/**
 * 트렌드 브리핑 동기화.
 *
 *   1. GitHub Trending(daily/weekly/monthly) · HN · arXiv 에서 후보 수집
 *   2. 이미 DB 에 있는 source_url 제외 → 신규만 남김
 *   3. 남은 신규를 출처별로 번갈아 뽑아 상한(maxNew) 안에 담음
 *   4. 뽑힌 항목의 본문 컨텍스트 수집 (README / 상위 댓글 / 초록)
 *   5. LLM 에 5건씩 묶어 보내 한국어 기사 생성 후 on conflict do nothing 으로 저장
 */

const BATCH_SIZE = 5;

/**
 * only 를 주지 않았을 때 수집하는 출처.
 *
 * 긱뉴스는 '긱뉴스 동기화'(geek_news 테이블)가 원문 그대로 담당하므로 기본값에서
 * 뺀다. 같은 글이 긱뉴스 데일리와 트렌드 브리핑에 두 번 실리는 것을 막는 것이
 * 목적이다. 필요하면 --only=geeknews 로 명시해 돌릴 수 있다.
 */
export const DEFAULT_TREND_SOURCES: readonly TrendSource[] = [
  "github",
  "hn",
  "arxiv",
] as const;

export interface TrendSyncOptions {
  maxNew?: number;
  hnMinScore?: number;
  dryRun?: boolean;
  provider?: "gemini" | "openai";
  trigger?: "schedule" | "manual" | "admin_ui";
  echo?: boolean;
  runId?: string;
  /** 특정 출처만 돌리고 싶을 때 */
  only?: TrendSource[];
}

export interface TrendSyncResult {
  runId: string | null;
  fetched: number;
  fresh: number;
  inserted: number;
  skipped: number;
}

interface Candidate {
  sourceUrl: string;
  source: TrendSource;
  sourceVariant: string | null;
  rawTitle: string;
  rawExcerpt: string | null;
  metrics: TrendMetrics;
  /** LLM 에 보낼 본문 컨텍스트를 만드는 함수 (신규 항목에만 호출) */
  loadContext: () => Promise<string>;
  sourceLabel: string;
}

// ---------------------------------------------------------------------------

export async function syncTrend(
  db: SupabaseClient,
  opts: TrendSyncOptions = {},
): Promise<TrendSyncResult> {
  const maxNew = opts.maxNew ?? 30;
  const hnMinScore = opts.hnMinScore ?? 150;
  const sources = new Set<TrendSource>(
    opts.only && opts.only.length > 0 ? opts.only : DEFAULT_TREND_SOURCES,
  );

  // dry-run 이면 LLM 을 아예 만들지 않는다 (키 없이도 수집 검증 가능).
  let llm: LlmProvider | null = null;
  if (!opts.dryRun) {
    llm = getLlm(opts.provider);
  }

  const run = opts.runId
    ? SyncRun.attach(db, opts.runId, {
        kind: "trend",
        provider: llm?.name ?? null,
        echo: opts.echo,
      })
    : await SyncRun.start(db, {
        kind: "trend",
        provider: llm?.name ?? null,
        trigger: opts.trigger ?? "manual",
        dryRun: opts.dryRun,
        echo: opts.echo,
      });

  try {
    const sourceList = [...sources].join(", ");
    run.log(
      llm
        ? `트렌드 브리핑 수집 시작 · ${llm.name}/${llm.model} · 출처 ${sourceList} · 최대 ${maxNew}건`
        : `트렌드 브리핑 수집 시작 · [dry-run] LLM 호출 없음 · 출처 ${sourceList}`,
    );

    // --- 1. 후보 수집 ------------------------------------------------------
    const candidates: Candidate[] = [];

    if (sources.has("github")) {
      const repos = await fetchAllTrending((period, count) =>
        run.log(`GitHub Trending ${period} · ${count}건`),
      );
      run.log(`GitHub Trending 합집합 ${repos.length}건 (중복 제거 후)`);
      for (const r of repos) {
        candidates.push({
          sourceUrl: r.url,
          source: "github",
          sourceVariant: r.period,
          rawTitle: r.fullName,
          rawExcerpt: r.description,
          metrics: {
            stars: r.stars,
            stars_in_period: r.starsInPeriod,
            language: r.language,
          },
          loadContext: () => fetchRepoContext(r),
          sourceLabel: `GitHub Trending (${r.period})`,
        });
      }
    }

    if (sources.has("hn")) {
      const stories = await fetchTopStories({ minScore: hnMinScore, limit: 25 });
      run.log(`Hacker News · 점수 ${hnMinScore} 이상 ${stories.length}건`);
      for (const st of stories) {
        candidates.push({
          sourceUrl: st.url,
          source: "hn",
          sourceVariant: "top",
          rawTitle: st.title,
          rawExcerpt: st.externalUrl,
          metrics: {
            points: st.score,
            comments: st.descendants,
            hn_external_url: st.externalUrl ?? undefined,
          },
          loadContext: () => fetchStoryContext(st),
          sourceLabel: "Hacker News",
        });
      }
    }

    if (sources.has("arxiv")) {
      const papers = await fetchRecentPapers({ limit: 40 });
      run.log(`arXiv · 신규 논문 ${papers.length}건`);
      for (const p of papers) {
        candidates.push({
          sourceUrl: p.url,
          source: "arxiv",
          sourceVariant: p.category,
          rawTitle: p.title,
          rawExcerpt: p.summary.slice(0, 400),
          metrics: { arxiv_id: p.arxivId, authors: p.authors.slice(0, 8) },
          loadContext: async () => paperContext(p),
          sourceLabel: `arXiv ${p.category}`,
        });
      }
    }

    if (sources.has("geeknews")) {
      // 방금 동기화된 긱뉴스에서 최근 것만 가져다 쓴다.
      const { data: geek } = await db
        .from("geek_news")
        .select("url, title, summary, points, external_url")
        .eq("is_hidden", false)
        .order("points", { ascending: false })
        .limit(15)
        .returns<Pick<GeekNewsRow, "url" | "title" | "summary" | "points" | "external_url">[]>();

      run.log(`긱뉴스 · 상위 ${geek?.length ?? 0}건`);
      for (const g of geek ?? []) {
        candidates.push({
          sourceUrl: g.url,
          source: "geeknews",
          sourceVariant: null,
          rawTitle: g.title,
          rawExcerpt: g.summary,
          metrics: { points: g.points },
          loadContext: async () =>
            [
              `제목: ${g.title}`,
              g.external_url ? `원문: ${g.external_url}` : "",
              `긱뉴스 요약:\n${g.summary}`,
            ]
              .filter(Boolean)
              .join("\n"),
          sourceLabel: "긱뉴스",
        });
      }
    }

    run.fetched = candidates.length;
    run.log(`후보 총 ${candidates.length}건 수집 완료`);

    if (candidates.length === 0) {
      run.log("수집된 후보가 없습니다.", "warn");
      await run.finish("success");
      return { runId: run.id, fetched: 0, fresh: 0, inserted: 0, skipped: 0 };
    }

    // --- 2. 기존 URL 제외 ---------------------------------------------------
    const urls = candidates.map((c) => c.sourceUrl);
    const known = new Set<string>();

    // in() 은 URL 이 길어 한 번에 다 넣으면 요청이 커진다. 100개씩 나눈다.
    for (let i = 0; i < urls.length; i += 100) {
      const { data, error } = await db
        .from("trend_items")
        .select("source_url")
        .in("source_url", urls.slice(i, i + 100))
        .returns<{ source_url: string }[]>();
      if (error) throw new Error(`기존 항목 조회 실패: ${error.message}`);
      for (const r of data ?? []) known.add(r.source_url);
    }

    const unseen = candidates.filter((c) => !known.has(c.sourceUrl));
    run.skipped = candidates.length - unseen.length;
    run.log(
      `신규 ${unseen.length}건 (${countLabel(unseen)}) · 이미 있는 항목 ${run.skipped}건 건너뜀`,
    );

    // 상한 안에서 출처를 골고루 담는다.
    //
    // 후보는 출처 순서대로 쌓이는데, GitHub Trending 은 daily/weekly/monthly 를
    // 합쳐 수십 건이 나온다. 앞에서부터 그냥 자르면 상한 30건이 GitHub 으로만
    // 채워지고 HN·arXiv 는 매일 밀려 한 건도 실리지 않는다. 출처별로 번갈아
    // 뽑아 상한을 나눠 쓴다.
    const fresh = takeRoundRobin(unseen, maxNew);

    if (fresh.length < unseen.length) {
      run.log(
        `상한 ${maxNew}건 · 출처별로 나눠 담아 ${fresh.length}건 선정 (${countLabel(fresh)})`,
      );
      run.log(
        `${unseen.length - fresh.length}건은 이번 실행에서 제외 (다음 실행에서 수집됨)`,
        "warn",
      );
    }

    run.fresh = fresh.length;

    if (fresh.length === 0) {
      await run.finish("success");
      return {
        runId: run.id,
        fetched: candidates.length,
        fresh: 0,
        inserted: 0,
        skipped: run.skipped,
      };
    }

    // --- 3. 컨텍스트 수집 ---------------------------------------------------
    if (opts.dryRun) {
      run.log(`[dry-run] LLM 호출 없이 종료 — 기사화 대상 ${fresh.length}건`, "warn");
      for (const c of fresh.slice(0, 15)) {
        run.log(`  · [${c.sourceLabel}] ${c.rawTitle}  (${c.sourceUrl})`);
      }
      if (fresh.length > 15) run.log(`  … 외 ${fresh.length - 15}건`);
      await run.finish("success");
      return {
        runId: run.id,
        fetched: candidates.length,
        fresh: fresh.length,
        inserted: 0,
        skipped: run.skipped,
      };
    }

    run.log(`본문 컨텍스트 수집 중… (${fresh.length}건)`);
    const withContext: (Candidate & { context: string })[] = [];
    for (const c of fresh) {
      try {
        withContext.push({ ...c, context: await c.loadContext() });
      } catch (e) {
        run.log(
          `컨텍스트 수집 실패 · ${c.sourceUrl} — ${e instanceof Error ? e.message : e}`,
          "warn",
        );
      }
    }
    run.log(`컨텍스트 ${withContext.length}건 확보`);

    // --- 4~5. 배치 생성 + 저장 ----------------------------------------------
    const batches = chunk(withContext, BATCH_SIZE);
    run.log(`${batches.length}개 배치로 기사 생성 시작 (배치당 ${BATCH_SIZE}건)`);

    let inserted = 0;

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      const inputs: TrendSourceInput[] = batch.map((c, i) => ({
        index: i,
        sourceLabel: c.sourceLabel,
        url: c.sourceUrl,
        context: c.context,
      }));

      let drafts: TrendDraftBatch;
      try {
        drafts = await llm!.generateJson<TrendDraftBatch>({
          system: TREND_SYSTEM_PROMPT,
          user: buildTrendUserPrompt(inputs),
          schema: TREND_BATCH_SCHEMA,
        });
      } catch (e) {
        run.log(
          `배치 ${bi + 1}/${batches.length} 생성 실패 — ${e instanceof Error ? e.message : e}`,
          "error",
        );
        continue;
      }

      const rows = [];
      for (const d of drafts.articles ?? []) {
        const c = batch[d.index];
        if (!c) {
          run.log(`배치 ${bi + 1} · 알 수 없는 index ${d.index} 무시`, "warn");
          continue;
        }
        if (!d.title?.trim() || !Array.isArray(d.body) || d.body.length === 0) {
          run.log(`배치 ${bi + 1} · 내용이 비어 ${c.sourceUrl} 건너뜀`, "warn");
          continue;
        }

        rows.push({
          source_url: c.sourceUrl,
          source: c.source,
          source_variant: c.sourceVariant,
          raw_title: c.rawTitle,
          raw_excerpt: c.rawExcerpt,
          metrics: c.metrics,
          title: d.title.trim(),
          deck: d.deck?.trim() || null,
          body: d.body.filter((b) => b.t?.trim()),
          tags: (d.tags ?? []).slice(0, 4).map((t) => t.trim()).filter(Boolean),
          llm_provider: llm!.name,
          llm_model: llm!.model,
          status: "published",
          collected_date: kstDateString(),
        });
      }

      if (rows.length === 0) {
        run.log(`배치 ${bi + 1}/${batches.length} · 저장할 기사 없음`, "warn");
        continue;
      }

      const { data: saved, error } = await db
        .from("trend_items")
        .upsert(rows, { onConflict: "source_url", ignoreDuplicates: true })
        .select("source_url")
        .returns<{ source_url: string }[]>();

      if (error) {
        run.log(`배치 ${bi + 1} 저장 실패 — ${error.message}`, "error");
        continue;
      }

      inserted += saved?.length ?? 0;
      run.inserted = inserted;
      run.log(`배치 ${bi + 1}/${batches.length} · ${saved?.length ?? 0}건 저장`);
    }

    await run.finish("success");
    return {
      runId: run.id,
      fetched: candidates.length,
      fresh: fresh.length,
      inserted,
      skipped: run.skipped,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await run.finish("failed", msg);
    throw e;
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * 출처별로 한 건씩 번갈아 뽑아 cap 건까지 채운다.
 *
 * 각 출처 안의 순서(GitHub 은 트렌딩 순위, arXiv 는 최신순)는 그대로 유지되고,
 * 어느 출처가 후보를 많이 내도 다른 출처의 자리를 빼앗지 않는다. 어떤 출처가
 * 먼저 바닥나면 남은 자리는 후보가 남은 출처들이 나눠 갖는다.
 */
function takeRoundRobin(items: Candidate[], cap: number): Candidate[] {
  if (cap <= 0) return [];
  if (items.length <= cap) return items;

  // Map 은 삽입 순서를 지키므로 출처 순서는 후보를 쌓은 순서와 같다.
  const queues = new Map<TrendSource, Candidate[]>();
  for (const c of items) {
    const q = queues.get(c.source);
    if (q) q.push(c);
    else queues.set(c.source, [c]);
  }

  const picked: Candidate[] = [];
  while (picked.length < cap) {
    let movedAny = false;
    for (const q of queues.values()) {
      if (q.length === 0) continue;
      picked.push(q.shift()!);
      movedAny = true;
      if (picked.length >= cap) break;
    }
    if (!movedAny) break;
  }
  return picked;
}

/** 'github 10 · hn 10 · arxiv 10' — 로그용 출처별 건수 */
function countLabel(items: Candidate[]): string {
  const counts = new Map<TrendSource, number>();
  for (const c of items) counts.set(c.source, (counts.get(c.source) ?? 0) + 1);
  return [...counts].map(([source, n]) => `${source} ${n}`).join(" · ") || "없음";
}

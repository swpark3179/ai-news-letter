import type { SupabaseClient } from "@supabase/supabase-js";
import { blockHasContent, listItems } from "@/lib/blocks";
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
import type { Block, GeekNewsRow, TrendMetrics, TrendSource } from "@/types/db";
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
 *
 * preview 면 2를 건너뛰고(이미 실린 항목도 다시 써 본다) 5에서 저장하지 않는다.
 * 만든 기사는 결과의 previews 로 돌려준다 — 프롬프트를 고친 뒤 운영 DB 를 건드리지
 * 않고 품질을 보는 길이다.
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
  /**
   * LLM 으로 기사를 만들되 저장하지 않는다. 이미 저장된 URL 도 거르지 않으므로
   * maxNew 를 작게 준다. dryRun 과 함께 주면 dryRun 이 이긴다 (LLM 도 안 부른다).
   * sync_runs 에도 남기지 않는다 — 워치독이 "돌았다" 로 세지 않게.
   */
  preview?: boolean;
  provider?: "gemini" | "openai";
  trigger?: "schedule" | "manual";
  echo?: boolean;
  /** 특정 출처만 돌리고 싶을 때 */
  only?: TrendSource[];
}

export interface TrendSyncResult {
  runId: string | null;
  fetched: number;
  fresh: number;
  inserted: number;
  skipped: number;
  /** 수집에 실패해 이번 실행에서 빠진 출처 (나머지 출처로 계속 진행한다) */
  failedSources: TrendSource[];
  /** preview 로 만든 기사. preview 가 아니면 비어 있다. */
  previews: TrendPreview[];
}

export interface TrendPreview {
  sourceUrl: string;
  source: TrendSource;
  sourceLabel: string;
  title: string;
  deck: string | null;
  body: Block[];
  tags: string[];
  /** 이미 실려 있던 항목이면 지금 실린 제목 · 덱 (비교용) */
  previous: { title: string; deck: string | null } | null;
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

  const preview = !!opts.preview && !opts.dryRun;
  const previews: TrendPreview[] = [];

  // dry-run 이면 LLM 을 아예 만들지 않는다 (키 없이도 수집 검증 가능).
  let llm: LlmProvider | null = null;
  if (!opts.dryRun) {
    llm = getLlm(opts.provider);
  }

  // preview 도 sync_runs 에 흔적을 남기지 않는다. 남기면 워치독이 그 기록을
  // "이 회차는 돌았다" 로 읽고 정작 빠진 정기 실행을 대신 돌리지 않는다.
  const run = await SyncRun.start(db, {
    kind: "trend",
    provider: llm?.name ?? null,
    trigger: opts.trigger ?? "manual",
    dryRun: opts.dryRun || preview,
    echo: opts.echo,
  });

  try {
    const sourceList = [...sources].join(", ");
    run.log(
      !llm
        ? `트렌드 브리핑 수집 시작 · [dry-run] LLM 호출 없음 · 출처 ${sourceList}`
        : preview
          ? `트렌드 브리핑 미리보기 · ${llm.name}/${llm.model} · 출처 ${sourceList} · 최대 ${maxNew}건 · [preview] 저장하지 않음`
          : `트렌드 브리핑 수집 시작 · ${llm.name}/${llm.model} · 출처 ${sourceList} · 최대 ${maxNew}건`,
    );

    // --- 1. 후보 수집 ------------------------------------------------------
    //
    // 출처 하나가 죽어도 나머지는 살린다. 예전에는 arXiv 가 429 하나만 뱉어도
    // 이미 모아 둔 GitHub·HN 후보까지 통째로 버리고 실행 전체가 실패했다.
    const candidates: Candidate[] = [];
    const failedSources: TrendSource[] = [];

    const collect = async (source: TrendSource, label: string, fn: () => Promise<void>) => {
      if (!sources.has(source)) return;
      try {
        await fn();
      } catch (e) {
        failedSources.push(source);
        run.log(
          `${label} 수집 실패 — ${e instanceof Error ? e.message : e} · 이 출처 없이 계속합니다`,
          "error",
        );
      }
    };

    await collect("github", "GitHub Trending", async () => {
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
    });

    await collect("hn", "Hacker News", async () => {
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
    });

    await collect("arxiv", "arXiv", async () => {
      // 재시도·RSS 대체 수집 상황을 실행 로그에 그대로 흘린다.
      const papers = await fetchRecentPapers({
        limit: 40,
        log: (msg, level) => run.log(msg, level),
      });
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
    });

    await collect("geeknews", "긱뉴스", async () => {
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
    });

    // 요청한 출처가 전부 죽었으면 그건 진짜 실패다. 일부만 죽었으면 경고만
    // 남기고 남은 출처로 기사를 만든다.
    if (failedSources.length >= sources.size) {
      throw new Error(`모든 출처 수집 실패 (${failedSources.join(", ")})`);
    }
    if (failedSources.length > 0) {
      run.log(`${failedSources.join(", ")} 출처 없이 진행합니다`, "warn");
    }

    run.fetched = candidates.length;
    run.log(`후보 총 ${candidates.length}건 수집 완료`);

    if (candidates.length === 0) {
      run.log("수집된 후보가 없습니다.", "warn");
      await run.finish("success");
      return { runId: run.id, fetched: 0, fresh: 0, inserted: 0, skipped: 0, failedSources, previews };
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

    const unseen = preview ? candidates : candidates.filter((c) => !known.has(c.sourceUrl));
    run.skipped = candidates.length - unseen.length;
    run.log(
      preview
        ? `[preview] 이미 있는 항목 ${known.size}건도 다시 써 본다 (${countLabel(unseen)})`
        : `신규 ${unseen.length}건 (${countLabel(unseen)}) · 이미 있는 항목 ${run.skipped}건 건너뜀`,
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
        failedSources,
        previews,
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
        failedSources,
        previews,
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

    // preview 로 이미 실린 항목을 다시 쓸 때, 지금 실린 제목 · 덱을 나란히 보여 준다.
    const previous = new Map<string, { title: string; deck: string | null }>();
    if (preview) {
      const again = withContext.map((c) => c.sourceUrl).filter((u) => known.has(u));
      if (again.length > 0) {
        const { data } = await db
          .from("trend_items")
          .select("source_url, title, deck")
          .in("source_url", again)
          .returns<{ source_url: string; title: string; deck: string | null }[]>();
        for (const r of data ?? []) previous.set(r.source_url, { title: r.title, deck: r.deck });
      }
    }

    // --- 4~5. 배치 생성 + 저장 ----------------------------------------------
    const batches = chunk(withContext, BATCH_SIZE);
    run.log(`${batches.length}개 배치로 기사 생성 시작 (배치당 ${BATCH_SIZE}건)`);

    let inserted = 0;

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      const inputs: TrendSourceInput[] = batch.map((c, i) => ({
        index: i,
        source: c.source,
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
        const body = normalizeDraftBody(d.body);

        if (!d.title?.trim() || body.length === 0) {
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
          body,
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

      if (preview) {
        for (const r of rows) {
          const c = batch.find((x) => x.sourceUrl === r.source_url)!;
          previews.push({
            sourceUrl: r.source_url,
            source: r.source,
            sourceLabel: c.sourceLabel,
            title: r.title,
            deck: r.deck,
            body: r.body,
            tags: r.tags,
            previous: previous.get(r.source_url) ?? null,
          });
        }
        run.log(`배치 ${bi + 1}/${batches.length} · ${rows.length}건 생성 (저장하지 않음)`);
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

    if (preview) run.log(`[preview] 기사 ${previews.length}건 생성 · 저장 0건`, "done");

    await run.finish("success");
    return {
      runId: run.id,
      fetched: candidates.length,
      fresh: fresh.length,
      inserted,
      skipped: run.skipped,
      failedSources,
      previews,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await run.finish("failed", msg);
    throw e;
  }
}

/**
 * LLM 이 낸 본문 블록을 저장할 모양으로 다듬는다.
 *
 * 스키마로 모양을 요구하지만 Gemini 는 어길 때가 있다 — t 를 빼먹거나, 없는 타입
 * ("bullets" 따위)을 만들거나, list 항목에 글머리 기호를 붙인다. 저장 경로는 여기
 * 하나뿐이고 웹 · 앱은 body 를 그대로 읽으므로 여기서 거른다.
 *   - t 가 문자열이 아니면 버린다.
 *   - 모르는 타입은 text 로 바꾼다 (내용은 살린다).
 *   - type · t 말고 다른 속성은 떼어 낸다.
 *   - list 는 listItems 로 정리한 항목을 줄바꿈으로 다시 잇는다. 앱은 이 블록을
 *     줄바꿈 문단으로 보여 주므로 저장값이 깨끗해야 한다.
 *   - 빈 블록은 필터와 같은 기준(blockHasContent)으로 버린다. 예전에는 length 만
 *     봐서, 공백만 든 블록으로 채워진 draft 가 통과해 body: [] 로 발행됐다.
 */
export function normalizeDraftBody(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  const out: Block[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { type, t } = item as { type?: unknown; t?: unknown };
    if (typeof t !== "string") continue;

    const block: Block = {
      type: type === "head" || type === "quote" || type === "list" ? type : "text",
      t,
    };
    if (block.type === "list") block.t = listItems(block).join("\n");
    if (blockHasContent(block)) out.push(block);
  }
  return out;
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

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HadaContentStatus, HadaSourceKind } from "@/types/db";
import { HttpError } from "./http";
import type { SyncRun } from "./run-log";
import { fetchTopicContent, MAX_BODY_CHARS } from "./sources/hada-topic";

/**
 * 긱뉴스 / 쇼케이스 **본문** 수집 단계.
 *
 * 목록 수집(geeknews.ts / showcase.ts)이 항목 행을 넣고 나면 이 단계가 각
 * 상세 페이지를 열어 본문을 hada_contents 에 적재한다. 두 수집기가 같은 코드를
 * 쓴다 — 상세 페이지 구조가 같아서다.
 *
 * 설계 두 가지.
 *
 *   1) 예산제. 한 실행에서 정해진 건수만 받는다. 이번 실행의 신규 항목을 먼저
 *      채우고, 예산이 남으면 아직 본문이 없는 과거 항목을 채운다. 그래서 처음
 *      켤 때도 별도 백필 작업 없이 며칠에 걸쳐 저절로 메워진다.
 *
 *   2) 항목 수집을 절대 실패시키지 않는다. 본문은 부가물이고 목록 적재가 본류다.
 *      호출부가 try/catch 로 감싸며, 이 안에서도 개별 항목 실패는 행에 상태로
 *      남길 뿐 예외로 올리지 않는다.
 */

/** 소스별 항목 테이블. PK(url) 규칙이 양쪽에서 같아 본문 테이블 하나를 공유한다. */
const ITEM_TABLE: Record<HadaSourceKind, string> = {
  geeknews: "geek_news",
  showcase: "showcase_items",
};

/** 한 실행에서 받아 올 최대 건수. */
const DEFAULT_MAX_PER_RUN = 40;

/**
 * 백필 후보로 훑을 최근 항목 수.
 *
 * 여기서 더 옛날 것은 채우지 않는다. 앱이 보여 줄 범위를 한참 넘어서고,
 * 그만큼 요청과 용량만 쓴다.
 */
const CANDIDATE_WINDOW = 300;

/** 이만큼 실패하면 그 항목은 포기한다 (삭제된 글, 영구 404 등). */
const MAX_ATTEMPTS = 3;

/** 요청 간격 — 목록 크롤과 같은 예절. news.hada.io 는 연속 요청에 403 을 준다. */
const DEFAULT_DELAY_MS = 1500;

/** PostgREST 의 .in() 에 한 번에 넣을 최대 개수 (trend 수집기와 같은 값). */
const IN_CHUNK = 100;

export interface HadaContentSyncOptions {
  source: HadaSourceKind;
  /** 이번 실행에서 새로 넣은 URL — 예산을 가장 먼저 여기에 쓴다. */
  freshUrls?: string[];
  maxPerRun?: number;
  delayMs?: number;
  dryRun?: boolean;
  /** 목록 수집의 실행 로그에 이어 쓴다. */
  run: SyncRun;
}

export interface HadaContentSyncResult {
  attempted: number;
  ok: number;
  failed: number;
  /** 예산이 모자라 이번에 못 채운 건수 */
  remaining: number;
}

interface ExistingContent {
  url: string;
  status: HadaContentStatus;
  attempts: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** hada_contents 에서 주어진 URL 들의 현재 상태를 읽는다. */
async function loadExisting(
  db: SupabaseClient,
  urls: string[],
): Promise<Map<string, ExistingContent>> {
  const map = new Map<string, ExistingContent>();

  for (const part of chunk(urls, IN_CHUNK)) {
    const { data, error } = await db
      .from("hada_contents")
      .select("url, status, attempts")
      .in("url", part)
      .returns<ExistingContent[]>();

    if (error) throw new Error(`본문 상태 조회 실패: ${error.message}`);
    for (const row of data ?? []) map.set(row.url, row);
  }

  return map;
}

/**
 * 이번 실행에서 본문을 받아 올 URL 을 고른다.
 *
 * 신규 항목 → 아직 한 번도 시도 안 한 과거 항목(최신순) → 재시도 가능한 실패
 * 항목(시도 횟수 적은 순). status = 'ok' 인 항목은 다시 받지 않는다.
 */
async function pickTargets(
  db: SupabaseClient,
  source: HadaSourceKind,
  freshUrls: string[],
): Promise<{
  untried: string[];
  retry: string[];
  givenUp: number;
  /** 조회해 둔 현재 상태 — 호출부가 다시 읽지 않도록 함께 넘긴다. */
  existing: Map<string, ExistingContent>;
}> {
  const { data: recent, error } = await db
    .from(ITEM_TABLE[source])
    .select("url")
    .order("published_at", { ascending: false })
    .limit(CANDIDATE_WINDOW)
    .returns<{ url: string }[]>();

  if (error) throw new Error(`항목 목록 조회 실패: ${error.message}`);

  // 신규분을 맨 앞에 두고 중복을 없앤다.
  const candidates = [...new Set([...freshUrls, ...(recent ?? []).map((r) => r.url)])];
  const existing = await loadExisting(db, candidates);

  const untried: string[] = [];
  const retry: { url: string; attempts: number }[] = [];
  let givenUp = 0;

  for (const url of candidates) {
    const row = existing.get(url);
    if (!row) {
      untried.push(url);
    } else if (row.status === "ok") {
      continue;
    } else if (row.attempts >= MAX_ATTEMPTS) {
      givenUp++;
    } else {
      retry.push({ url, attempts: row.attempts });
    }
  }

  retry.sort((a, b) => a.attempts - b.attempts);
  return { untried, retry: retry.map((r) => r.url), givenUp, existing };
}

/** 개별 항목 하나를 받아 저장할 행으로 만든다. 예외를 밖으로 내보내지 않는다. */
async function buildRow(
  url: string,
  source: HadaSourceKind,
  attempts: number,
  delayMs: number,
): Promise<Record<string, unknown> & { status: HadaContentStatus }> {
  const now = new Date().toISOString();
  const base = { url, source, attempts: attempts + 1, fetched_at: now, updated_at: now };

  try {
    const c = await fetchTopicContent(url, { delayMs, maxChars: MAX_BODY_CHARS });
    return {
      ...base,
      body_md: c.bodyMd,
      body_chars: c.chars,
      truncated: c.truncated,
      status: c.status,
      container: c.container,
      content_hash: c.bodyMd ? createHash("md5").update(c.bodyMd).digest("hex") : null,
      last_error: c.status === "ok" ? null : `본문을 뽑지 못했습니다 (${c.status})`,
    };
  } catch (e) {
    const msg =
      e instanceof HttpError
        ? `HTTP ${e.status}`
        : e instanceof Error
          ? e.message
          : String(e);
    return {
      ...base,
      body_md: "",
      body_chars: 0,
      truncated: false,
      status: "fetch_failed" as const,
      container: null,
      content_hash: null,
      last_error: msg.slice(0, 500),
    };
  }
}

/**
 * 본문 수집 한 판.
 *
 * 실패해도 예외를 던지지 않는다 — 반환값과 실행 로그로만 알린다. 목록 적재가
 * 이미 끝난 뒤에 도는 단계라, 여기서 터뜨리면 멀쩡한 수집이 빨간 실패로 뒤집힌다.
 */
export async function syncHadaContents(
  db: SupabaseClient,
  opts: HadaContentSyncOptions,
): Promise<HadaContentSyncResult> {
  const { source, run, freshUrls = [], dryRun = false } = opts;
  const maxPerRun =
    opts.maxPerRun ?? (Number(process.env.HADA_CONTENT_MAX_PER_RUN) || DEFAULT_MAX_PER_RUN);
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;

  const empty: HadaContentSyncResult = { attempted: 0, ok: 0, failed: 0, remaining: 0 };
  if (maxPerRun <= 0) {
    run.log("본문 수집 건너뜀 — 예산이 0 입니다.", "warn");
    return empty;
  }

  const { untried, retry, givenUp, existing } = await pickTargets(db, source, freshUrls);
  const queue = [...untried, ...retry];

  if (givenUp > 0) {
    run.log(`본문 ${givenUp}건은 ${MAX_ATTEMPTS}회 실패해 더 시도하지 않습니다.`, "warn");
  }

  if (queue.length === 0) {
    run.log("본문 수집 대상 없음 — 모두 채워져 있습니다.");
    return empty;
  }

  const targets = queue.slice(0, maxPerRun);
  const remaining = queue.length - targets.length;

  run.log(
    `본문 수집 · 대상 ${targets.length}건 (신규·미시도 ${untried.length} / 재시도 ${retry.length}` +
      `${remaining > 0 ? ` · 예산 밖 ${remaining}건은 다음 실행에서` : ""})`,
  );

  const rows: (Record<string, unknown> & { status: HadaContentStatus })[] = [];
  const tally: Record<HadaContentStatus, number> = {
    ok: 0,
    empty: 0,
    parse_failed: 0,
    fetch_failed: 0,
  };

  for (const [i, url] of targets.entries()) {
    // 첫 건에도 간격을 준다 — 목록 크롤이 방금 같은 호스트를 친 참이라
    // 곧바로 이어 치면 403 을 부른다.
    const row = await buildRow(url, source, existing.get(url)?.attempts ?? 0, delayMs);
    rows.push(row);
    tally[row.status]++;

    if (row.status !== "ok") {
      run.log(`  ! ${url} — ${row.last_error}`, "warn");
    }
    if ((i + 1) % 10 === 0) {
      run.log(`  · ${i + 1}/${targets.length} 진행`);
    }
  }

  const okRows = rows.filter((r) => r.status === "ok");
  const avgChars =
    okRows.length > 0
      ? Math.round(
          okRows.reduce((s, r) => s + (r.body_chars as number), 0) / okRows.length,
        )
      : 0;

  run.log(
    `본문 결과 — 성공 ${tally.ok} · 빈 본문 ${tally.empty} · 파싱 실패 ${tally.parse_failed}` +
      ` · 요청 실패 ${tally.fetch_failed} (성공분 평균 ${avgChars}자)`,
  );

  // 파싱 실패가 절반을 넘으면 셀렉터가 깨졌다고 보는 편이 맞다.
  // 조용히 넘기면 며칠치 본문이 빈 채로 쌓인다.
  if (tally.parse_failed > targets.length / 2) {
    run.log(
      `본문 컨테이너를 대부분 찾지 못했습니다 — 상세 페이지 마크업이 바뀌었을 수 있습니다. ` +
        `sources/hada-topic.ts 의 BODY_SELECTORS 를 확인하세요 ` +
        `(npm run sync:hada-content -- --url=<토픽 URL> 로 진단).`,
      "error",
    );
  }

  if (dryRun) {
    run.log(`[dry-run] 본문을 저장하지 않고 끝냅니다 — ${rows.length}건`, "warn");
    return {
      attempted: targets.length,
      ok: tally.ok,
      failed: targets.length - tally.ok,
      remaining,
    };
  }

  // 항목 테이블과 달리 ignoreDuplicates 를 쓰지 않는다 —
  // 재시도 이력(attempts / status / last_error)을 갱신해야 하기 때문이다.
  const { error: upErr } = await db
    .from("hada_contents")
    .upsert(rows, { onConflict: "url" });

  if (upErr) {
    run.log(`본문 저장 실패: ${upErr.message}`, "error");
    return { attempted: targets.length, ok: 0, failed: targets.length, remaining };
  }

  return {
    attempted: targets.length,
    ok: tally.ok,
    failed: targets.length - tally.ok,
    remaining,
  };
}

/**
 * syncHadaContents 를 감싸 **절대 던지지 않게** 만든다.
 *
 * 목록 적재가 끝난 뒤에 도는 단계라, 여기서 예외가 올라가면 멀쩡히 저장된
 * 수집이 통째로 빨간 실패가 된다. 본문은 다음 실행에서 다시 시도하면 된다.
 */
export async function runContentStage(
  db: SupabaseClient,
  opts: HadaContentSyncOptions,
): Promise<HadaContentSyncResult | null> {
  try {
    return await syncHadaContents(db, opts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    opts.run.log(`본문 수집을 건너뜁니다 — ${msg}`, "warn");
    return null;
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { hhmmss } from "@/lib/format";
import type { LlmProviderName, SyncLogEntry } from "@/types/db";

/**
 * sync_runs 행 하나의 수명을 관리한다.
 *
 * 관리자 화면의 pipeline.log 콘솔이 이 행을 폴링하므로, 로그는 쌓는 즉시
 * DB 에 반영한다 (약간의 쓰기 비용을 감수하고 실시간성을 택함).
 */

export interface SyncRunOptions {
  kind: "geeknews" | "trend";
  provider?: LlmProviderName | null;
  trigger?: "schedule" | "manual" | "admin_ui";
  dryRun?: boolean;
  /** true 면 콘솔에도 같이 찍는다 (CLI 실행용) */
  echo?: boolean;
}

export class SyncRun {
  readonly db: SupabaseClient;
  readonly kind: "geeknews" | "trend";
  readonly dryRun: boolean;

  private readonly echo: boolean;
  private readonly entries: SyncLogEntry[] = [];
  private flushing: Promise<void> = Promise.resolve();

  id: string | null = null;
  fetched = 0;
  fresh = 0;
  inserted = 0;
  skipped = 0;

  private constructor(db: SupabaseClient, opts: SyncRunOptions) {
    this.db = db;
    this.kind = opts.kind;
    this.dryRun = opts.dryRun ?? false;
    this.echo = opts.echo ?? false;
  }

  static async start(db: SupabaseClient, opts: SyncRunOptions): Promise<SyncRun> {
    const run = new SyncRun(db, opts);

    // dry-run 은 DB 에 흔적을 남기지 않는다.
    if (!run.dryRun) {
      const { data, error } = await db
        .from("sync_runs")
        .insert({
          kind: opts.kind,
          provider: opts.provider ?? null,
          trigger: opts.trigger ?? "manual",
          status: "running",
        })
        .select("id")
        .single<{ id: string }>();

      if (error) throw new Error(`sync_runs 생성 실패: ${error.message}`);
      run.id = data.id;
    }

    return run;
  }

  /** 기존 실행 행에 이어 붙인다 (API 가 미리 행을 만들고 넘겨줄 때). */
  static attach(db: SupabaseClient, id: string, opts: SyncRunOptions): SyncRun {
    const run = new SyncRun(db, opts);
    run.id = id;
    return run;
  }

  log(msg: string, level: SyncLogEntry["level"] = "info"): void {
    const entry: SyncLogEntry = { at: hhmmss(new Date()), level, msg };
    this.entries.push(entry);
    if (this.echo) {
      const prefix = level === "error" ? "✗" : level === "warn" ? "!" : level === "done" ? "✓" : "·";
      console.log(`[${entry.at}] ${prefix} ${msg}`);
    }
    this.queueFlush();
  }

  /** 로그 쓰기를 직렬화해 경합 없이 순서를 유지한다. */
  private queueFlush(): void {
    if (this.dryRun || !this.id) return;
    this.flushing = this.flushing.then(() => this.flush()).catch(() => {});
  }

  private async flush(): Promise<void> {
    if (!this.id) return;
    await this.db
      .from("sync_runs")
      .update({
        logs: this.entries,
        fetched_count: this.fetched,
        new_count: this.fresh,
        inserted_count: this.inserted,
        skipped_count: this.skipped,
      })
      .eq("id", this.id);
  }

  async finish(status: "success" | "failed", error?: string): Promise<void> {
    if (status === "success") {
      this.log(
        `완료 — 수집 ${this.fetched}건 · 신규 ${this.fresh}건 · 저장 ${this.inserted}건 · 건너뜀 ${this.skipped}건`,
        "done",
      );
    } else if (error) {
      this.log(error, "error");
    }

    await this.flushing;
    if (this.dryRun || !this.id) return;

    await this.db
      .from("sync_runs")
      .update({
        status,
        finished_at: new Date().toISOString(),
        logs: this.entries,
        fetched_count: this.fetched,
        new_count: this.fresh,
        inserted_count: this.inserted,
        skipped_count: this.skipped,
        error: error ?? null,
      })
      .eq("id", this.id);
  }

  get logs(): SyncLogEntry[] {
    return this.entries;
  }
}

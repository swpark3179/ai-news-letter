import { config as loadEnv } from "dotenv";
import { enableEnvProxy } from "@/lib/proxy";

/**
 * CLI 공통 부트스트랩.
 * 로컬에서는 .env.local 을, CI 에서는 이미 주입된 환경변수를 쓴다.
 */
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

// 사내 프록시 환경이면 내장 fetch 가 이를 따라가도록 켠다 (첫 fetch 이전이어야 함).
const proxy = enableEnvProxy();
if (proxy) console.log(`· 프록시 사용: ${proxy}`);

export interface CliArgs {
  dryRun: boolean;
  limit: number | null;
  provider: "gemini" | "openai" | undefined;
  days: number | null;
  only: string[] | null;
  help: boolean;
}

export function parseArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const args: CliArgs = {
    dryRun: false,
    limit: null,
    provider: undefined,
    days: null,
    only: null,
    help: false,
  };

  for (const raw of argv) {
    const [key, value] = raw.includes("=") ? raw.split("=") : [raw, undefined];
    switch (key) {
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--limit":
        args.limit = Number(value);
        break;
      case "--provider":
        if (value === "gemini" || value === "openai") args.provider = value;
        break;
      case "--days":
        args.days = Number(value);
        break;
      case "--only":
        args.only = (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        break;
    }
  }

  return args;
}

export function requireSupabaseEnv(): void {
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter(
    (k) => !process.env[k],
  );
  if (missing.length > 0) {
    console.error(
      `\n환경변수가 없습니다: ${missing.join(", ")}\n` +
        `.env.local 을 만들거나(.env.local.example 참고) GitHub Secrets 를 확인하세요.\n`,
    );
    process.exit(1);
  }
}

export function fail(e: unknown): never {
  console.error("\n✗ 실패:", e instanceof Error ? e.message : e);
  if (e instanceof Error && e.stack) {
    console.error(e.stack.split("\n").slice(1, 4).join("\n"));
  }
  process.exit(1);
}

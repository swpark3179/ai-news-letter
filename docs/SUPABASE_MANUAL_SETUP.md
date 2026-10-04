# Supabase 설정 절차

새 Supabase 프로젝트를 이 저장소로 세우는 단계별 안내입니다. 대시보드만으로
**10분 안팎**이면 끝납니다.

표 구조 · 권한 설계 · 운영 쿼리 같은 참고 내용은 [SUPABASE_SETUP.md](SUPABASE_SETUP.md)
에 있습니다. 이 문서는 「무엇을 순서대로 하면 되는가」만 다룹니다.

| 단계 | 내용 | 소요 |
|---|---|---|
| [1](#1단계--프로젝트와-키) | 프로젝트와 키 | 2분 |
| [2](#2단계--스키마-적용) | 스키마 적용 | 2분 |
| [3](#3단계--적용-확인) | 적용 확인 | 2분 |
| [4](#4단계--키-나눠-넣기) | 키 나눠 넣기 | 2분 |
| [5](#5단계--데이터-채우고-확인) | 데이터 채우고 확인 | 3분 |

Storage 버킷과 Supabase Auth 는 **쓰지 않습니다.** 웹도 앱도 로그인이 없고 파일을
올리지 않습니다.

---

## 1단계 — 프로젝트와 키

https://supabase.com/dashboard 에서 **New project** 를 만듭니다. 운영은
`Northeast Asia (Tokyo)` 이고, Vercel 함수는 Seoul(`icn1`)에서 돕니다.

**Project Settings → API** 에서 세 값을 복사합니다.

| 값 | 누가 쓰나 | 어디에 넣나 |
|---|---|---|
| Project URL (`https://<ref>.supabase.co`) | 웹 · 앱 · 수집기 | 모두 |
| `anon` 키 (publishable 키도 됩니다) | **웹 · 앱** | Vercel 환경변수 · 앱 빌드 설정 |
| `service_role` 키 (secret) | **수집기만** | GitHub Actions Secrets · 로컬 `.env.local` |

> `anon` 키로 열리는 것은 모바일 뷰 5개의 SELECT 뿐입니다(`0018`). 공개 키라
> 앱 바이너리에 들어가도 괜찮습니다.
>
> `service_role` 은 RLS 를 우회하는 마스터 키입니다. **Vercel 에도, 앱에도 넣지
> 마세요.** 수집 스크립트만 씁니다.

---

## 2단계 — 스키마 적용

마이그레이션 22개를 하나로 합친 **`supabase/ALL_MIGRATIONS.sql`** 을 씁니다.

```powershell
Get-Content supabase/ALL_MIGRATIONS.sql -Raw | Set-Clipboard   # Windows
```

```bash
pbcopy < supabase/ALL_MIGRATIONS.sql                           # macOS
```

대시보드 → **SQL Editor** → **New query** → 붙여넣기 → **Run**.
`Success. No rows returned` 이 뜨면 성공입니다. SQL Editor 는 붙여넣은 내용을 한
트랜잭션으로 돌리므로, 중간에 실패하면 아무것도 남지 않습니다 — 원인을 고치고
다시 Run 하면 됩니다.

### 만들어지는 것

```
public 표 6개    geek_news  showcase_items  trend_items  hada_contents   콘텐츠
                 app_settings  sync_runs                                 발행 호수 · 수집 기록
public 뷰 5개    mobile_feed  mobile_showcase  mobile_trend_detail
                 mobile_hada_content  mobile_issue                       웹 · 앱이 읽는 것
graveyard        예전 기능(로그인 · 기사 · 모임 · 보관함)의 빈 표 12개
ops · cron 잡 6개  수집 워크플로를 07:00 · 11:30 KST 에 깨우는 pg_cron 잡 (0022)
시드             app_settings.issue_no 한 건
```

`graveyard` 에 표가 생기는 이유: 0002~0012 가 예전 기능의 표를 만들고, `0020` 이
그것들을 `graveyard` 스키마로 옮깁니다. 마이그레이션 이력을 고쳐 쓰지 않으려고 그대로
둔 것이라 비어 있고, 아무도 읽지 않습니다. 운영에서 지우고 나면 다음 마이그레이션에서
함께 정리합니다.

여러 번 실행해도 안전합니다 — 표는 `if not exists`, 시드는 `on conflict do nothing`,
뷰는 지우고 다시 만들며 권한은 `0018` 이 매번 같은 상태로 되돌립니다.

### 나눠서 실행하고 싶다면

`supabase/migrations/` 의 파일을 **번호 순서대로** 하나씩 돌리세요.

```
0001_extensions        pgcrypto
0002~0005              표 (members · articles · meetings 등 예전 표 포함)
0006_indexes           인덱스 + updated_at 트리거
0007_rls               모든 표에 RLS (정책 0건)
0008_seed              app_settings.issue_no
0009~0012              예전 보관함 · 모바일 로그인 · SSO 열 (0020 이 graveyard 로 옮김)
0013_mobile_read_access  mobile_feed · mobile_trend_detail · mobile_issue
0014_showcase          showcase_items
0015_hada_contents     hada_contents (긱뉴스 · 쇼케이스 본문)
0016 · 0017            mobile_showcase · mobile_hada_content
0018_lock_anon_grants  anon 에게 뷰 5개 SELECT 만
0019_web_read_columns  뷰 끝에 웹용 열 (collected_date · score · origin_url)
0020_graveyard         안 쓰는 표 · 함수를 graveyard 로
0021_app_settings_trim app_settings 를 issue_no 만
0022_sync_dispatch     pg_cron · pg_net 켜고 수집 워크플로를 깨우는 잡 6개
```

`0022` 는 GitHub 토큰이 Vault 에 들어 있어야 실제로 무언가를 보냅니다. 없으면 잡이
경고만 남기고 넘어가므로 먼저 돌려 두어도 됩니다. 토큰 넣는 법은
[GITHUB_ACTIONS_SETUP.md 4절](GITHUB_ACTIONS_SETUP.md#4-정시-실행-켜기-supabase-pg_cron).

> psql 로 한 파일씩 돌린다면 `--single-transaction` 을 붙이세요. 파일 끝의 자체
> 확인이 실패했을 때 그 파일 전체가 되돌아갑니다.

> 스키마를 고칠 때는 `migrations/` 에 새 파일을 더하고 `npm run sql:bundle` 로
> `ALL_MIGRATIONS.sql` 을 다시 만드세요.

---

## 3단계 — 적용 확인

**`supabase/VERIFY.sql`** 을 SQL Editor 에 붙여넣고 블록별로 실행합니다. 중요한 것만
추리면:

| # | 확인 | 기대값 |
|---|---|---|
| ① | public 표 | 6개 |
| ② | RLS | 모두 `rowsecurity = true` |
| ③ | 정책 | **0건** ← 비어 있는 게 정상입니다 |
| ⑪ | 모바일 뷰 | 5개 |
| ⑫ | anon 에게 열린 것 | **뷰 5개의 SELECT 뿐** ← 가장 중요합니다 |
| ⑳ | 뷰 끝의 웹용 열 | 3행 |
| ㉑ | graveyard | 표 12개, anon 접근 `false` |
| ㉒ | 정시 실행 cron 잡 | 6행, 모두 active |
| ㉔ | GitHub 응답 | 잡이 돈 뒤 `status_code = 204` |

③이 0건인 것은 의도한 구성입니다. 표에 직접 닿는 것은 수집기의 `service_role`
뿐이고, 웹 · 앱은 표가 아니라 뷰를 읽습니다. 뷰는 정책이 아니라 `grant` 로 열려
있습니다.

---

## 4단계 — 키 나눠 넣기

### 로컬 `.env.local`

```bash
cp .env.local.example .env.local
```

```dotenv
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<anon 키>                 # 웹(npm run dev)
SUPABASE_SERVICE_ROLE_KEY=<service_role 키> # 수집 스크립트(npm run sync:*)만
OPENAI_API_KEY=<키>                         # 트렌드 기사 작성(sync:trend)만
```

웹만 띄워 볼 거면 위의 두 줄(`SUPABASE_URL` · `SUPABASE_ANON_KEY`)이면 됩니다.

### Vercel

`SUPABASE_URL` · `SUPABASE_ANON_KEY` 두 개뿐입니다 ([VERCEL_DEPLOY.md](VERCEL_DEPLOY.md)).

### GitHub Actions

`SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `OPENAI_API_KEY`
([GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md)).

---

## 5단계 — 데이터 채우고 확인

```bash
npm run sync:geeknews -- --dry-run   # ① 파싱만 확인 (DB 미기록)
npm run sync:geeknews                # ② 실제 적재 — 3일치 40~50건 + 본문
npm run sync:showcase                # ③ 쇼케이스
npm run sync:trend -- --dry-run      # ④ 트렌드 수집 대상만 (LLM 호출 없음)
npm run sync:trend -- --limit=5      # ⑤ 5건만 기사화해 품질 확인
npm run dev                          # ⑥ http://localhost:3000
```

1면에 다섯 카테고리가 채워지고, 마스트헤드의 알약이 「오늘 수집분」이면 정상입니다.

```sql
-- 카테고리별로 언제 무엇이 들어왔는가
select type, source, collected_date, count(*)
  from public.mobile_feed
 group by 1, 2, 3
 order by 3 desc, 1, 2
 limit 20;

-- 수집 실행 기록
select kind, provider, status, fetched_count, inserted_count, skipped_count, error
  from public.sync_runs
 order by started_at desc
 limit 5;
```

---

## 막힐 만한 지점

| 증상 | 원인 · 조치 |
|---|---|
| 화면에 「Supabase 설정이 아직 끝나지 않았습니다」 | `SUPABASE_URL` · `SUPABASE_ANON_KEY` 가 비었습니다. 넣고 개발 서버를 재시작하세요 |
| 웹에서 `permission denied for view mobile_…` | `0018` 이 적용되지 않았거나 뷰를 새로 만든 뒤 `grant select … to anon` 이 빠졌습니다. VERIFY ⑫ 를 보세요 |
| 수집 스크립트에서 `permission denied for table …` | anon 키를 넣었습니다. `SUPABASE_SERVICE_ROLE_KEY` 가 service_role 키인지 확인하세요 (JWT 를 디코드하면 `"role":"service_role"`) |
| `relation "public.geek_news" does not exist` | 2단계가 실패했습니다. SQL Editor 아래 오류를 확인하고 다시 Run |
| `ConnectTimeoutError` | 프록시 환경입니다. `HTTPS_PROXY` 가 설정돼 있으면 스크립트가 자동 처리합니다 |
| `HTTP 403 — news.hada.io` | `SYNC_USER_AGENT` 를 건드렸다면 되돌리세요. UA 에 `bot` 이 들어가면 막힙니다 |
| `sync_runs` 가 `running` 에서 멈춤 | 프로세스가 중간에 죽었습니다. 같은 종류는 15분 뒤부터 다시 실행됩니다 |

---

## 관련 파일

```
supabase/ALL_MIGRATIONS.sql   마이그레이션 22개 통합본 — 붙여넣기용 (생성물)
supabase/VERIFY.sql           적용 확인 쿼리 ①~㉕
supabase/migrations/          개별 마이그레이션 0001~0022
supabase/LIVE_ONLY.md         운영 DB 에만 있고 마이그레이션에는 없는 객체
scripts/bundle-sql.mjs        npm run sql:bundle — 통합본 재생성
```

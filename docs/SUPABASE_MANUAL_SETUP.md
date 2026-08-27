# Supabase 수동 설정 절차

MCP 연결 없이 대시보드에서 직접 진행하는 단계별 안내입니다.
처음부터 끝까지 약 **15분** 걸립니다.

테이블 구조·RLS 설계 배경 같은 참고 내용은 [SUPABASE_SETUP.md](SUPABASE_SETUP.md) 를 보세요.
이 문서는 "무엇을 순서대로 누르면 되는가"에만 집중합니다.

| 단계 | 내용 | 소요 |
|---|---|---|
| [1](#1단계--프로젝트-확인-및-키-복사) | 프로젝트 확인 및 키 복사 | 2분 |
| [2](#2단계--스키마-적용) | 스키마 적용 | 3분 |
| [3](#3단계--storage-버킷) | Storage 버킷 | 1분 |
| [4](#4단계--적용-확인) | 적용 확인 | 2분 |
| [5](#5단계--envlocal-채우기) | `.env.local` 채우기 | 1분 |
| [6](#6단계--사번-교체-선택) | 사번 교체 (선택) | — |
| [7](#7단계--데이터-채우고-확인) | 데이터 채우고 확인 | 5분 |

---

## 1단계 — 프로젝트 확인 및 키 복사

https://supabase.com/dashboard 에서 프로젝트를 선택합니다.
없으면 **New project** 로 만드세요 (Region 은 `Northeast Asia (Seoul)` 권장).

**Project Settings → Data API** 에서 두 값을 복사합니다.

| 항목 | 예시 | 비고 |
|---|---|---|
| Project URL | `https://abcdefgh.supabase.co` | |
| `service_role` secret | `eyJhbGci...` | **Reveal** 을 눌러야 보입니다 |

> `anon` 키는 이 프로젝트에서 쓰지 않습니다.
> `service_role` 은 RLS 를 우회하는 마스터 키라, 브라우저에 절대 내려보내지 않고
> 서버(Next.js)와 GitHub Actions Secrets 에서만 씁니다.

---

## 2단계 — 스키마 적용

12개 마이그레이션을 하나로 합친 **`supabase/ALL_MIGRATIONS.sql`** 이
준비되어 있습니다.

터미널에서 클립보드로 복사:

```powershell
Get-Content supabase/ALL_MIGRATIONS.sql -Raw | Set-Clipboard
```

대시보드 → **SQL Editor** → **New query** → 붙여넣기 → **Run** (`Ctrl+Enter`).

`Success. No rows returned` 이 뜨면 성공입니다. 86개 statement 가 한 번에 실행됩니다.

### 이 파일이 만드는 것

```
테이블 16개
  members  app_settings                        구성원 · 발행설정
  geek_news  trend_items  articles             콘텐츠
  article_sources  comments                    기사 부속
  meetings  meeting_attendees  rotations       유닛 운영
  scraps  sync_runs  attachments               보관함 · 로그 · 업로드
  member_google_identities                     모바일 앱 로그인 (0010)
  member_apple_identities  member_refresh_tokens

인덱스 21개 + updated_at 자동갱신 트리거 3개
RLS 16개 테이블 전부 활성화 (정책은 의도적으로 0건)
시드 — 유닛원 4명, 구독자 1명, 로테이션 8건, 발행설정 5건
```

전부 `if not exists` / `on conflict do nothing` 이라 **두 번 실행해도 안전**합니다.
중간에 실패하면 원인을 고친 뒤 그대로 다시 돌리면 됩니다.

### 나눠서 실행하고 싶다면

개별 파일을 **번호 순서대로** 하나씩 돌리세요.

```
supabase/migrations/0001_extensions.sql   pgcrypto 확장
supabase/migrations/0002_core.sql         members, app_settings
supabase/migrations/0003_content.sql      geek_news, trend_items, articles, …
supabase/migrations/0004_unit.sql         meetings, rotations, scraps
supabase/migrations/0005_ops.sql          sync_runs, attachments
supabase/migrations/0006_indexes.sql      인덱스 + updated_at 트리거
supabase/migrations/0007_rls.sql          RLS 활성화
supabase/migrations/0008_seed.sql         유닛원·로테이션·발행설정 시드
supabase/migrations/0009_scraps.sql       보관함 조회 인덱스
supabase/migrations/0010_google_identities.sql   모바일 Google 로그인 · 리프레시 토큰
supabase/migrations/0011_apple_identities.sql    모바일 Apple 로그인
```

0010·0011 은 모바일 앱 로그인용입니다 — 앱을 붙이지 않는다면 미뤄도 웹은
그대로 동작합니다. 내용은 [`MOBILE_OAUTH2.md`](MOBILE_OAUTH2.md).

> 스키마를 고칠 때는 `migrations/` 의 개별 파일을 고치고
> `npm run sql:bundle` 로 `ALL_MIGRATIONS.sql` 을 다시 만드세요.

---

## 3단계 — Storage 버킷

발표 현장 사진과 발표 자료(PDF)를 담습니다.

대시보드 → **Storage** → **New bucket**

| 항목 | 값 |
|---|---|
| Name | `newsletter` |
| Public bucket | **끔** |
| File size limit | `500 MB` |

SQL 로 해도 됩니다:

```sql
insert into storage.buckets (id, name, public, file_size_limit)
values ('newsletter', 'newsletter', false, 524288000)
on conflict (id) do nothing;
```

> **private 버킷을 고르면 코드를 한 줄 고쳐야 합니다.**
> `src/lib/data/ops.ts` 의 `storageUrl()` 이 지금 `getPublicUrl()` 을 쓰는데,
> private 버킷에서는 이 URL 이 열리지 않습니다.
>
> ```ts
> const { data } = await supabaseAdmin()
>   .storage.from(supabaseEnv.bucket)
>   .createSignedUrl(path, 60 * 60);   // 1시간
> return data?.signedUrl ?? null;
> ```
>
> 발표 자료가 보안 등급 II 문서라면 private + 서명 URL 이 맞고,
> 사진만 쓸 거면 public 으로 두고 지금 코드를 그대로 써도 됩니다.

---

## 4단계 — 적용 확인

**`supabase/VERIFY.sql`** 을 SQL Editor 에 붙여넣고 블록별로 실행하세요.
아래가 나오면 정상입니다.

| # | 확인 | 기대값 |
|---|---|---|
| ① | 테이블 | **16개** |
| ② | RLS | 16개 모두 `rowsecurity = true` |
| ③ | 정책 | **0건** ← 비어 있는 게 정상입니다 |
| ④ | 인덱스 | 21개 내외 |
| ⑤ | `trend_items.public_id` | `is_generated = ALWAYS` |
| ⑥ | `members` | 5명 |
| ⑦ | `app_settings` | 5건 |
| ⑧ | `rotations` | 8건 |
| ⑨ | 버킷 | `newsletter` / `public = false` |

③이 0건인 게 헷갈릴 수 있는데 **의도한 구성**입니다.
로그인 주체가 Supabase Auth 가 아니라 사내 SSO 라 `auth.uid()` 기반 정책을 쓸 수
없고, 모든 접근이 서버의 `service_role` 을 통합니다. 정책이 없으면 `anon` /
`authenticated` 롤은 전부 거부되므로, `anon` 키가 유출돼도 사내 콘텐츠가 새지
않습니다.

---

## 5단계 — `.env.local` 채우기

`.env.local` 은 이미 생성돼 있고 `SESSION_SECRET` 도 채워져 있습니다.
두 줄만 바꾸세요.

```dotenv
SUPABASE_URL=https://<1단계의 Project URL>
SUPABASE_SERVICE_ROLE_KEY=<1단계의 service_role 키>
```

`SUPABASE_STORAGE_BUCKET=newsletter` 는 이미 들어 있습니다.

> **개발 서버를 반드시 재시작**하세요.
> `next.config.ts` 가 `SUPABASE_URL` 을 읽어 `next/image` 허용 호스트를 정하는데,
> 이 값은 빌드 시점에 한 번만 평가됩니다.

---

## 6단계 — 사번 교체 (선택)

시드의 사번(`21084213` 등)은 임시값입니다. 실제 SSO 를 붙이기 전에 바꾸지 않으면
같은 사람이 구독자로 새로 생성됩니다.

```sql
update public.members set emp_no = '<실제 사번>' where name = '박세원';
update public.members set emp_no = '<실제 사번>' where name = '문명훈';
update public.members set emp_no = '<실제 사번>' where name = '박미숙';
update public.members set emp_no = '<실제 사번>' where name = '한솔아';
```

목업 로그인은 `21084213` 으로 들어옵니다. 이걸 바꾸면
`src/lib/auth/sso/client.mock.ts` 의 `MOCK_USER.empNo` 도 같이 맞춰야 합니다.

관리자 권한 부여/회수:

```sql
update public.members set is_admin = true  where emp_no = '<사번>';
update public.members set is_admin = false where emp_no = '<사번>';
```

---

## 7단계 — 데이터 채우고 확인

```bash
# ① 파싱만 확인 (DB 미기록)
npm run sync:geeknews -- --dry-run

# ② 실제 적재 — 3일치 40~50건이 들어갑니다
npm run sync:geeknews

# ③ 트렌드 수집 대상만 확인 (LLM 호출 없음, API 키 불필요)
npm run sync:trend -- --dry-run

# ④ GEMINI_API_KEY 를 .env.local 에 넣은 뒤, 5건만 기사화해 품질 확인
npm run sync:trend -- --limit=5

# ⑤ 화면 확인
npm run dev
```

`http://localhost:3000` → 로그인 화면이 2~3초 뒤 자동 통과 →
1면에 긱뉴스와 트렌드가 채워져 있어야 합니다.

### 확인 쿼리

```sql
-- 3일 범위로 들어왔는가
select count(*), min(published_at), max(published_at) from geek_news;

-- 멱등성 — sync:geeknews 를 두 번 돌려도 이 값이 늘지 않아야 함
select count(*) from geek_news;

-- GitHub Trending 이 세 기간을 모두 가져왔는가
select source, source_variant, count(*) from trend_items group by 1,2 order by 1,2;

-- 실행 로그
select kind, provider, status, fetched_count, inserted_count, skipped_count, error
  from sync_runs order by started_at desc limit 5;
```

---

## 막힐 만한 지점

| 증상 | 원인 · 조치 |
|---|---|
| 화면에 "Supabase 설정이 아직 끝나지 않았습니다" | `.env.local` 반영 안 됨 → 개발 서버 재시작 |
| `permission denied for table ...` | `anon` 키를 넣었습니다. `service_role` 키인지 확인 (JWT 를 디코드하면 `"role":"service_role"`) |
| `relation "public.geek_news" does not exist` | 2단계 SQL 이 실패했습니다. SQL Editor 하단 에러를 확인하고 다시 Run |
| `ConnectTimeoutError` | 사내 프록시입니다. `HTTPS_PROXY` 가 설정돼 있으면 스크립트가 자동 처리합니다 |
| `HTTP 403 — news.hada.io` | `SYNC_USER_AGENT` 를 건드렸다면 되돌리세요. UA 에 `bot` 이 들어가면 차단됩니다 |
| 사진이 안 보임 | private 버킷 + `getPublicUrl()` 조합. 3단계의 서명 URL 안내 참고 |
| `sync_runs` 가 `running` 에서 멈춤 | 프로세스가 중간에 죽은 경우입니다. 같은 종류는 15분 뒤부터 다시 실행됩니다 |

---

## 관련 파일

```
supabase/ALL_MIGRATIONS.sql   12개 마이그레이션 통합본 — 붙여넣기용
supabase/VERIFY.sql           적용 확인 쿼리 9종
supabase/migrations/          개별 마이그레이션 0001~0012
scripts/bundle-sql.mjs        npm run sql:bundle — 통합본 재생성
```

---

## SQL 검증 상태

적용 전에 정적 검증을 돌렸습니다.

- 인덱스·FK·트리거·시드가 참조하는 컬럼이 모두 실제로 존재함
- 괄호 141/141(주석·문자열 제외), 작은따옴표 짝수, `$$` 2개(짝수) 균형
- RLS 16/16 테이블 적용, `create policy` 0건 (의도된 구성)
- 테이블 16개 · 인덱스 21개 · 트리거 3개

0010·0011 은 모바일 저장소에서 그대로 가져온 파일이라 위 정적 검증 범위
바깥입니다 (그쪽에서 작성·검토된 것입니다).

다만 **실제 Postgres 인스턴스에 실행해 본 것은 아닙니다**
(작업 PC 에 psql·docker 가 없습니다).
2단계에서 에러가 나면 메시지를 그대로 알려 주시면 바로 고치겠습니다.

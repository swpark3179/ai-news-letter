# Supabase 설정 가이드

AI 뉴스레터가 쓰는 테이블 · 인덱스 · RLS · Storage 의 **참고 문서**입니다.
테이블 구조, PK 를 그렇게 고른 이유, RLS 설계 배경, 운영 쿼리를 담았습니다.

> **처음 셋업하는 중이라면 [SUPABASE_MANUAL_SETUP.md](SUPABASE_MANUAL_SETUP.md)
> 를 먼저 보세요.** 대시보드에서 무엇을 순서대로 누르면 되는지만 15분짜리
> 단계별 절차로 정리해 두었습니다.

---

## 0. 준비물

| 항목 | 어디서 확인 | 쓰이는 곳 |
|---|---|---|
| Project URL | Supabase 대시보드 → Project Settings → Data API | `SUPABASE_URL` |
| `service_role` key | 같은 화면의 Project API keys | `SUPABASE_SERVICE_ROLE_KEY` |
| DB 비밀번호 | Project Settings → Database | CLI 로 적용할 때만 |

> `service_role` 키는 RLS 를 우회하는 마스터 키입니다. 브라우저에 절대 내려보내지
> 않고, 서버(Next.js)와 GitHub Actions Secrets 에서만 씁니다.
> `anon` 키는 이 프로젝트에서 아예 사용하지 않습니다.

---

## 1. 마이그레이션 적용

세 가지 방법 중 편한 것을 고르면 됩니다. 결과는 같습니다.

### 방법 A — 대시보드 SQL Editor (가장 간단, 권장)

**`supabase/ALL_MIGRATIONS.sql`** 한 파일에 12개 마이그레이션이 순서대로 합쳐져
있습니다. 대시보드 → **SQL Editor** → New query 에 **전체를 붙여넣고 한 번 Run**
하면 끝입니다.

```bash
# 클립보드로 복사 (Windows)
Get-Content supabase/ALL_MIGRATIONS.sql -Raw | Set-Clipboard
```

나눠서 실행하고 싶다면 개별 파일을 **번호 순서대로** 하나씩 돌리세요.

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
```

모든 파일이 `create table if not exists` / `on conflict do nothing` 이라
두 번 실행해도 안전합니다.

> 스키마를 고칠 때는 `migrations/` 의 개별 파일을 고치고 `npm run sql:bundle` 로
> `ALL_MIGRATIONS.sql` 을 다시 만드세요.

### 방법 B — Supabase CLI

```bash
npx supabase login                      # 또는 SUPABASE_ACCESS_TOKEN 환경변수
npx supabase link --project-ref <프로젝트 ref>
npx supabase db push
```

`db push` 는 `supabase/migrations/` 를 파일명 순으로 적용하고,
`supabase_migrations.schema_migrations` 에 적용 이력을 남깁니다.

### 방법 C — psql

```bash
export PGURL='postgresql://postgres.<ref>:<DB비밀번호>@aws-0-<region>.pooler.supabase.com:5432/postgres'
for f in supabase/migrations/*.sql; do
  echo "→ $f"
  psql "$PGURL" -v ON_ERROR_STOP=1 -f "$f"
done
```

---

## 2. Storage 버킷 만들기

발표 현장 사진과 발표 자료(PDF)를 담습니다.

대시보드 → **Storage** → New bucket

| 항목 | 값 |
|---|---|
| Name | `newsletter` |
| Public bucket | **끔** (private) |
| File size limit | 500 MB |

SQL 로 만들려면:

```sql
insert into storage.buckets (id, name, public, file_size_limit)
values ('newsletter', 'newsletter', false, 524288000)
on conflict (id) do nothing;
```

> **private 버킷일 때의 주의점**
> `src/lib/data/ops.ts` 의 `storageUrl()` 은 지금 `getPublicUrl()` 을 씁니다.
> private 버킷에서는 이 URL 이 열리지 않으므로, 아래처럼 서명 URL 로 바꾸세요.
>
> ```ts
> const { data } = await supabaseAdmin()
>   .storage.from(supabaseEnv.bucket)
>   .createSignedUrl(path, 60 * 60);   // 1시간
> return data?.signedUrl ?? null;
> ```
>
> 사내 자료가 아닌 이미지만 다룬다면 버킷을 public 으로 두고 현재 코드를 그대로
> 써도 됩니다. 발표 자료가 보안 등급 II 문서라면 private + 서명 URL 이 맞습니다.

---

## 3. 만들어지는 테이블

### 콘텐츠

| 테이블 | PK | 설명 |
|---|---|---|
| `geek_news` | `url` (긱뉴스 토픽 URL) | news.hada.io 수집분. 제목·요약을 원문 그대로 저장 |
| `trend_items` | `source_url` (원본 URL) | GitHub·HN·arXiv·긱뉴스를 AI 가 한국어 기사로 요약 |
| `articles` | `id` | 유닛원이 쓰는 글. `section` = review \| deep |
| `article_sources` | `id` | 기사별 원문 링크 |
| `comments` | `id` | 심층 분석 기사의 토론 코멘트 |

**`geek_news.url` 을 PK 로 쓰는 이유** — 목록의 *요약부* 링크입니다.
타이틀 href(원문 사이트)가 아니라 긱뉴스 내부 주소라서 안정적이고,
`on conflict do nothing` 만으로 재동기화 시 기존 항목이 자동으로 걸러집니다.

```
일반 토픽      https://news.hada.io/topic?id=32516
긱뉴스 자체글  https://news.hada.io/article/<slug>    ← ARTICLE 배지가 붙은 행
```

**`trend_items.public_id`** 는 `substr(md5(source_url), 1, 12)` 로 계산되는
generated column 입니다. URL 을 그대로 주소에 넣을 수 없어서 라우팅에만 씁니다
(`/articles/trend/<public_id>`). 값이 URL 에서 파생되므로 재동기화해도 주소가
바뀌지 않습니다.

**`collected_date`** 는 `(timezone('Asia/Seoul', now()))::date` 가 기본값입니다.
트렌드 브리핑은 원문 작성일이 불명확한 출처가 섞여 있어 "퍼온 날짜"로 조회합니다.

### 조직 · 운영

| 테이블 | 설명 |
|---|---|
| `members` | 유닛원·구독자. 사내 SSO 사번(`emp_no`)이 자연 키 |
| `meetings` / `meeting_attendees` | 주간 모임 아카이브 |
| `rotations` | 발표 순번(`deep`) · 주간 당번(`weekly`) |
| `scraps` | 보관함 — 사용자가 나중에 다시 읽으려고 담아 둔 게시물 (본인만 조회, 관리자는 집계만) |
| `sync_runs` | 동기화 실행 로그 — 관리자 콘솔의 `pipeline.log` 원천 |
| `attachments` | 발표 자료 분할 암호화 업로드 이력 |
| `app_settings` | 발행 호수·발행처 등 런타임 설정 |

---

## 4. RLS 정책

`0007_rls.sql` 은 **모든 테이블에 RLS 를 켜고 정책은 하나도 만들지 않습니다.**

의도한 구성입니다.

- 로그인 주체가 Supabase Auth 가 아니라 **사내 SSO** 라서, `auth.uid()` 기반
  정책을 쓸 수가 없습니다.
- 모든 DB 접근이 Next.js 서버에서 `service_role` 키로 일어납니다.
  `service_role` 은 RLS 를 우회하므로 서버 코드는 정상 동작합니다.
- `anon` / `authenticated` 롤은 정책이 없어 전부 거부됩니다. 실수로 클라이언트에서
  호출하거나 `anon` 키가 유출돼도 사내 콘텐츠가 새지 않습니다.

나중에 브라우저에서 직접 조회할 일이 생기면 그때 `select` 정책을 명시적으로
추가하세요. 예를 들어 발행된 기사만 공개하려면:

```sql
create policy "published articles are readable"
  on public.articles for select
  to anon
  using (status = 'published');
```

---

## 5. 시드 데이터

`0008_seed.sql` 이 넣는 것:

- 유닛원 4명 (박세원 Unit 장 / 문명훈 / 박미숙 / 한솔아) + 구독자 예시 1명
- 심층 발표 순번 4건, 주간 리뷰 당번 4건
- 발행 설정 (`issue_no`, `publisher`, `show_en_subtitles` 등)

> **사번은 임시값(`21084213` 등)입니다.** 실제 SSO 를 붙이기 전에 실제 사번으로
> 바꿔야 합니다. 사번이 맞지 않으면 SSO 로그인 시 같은 사람이 구독자로 새로
> 생성됩니다.
>
> ```sql
> update public.members set emp_no = '<실제 사번>' where name = '박세원';
> ```

관리자 권한 부여/회수:

```sql
update public.members set is_admin = true  where emp_no = '<사번>';
update public.members set is_admin = false where emp_no = '<사번>';
```

역할 승격 (구독자 → 유닛원):

```sql
update public.members
   set role = 'member', avatar_tone = 'blue', initial = '길동'
 where emp_no = '<사번>';
```

---

## 6. 적용 확인

**`supabase/VERIFY.sql`** 을 SQL Editor 에 붙여넣고 블록별로 실행하세요.
확인 항목 9가지가 순서대로 들어 있습니다.

| # | 확인 | 기대 결과 |
|---|---|---|
| ① | 테이블 | 16개 |
| ② | RLS | 16개 모두 `rowsecurity = true` |
| ③ | 정책 | **0건** (service_role 전용 구성이므로 정상) |
| ④ | 인덱스 | 21개 내외 |
| ⑤ | `trend_items.public_id` | `is_generated = ALWAYS` |
| ⑥ | 유닛원 시드 | 5명 (유닛원 4 + 구독자 1) |
| ⑦ | 발행 설정 | 5건 |
| ⑧ | 로테이션 | 8건 (심층 4 + 주간 4) |
| ⑨ | Storage 버킷 | `newsletter` / `public = false` |

---

## 7. 애플리케이션 연결

`.env.local` (로컬):

```bash
cp .env.local.example .env.local
```

```dotenv
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role 키>
SUPABASE_STORAGE_BUCKET=newsletter
SESSION_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))">
```

첫 데이터 채우기:

```bash
npm run sync:geeknews -- --dry-run   # 파싱만 확인
npm run sync:geeknews                # 실제 적재
npm run sync:trend -- --dry-run      # 수집 대상만 확인 (LLM 호출 없음)
npm run sync:trend -- --limit=5      # 5건만 기사화해 확인
npm run dev
```

---

## 8. 운영 중 자주 쓰는 쿼리

```sql
-- 오늘 수집 현황
select 'geek' src, count(*) from geek_news where collected_date = (now() at time zone 'Asia/Seoul')::date
union all
select source, count(*) from trend_items where collected_date = (now() at time zone 'Asia/Seoul')::date group by source;

-- GitHub Trending 이 daily/weekly/monthly 를 모두 가져왔는지
select source_variant, count(*) from trend_items where source = 'github' group by 1;

-- 최근 동기화 로그
select kind, provider, status, started_at, fetched_count, inserted_count, error
  from sync_runs order by started_at desc limit 10;

-- 품질이 나쁜 자동 기사 숨기기 (삭제하면 다음 동기화 때 다시 생성된다)
update trend_items set status = 'hidden' where source_url = '<url>';

-- 조각이 남은 실패한 업로드 정리
select id, file_name, status, received_chunks, chunk_count, error
  from attachments where status <> 'stored' order by created_at desc;

-- 많이 보관된 게시물 (관리자 화면 /admin/scraps 와 같은 집계)
select s.target_type,
       s.target_key,
       count(*)          as saves,
       max(s.created_at) as last_saved_at
  from scraps s
 group by 1, 2
 order by saves desc, last_saved_at desc
 limit 20;

-- 보관 기능을 쓰는 사람 수 · 종류별 건수
select count(distinct member_id) as savers,
       count(*) filter (where target_type = 'geek')  as geek,
       count(*) filter (where target_type = 'trend') as trend
  from scraps;
```

> **주의** — `trend_items` 나 `geek_news` 에서 행을 **삭제**하면 PK 가 사라져
> 다음 동기화에서 같은 항목을 다시 수집합니다. 노출만 막으려면 `status='hidden'`
> (트렌드) 또는 `is_hidden = true` (긱뉴스) 로 두세요.

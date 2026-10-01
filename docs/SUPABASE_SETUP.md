# Supabase 참고

AI 뉴스레터가 쓰는 표 · 뷰 · 권한의 **참고 문서**입니다. 표 구조, PK 를 그렇게 고른
이유, 누가 무엇을 읽는지, 운영 쿼리를 담았습니다.

> **처음 셋업하는 중이라면 [SUPABASE_MANUAL_SETUP.md](SUPABASE_MANUAL_SETUP.md) 를
> 먼저 보세요.** 대시보드에서 순서대로 하면 되는 절차만 정리해 두었습니다.

---

## 0. 한눈에

```
 GitHub Actions 수집기 ── service_role ──▶  표 6개  (RLS 켬 · 정책 0건)
 (npm run sync:*)                            geek_news · showcase_items · hada_contents
                                             trend_items · app_settings · sync_runs
                                                  │
                                                  ▼  (뷰가 「무엇이 보이는가」를 정한다)
 웹 (Vercel)      ┐                          뷰 5개
                  ├─── anon 키 ──── SELECT ▶ mobile_feed · mobile_showcase · mobile_trend_detail
 모바일 앱        ┘                          mobile_hada_content · mobile_issue
```

- 표에 닿는 것은 수집기의 `service_role` 하나입니다.
- 웹과 앱은 **같은 anon 키로 같은 뷰**를 읽습니다. anon 에게 열린 것은 그 다섯 뷰의
  SELECT 뿐입니다(`0018`).
- Supabase Auth · Storage 는 쓰지 않습니다. 로그인도 파일 업로드도 없습니다.

---

## 1. 표

| 표 | PK | 설명 |
|---|---|---|
| `geek_news` | `url` (긱뉴스 토픽 URL) | news.hada.io 수집분. 제목 · 요약을 원문 그대로 |
| `showcase_items` | `url` (토픽 URL) | news.hada.io/show — 직접 만든 것 소개 |
| `hada_contents` | `url` (토픽 URL) | 위 둘의 **상세 페이지 본문**. 마크다운, 원문 그대로 |
| `trend_items` | `source_url` (원본 URL) | GitHub · HN · arXiv 를 AI 가 한국어 기사로 요약 |
| `app_settings` | `key` | `issue_no` 하나 — `mobile_issue` 가 발행 호수를 계산하는 기준 |
| `sync_runs` | `id` | 수집 실행 기록 (건수 · 로그 · 오류) |

운영 DB 에는 이 밖에 쓰지 않는 수집기(collector)의 표와 열이 남아 있습니다 —
[`supabase/LIVE_ONLY.md`](../supabase/LIVE_ONLY.md) 의 B.

**`geek_news.url` 을 PK 로 쓰는 이유** — 목록의 *요약부* 링크입니다. 타이틀 href(원문
사이트)가 아니라 긱뉴스 내부 주소라서 안정적이고, `on conflict do nothing` 만으로 다시
수집해도 기존 항목이 걸러집니다.

```
일반 토픽      https://news.hada.io/topic?id=32516     → 웹 /articles/geek/32516
긱뉴스 자체글  https://news.hada.io/article/<slug>     → 웹 /articles/geek/article/<slug>
```

**`hada_contents` 를 목록 표와 나눈 이유** — 목록을 읽을 때마다 본문을 통째로 끌어오지
않으려는 것입니다. PK 가 `geek_news.url` / `showcase_items.url` 과 같은 값이라 조인은
그대로 됩니다. 부모가 둘이라 FK 는 걸지 않았습니다. 저장 범위는 상세 페이지의 **「함께
보면 좋은 글」 직전까지**이고, 본문을 못 찾으면 빈 문자열이 아니라
`status = 'parse_failed'` 로 남습니다 — 마크업이 바뀐 것을 조용히 넘기지 않으려고요.

**`trend_items.public_id`** 는 `substr(md5(source_url), 1, 12)` 로 계산되는 generated
column 입니다. URL 을 주소에 그대로 넣을 수 없어 라우팅에 씁니다
(`/articles/trend/<public_id>`). URL 에서 파생되므로 다시 수집해도 주소가 바뀌지 않습니다.

**`collected_date`** 는 `(timezone('Asia/Seoul', now()))::date` 가 기본값인 「수집한 날」
입니다. 웹은 이 값으로 지면을 묶습니다 — 1면은 카테고리마다 마지막으로 수집한 날 것을
싣고, 카테고리 목록은 이 날짜로 구분선을 넣어 7일씩 넘깁니다.

---

## 2. 뷰 — 웹과 앱이 읽는 것

| 뷰 | 만든 곳 | 한 행 | 거르는 것 |
|---|---|---|---|
| `mobile_feed` | 0013 · 0019 | 긱뉴스 + 트렌드 목록 (`type` = `geek` \| `trend`) | 긱뉴스 `is_hidden`, 트렌드 `status <> 'published'` |
| `mobile_showcase` | 0016 · 0019 | 쇼케이스 목록 (`type` = `show`) | `is_hidden` |
| `mobile_trend_detail` | 0013 · 0019 | 트렌드 상세 (본문 블록 · 태그) | `status <> 'published'` |
| `mobile_hada_content` | 0017 | 긱뉴스 · 쇼케이스 본문 (`body_md`) | 수집 실패 행, 부모가 감춰진 행 |
| `mobile_issue` | 0013 | 항상 한 행 — 발행 호수 · 오늘 건수 | 감춘 글은 세지 않음 |

- **규칙은 뷰에 한 번만 있습니다.** 「숨긴 글은 빼고」, 「공개된 트렌드만」, 목록의 지표
  문구(`meta` — `★ 711 this week · Python` 같은 것)는 SQL 이 계산해 내려 줍니다. 웹과
  앱이 그 규칙을 각자 들고 있다가 어긋난 적이 있어서입니다.
- **웹용 열은 뷰 끝에 붙어 있습니다**(`0019` — `collected_date` · `score` ·
  `origin_url`). 앱은 열 이름을 골라 읽어 끝에 붙은 열은 보지 않으므로, 이미 배포된 앱
  빌드에 영향이 없습니다. 뷰를 고칠 때도 **열은 끝에만 붙이세요** —
  `create or replace view` 는 기존 열의 이름 · 순서 · 타입을 바꿀 수 없습니다.
- **`search_text`** 는 제목 · 요약 · 저장소 이름 · 태그를 이어 붙인 열입니다. 웹 ·
  앱의 검색이 이 열에 `ilike` 를 겁니다.

뷰의 열 계약 전체는 모바일 저장소의
[`docs/03-api-contract.md`](https://github.com/swpark3179/ai-news-letter-mobile/blob/main/docs/03-api-contract.md)
에 있습니다.

---

## 3. 권한

`0007` 은 **모든 표에 RLS 를 켜고 정책은 하나도 만들지 않습니다.** 의도한 구성입니다.

| 역할 | 할 수 있는 것 | 근거 |
|---|---|---|
| `service_role` (수집기) | 표 읽기 · 쓰기 | RLS 를 우회한다 |
| `anon` (웹 · 앱) | 뷰 5개 SELECT **만** | `0018` 이 나머지를 전부 회수하고 기본 권한(default privileges)도 고쳤다 |
| `authenticated` | 아무것도 없음 | 로그인이 없어 이 역할로 오는 정상 요청이 없다 |

- 뷰는 소유자(postgres) 권한으로 표를 읽습니다. 그래서 표를 닫아 둔 채 뷰만 열 수
  있습니다. Supabase advisor 가 `security_definer_view` 로 알리는 것은 이 구성 때문이고,
  `rls_enabled_no_policy` 도 정책 0건이 의도라 그대로 둡니다.
- Supabase 프로젝트의 기본 권한은 public 에 새로 만드는 객체를 anon 에게 **전부** 열어
  둡니다. `0018` 이 그것을 고쳤으므로, 새 뷰를 앱 · 웹에 열려면 그 마이그레이션에
  `grant select on public.<뷰> to anon;` 을 적으면 됩니다.
- 뷰를 새로 만들거나 고친 뒤에는 **`VERIFY.sql` ⑫** 를 꼭 돌려 보세요. anon 에게 무엇이
  열려 있는지 보는 항목입니다.

---

## 4. `graveyard` 스키마

`0020` 이 웹 · 앱 · 수집기 어느 쪽도 쓰지 않는 표 14개와 함수 9개를 옮겨 둔 곳입니다
(예전 로그인 · 관리자 · 기사 · 댓글 · 모임 · 보관함 · 업로드). 지우기 전에 한동안 지켜보려는
것이고, anon · authenticated 는 접근할 수 없습니다.

```sql
-- 되돌리기 (표 하나)
alter table graveyard.members set schema public;
```

지켜본 뒤 다음 마이그레이션에서 `drop schema graveyard cascade` 합니다. 무엇이 옮겨
갔는지는 [`supabase/LIVE_ONLY.md`](../supabase/LIVE_ONLY.md) 의 A · C 를 보세요.

---

## 5. 운영 중 자주 쓰는 쿼리

```sql
-- 오늘(KST) 수집 현황 — 카테고리별
select type, coalesce(source, '-') as source, count(*)
  from public.mobile_feed
 where collected_date = (now() at time zone 'Asia/Seoul')::date
 group by 1, 2
union all
select 'show', '-', count(*)
  from public.mobile_showcase
 where collected_date = (now() at time zone 'Asia/Seoul')::date;

-- GitHub Trending 이 daily / weekly / monthly 를 모두 가져왔는지
select source_variant, count(*) from public.trend_items where source = 'github' group by 1;

-- 최근 수집 기록
select kind, provider, status, started_at, fetched_count, inserted_count, error
  from public.sync_runs order by started_at desc limit 10;

-- 본문 수집 상태 (parse_failed 가 늘면 상세 페이지 마크업이 바뀐 것)
select source, status, count(*) from public.hada_contents group by 1, 2 order by 1, 2;

-- 품질이 나쁜 트렌드 기사 숨기기
update public.trend_items set status = 'hidden' where source_url = '<url>';

-- 긱뉴스 · 쇼케이스 글 숨기기 (본문도 뷰에서 함께 빠진다)
update public.geek_news      set is_hidden = true where url = '<토픽 URL>';
update public.showcase_items set is_hidden = true where url = '<토픽 URL>';
```

> **행을 지우지 마세요.** `trend_items` · `geek_news` · `showcase_items` 에서 행을
> **삭제**하면 PK 가 사라져 다음 수집에서 같은 항목을 다시 담습니다. 노출만 막으려면
> 위처럼 `status = 'hidden'` 또는 `is_hidden = true` 로 두세요.

---

## 6. 적용 확인

[`supabase/VERIFY.sql`](../supabase/VERIFY.sql) 을 SQL Editor 에서 블록별로 실행합니다.
기대값은 각 블록의 주석에 있고, 중요한 것은
[SUPABASE_MANUAL_SETUP.md 3단계](SUPABASE_MANUAL_SETUP.md#3단계--적용-확인) 에 추려
두었습니다.

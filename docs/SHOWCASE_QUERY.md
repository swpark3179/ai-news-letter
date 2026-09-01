# 쇼케이스 데이터 조회 가이드

`https://news.hada.io/show` 에서 매일 수집하는 **쇼케이스** 데이터를 어떻게 읽는지
정리한 문서입니다. 특히 **모바일 앱에서 조회하려면 무엇이 필요한지**를 다룹니다.

> **먼저 알아야 할 것**
> 앱은 Supabase 를 직접 읽습니다. 다만 **표가 아니라 전용 뷰만** 열려 있고
> (`0013_mobile_read_access.sql`), `showcase_items` 는 표라서 **아직 닫혀 있습니다.**
> 앱에서 읽게 하려면 REST 라우트가 아니라 **뷰를 하나 더 열면 됩니다** —
> 그대로 붙여 쓸 SQL 을 [5장](#5-쇼케이스를-앱에서-읽게-하려면)에 준비해 뒀습니다.

---

## 1. 무엇이 쌓이나

긱뉴스 메인 목록(`https://news.hada.io/`)이 **읽을 거리**를 모으는 곳이라면,
`/show` 는 사람들이 **직접 만든 것을 소개하는** 게시판입니다. 사이드 프로젝트,
직접 만든 도구·라이브러리·서비스가 올라옵니다.

성격이 달라 긱뉴스와 **테이블을 나눠** 저장합니다. 한 테이블에 섞으면 화면에서
「오늘의 뉴스」와 「누가 뭘 만들었나」를 구분할 수 없기 때문입니다.

| | 긱뉴스 데일리 | 쇼케이스 |
|---|---|---|
| 수집 대상 | `news.hada.io/` | `news.hada.io/show` |
| 테이블 | `geek_news` | `showcase_items` |
| 워크플로 | `.github/workflows/sync-geeknews.yml` | `.github/workflows/sync-hada-show.yml` |
| 실행 시각 | 매일 07:00 KST | 매일 07:20 KST |
| 명령 | `npm run sync:geeknews` | `npm run sync:showcase` |
| `sync_runs.kind` | `geeknews` | `showcase` |
| LLM | 사용 안 함 | 사용 안 함 |

둘 다 제목과 소개문을 **원문 그대로** 저장합니다. 요약 모델을 태우지 않으므로
비용도 환각도 없습니다.

---

## 2. 어디에 쌓이나 — `showcase_items`

스키마 원본은 [`supabase/migrations/0014_showcase.sql`](../supabase/migrations/0014_showcase.sql),
타입은 `ShowcaseItemRow` ([`src/types/db.ts`](../src/types/db.ts)) 입니다.

| 열 | 타입 | 의미 |
|---|---|---|
| `url` | `text` **PK** | 긱뉴스 내부 토픽 URL. `https://news.hada.io/topic?id=32516` |
| `title` | `text` | 만든 것의 제목 |
| `summary` | `text` | 소개문. **빈 문자열일 수 있습니다** |
| `published_at` | `timestamptz` | 목록의 `<time datetime="…+09:00">` 값 |
| `external_url` | `text?` | **만든 것의 실제 주소** (제목 링크) |
| `source_domain` | `text?` | `(my.tool)` 에서 괄호를 뗀 값 |
| `points` | `int` | 추천 수 (수집 시점 스냅숏) |
| `comment_count` | `int` | 댓글 수 (수집 시점 스냅숏) |
| `submitter` | `text?` | 만든 사람 핸들 |
| `is_hidden` | `bool` | 운영자가 감춘 항목. **조회 시 반드시 걸러야 합니다** |
| `collected_at` | `timestamptz` | 수집 시각 |
| `collected_date` | `date` | 수집 날짜(KST). "오늘 퍼온 것" 기준 |

### PK 가 왜 원문 주소가 아니라 토픽 URL 인가

제목 링크(`external_url`)는 만든 사람이 도메인을 옮기거나 링크를 고치면 바뀝니다.
반면 토픽 URL 은 긱뉴스 안에서 고유하고 변하지 않습니다. 그래서 이 값을 PK 로 두고
`on conflict (url) do nothing` 으로 적재합니다 — **같은 명령을 몇 번 돌려도 행 수가
늘지 않습니다.**

소개문 없이 링크만 올린 글은 목록에 요약부(`div.topicdesc`)가 없습니다. 이런 행은
`data-topic-state-id` 로 **같은 형태의 토픽 URL 을 복원**하고 `summary` 를 빈
문자열로 둡니다. 댓글 링크(`topic?id=…&go=comments`)를 그대로 쓰지 않는 이유는,
그러면 같은 글이 두 개의 서로 다른 PK 로 쌓이기 때문입니다.

### `points` · `comment_count` 는 실시간 값이 아니다

수집 시점의 스냅숏이고 이후 갱신하지 않습니다. 정렬 기준으로 쓸 수는 있지만
「현재 추천 수」로 표시하면 원문과 어긋납니다. 최신 수치가 필요하면 `url` 로
원문을 열어야 합니다.

---

## 3. 조회 경로 세 가지

| 상황 | 방법 | 가능? |
|---|---|---|
| ① 웹 화면 · 서버 컴포넌트 | `src/lib/data/` 의 조회 함수 | ✅ 권장 |
| ② 운영·점검 | Supabase SQL Editor | ✅ |
| ③ 모바일 앱 | Supabase 직접 조회 (PostgREST) | ⚠️ **전용 뷰만** — 쇼케이스 뷰는 아직 없음 |

### ① 서버에서 조회 (웹 화면)

서버 컴포넌트는 `service_role` 키로 접근하므로 RLS 를 우회합니다.
[`src/lib/data/content.ts`](../src/lib/data/content.ts) 의 `getGeekNews()` 와 같은
모양으로 함수를 하나 추가하면 됩니다.

```ts
// src/lib/data/content.ts
export async function getShowcaseItems(limit = 30): Promise<ShowcaseItemRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("showcase_items")
    .select("*")
    .eq("is_hidden", false)              // ← 빠뜨리면 감춘 항목이 노출된다
    .order("published_at", { ascending: false })
    .limit(limit)
    .returns<ShowcaseItemRow[]>();

  if (error) throw new Error(`쇼케이스 조회 실패: ${error.message}`);
  return data ?? [];
}
```

두 가지는 선택이 아니라 **필수**입니다.

- `.eq("is_hidden", false)` — 운영자가 감춘 항목을 거르는 유일한 지점입니다.
  DB 에는 그대로 남아 있으므로, 이 필터가 없으면 그대로 화면에 나옵니다.
- `.order("published_at", …)` — 목록 순서는 점수순이라 원문 순서를 그대로 믿으면
  안 됩니다. 저장 후에는 항상 작성 시각으로 정렬합니다.

`published_at desc where is_hidden = false` 부분 인덱스가 이 쿼리에 맞춰져
있습니다(`0014_showcase.sql`).

### ② SQL 로 직접 (운영·점검)

```sql
-- 오늘(KST) 몇 건 들어왔나
select count(*)
  from public.showcase_items
 where collected_date = (timezone('Asia/Seoul', now()))::date;

-- 최근 20건
select published_at, title, submitter, points, external_url
  from public.showcase_items
 where is_hidden = false
 order by published_at desc
 limit 20;

-- 수집이 제대로 돌았나 (실행 로그)
select started_at, status, fetched_count, new_count, inserted_count, error
  from public.sync_runs
 where kind = 'showcase'
 order by started_at desc
 limit 10;

-- 특정 항목 감추기
update public.showcase_items
   set is_hidden = true
 where url = 'https://news.hada.io/topic?id=32709';
```

### ③ 모바일 — 전용 뷰를 통해서만

앱은 웹 API 를 거치지 않고 **Supabase(PostgREST)를 직접 읽습니다.**
[`supabase/migrations/0013_mobile_read_access.sql`](../supabase/migrations/0013_mobile_read_access.sql)
이 그 통로를 열어 두었습니다.

`0007_rls.sql` 은 원래 「RLS 를 켜고 정책은 하나도 만들지 않는」 구성이었고, 그
파일 마지막 줄이 이 변경을 예고해 두었습니다 — *"나중에 클라이언트 직접 조회가
필요해지면 그때 select 정책을 명시적으로 추가한다."* 모바일 앱이 그 경우입니다.

핵심은 **표가 아니라 뷰만 연다**는 것입니다.

| anon 에게 열린 것 | 닫힌 채로 남는 것 |
|---|---|
| `mobile_feed` · `mobile_trend_detail` · `mobile_issue` 의 `SELECT` | **원본 표 전부** (`showcase_items` 포함) · `members` · `scraps` · `articles` · `comments` |

anon 키는 앱 바이너리에 실려 사실상 공개된 값이라, 안전성이 전적으로 이 grant
구성에서 나오기 때문입니다. 표에 grant 하면 PostgREST 가 그 표의 모든 컬럼·필터·
정렬을 열어 주고, `is_hidden` 필터를 우회할 길도 생깁니다. 뷰만 열면 노출 범위가
뷰 정의로 고정됩니다.

**그래서 `showcase_items` 는 지금 앱에서 읽을 수 없습니다.** 표라서 닫혀 있습니다.
읽게 하려면 뷰를 하나 더 열어야 합니다 — [5장](#5-쇼케이스를-앱에서-읽게-하려면).

---

## 4. 지금 앱이 읽을 수 있는 것

| 뷰 | 내용 |
|---|---|
| `mobile_feed` | 목록 — `geek_news` + `trend_items` 를 같은 모양으로 정규화한 union. `type` 이 `geek` / `trend` |
| `mobile_trend_detail` | 트렌드 상세 (`body` · `tags`) |
| `mobile_issue` | 홈 마스트헤드 — 호수 · 최신 시각 · 오늘(KST) 건수 |

**쇼케이스는 여기 없습니다.** 수집만 되고 있고 앱으로 나가는 통로는 아직 없습니다.

읽기용 REST 라우트를 따로 만들지 않은 이유는 `0013` 커밋에 적혀 있습니다 — 목록을
RSC 로 그리고 있어 라우트와 proxy 예외를 새로 만들어야 하고, 무엇보다 목록 행의
지표 문구가 `src/lib/trendItem.ts` 와 두 벌이 되기 때문입니다. **쇼케이스도 같은
판단을 따르는 편이 좋습니다 — API 가 아니라 뷰입니다.**

앱이 거는 질의의 계약 원본은 모바일 저장소
[`ai-news-letter-mobile`](https://github.com/swpark3179/ai-news-letter-mobile) 의
`docs/03-api-contract.md` 입니다. **여기에 복사하지 마세요** — 두 벌이 갈립니다.

---

## 5. 쇼케이스를 앱에서 읽게 하려면

> ⚠️ **아직 만들지 않았습니다.** 이번 작업 범위는 수집과 문서까지입니다.
> 아래는 그대로 붙여 쓸 수 있게 준비해 둔 것입니다.

### `mobile_feed` 에 합칠까, 뷰를 따로 둘까

**따로 두는 것을 권합니다** (`mobile_showcase`).

`mobile_feed` 의 union 에 `type='show'` 를 더하면, 홈이 이 뷰를 **필터 없이 시간
역순으로 읽기** 때문에 **이미 배포된 앱 빌드의 홈 화면 내용이 그날로 바뀝니다.**
앱에 탭이 생기기도 전에 쇼케이스 항목이 뉴스 사이에 섞여 나오는 것입니다.
뷰를 따로 두면 기존 빌드는 영향을 받지 않고, 새 앱 버전이 탭을 붙일 때 읽으면
됩니다. 나중에 앱이 준비되면 그때 `mobile_feed` 로 접어 넣어도 늦지 않습니다.

### 붙일 마이그레이션 (`0015_mobile_showcase.sql`)

`0013` 의 규칙을 그대로 따릅니다 — 컬럼 구성이 바뀌어도 다시 실행할 수 있게
지우고 만들고, `security_invoker` 는 켜지 않으며(기본값), grant 는 스키마 단위가
아니라 뷰 하나씩 명시합니다.

```sql
drop view if exists public.mobile_showcase;

create view public.mobile_showcase as
select
    s.url                                          as key,
    s.title                                        as title,
    s.summary                                      as lede,
    -- mobile_feed 의 meta 규칙과 같은 모양: "my.tool · 12 points · 댓글 3"
    concat_ws(' · ',
      nullif(btrim(coalesce(s.source_domain, '')), ''),
      s.points || ' points',
      '댓글 ' || s.comment_count
    )                                              as meta,
    s.published_at                                 as published_at,
    -- mobile_feed 와 일부러 다른 곳. 긱뉴스는 요약과 댓글이 토픽 페이지에 있어
    -- 그쪽을 열지만, 쇼케이스에서 사람들이 보고 싶은 것은 「만든 것」이다.
    -- 다만 external_url 이 비어 있는 글도 있어 토픽 URL 로 떨어뜨린다.
    coalesce(nullif(btrim(coalesce(s.external_url, '')), ''), s.url) as open_url,
    coalesce(s.source_domain, '')                  as host,
    s.submitter                                    as maker,
    concat_ws(' ', s.title, s.summary)             as search_text
  from public.showcase_items s
  where s.is_hidden = false;   -- ← 뷰 안에 박아 우회할 길을 없앤다

comment on view public.mobile_showcase is
  '모바일 쇼케이스 목록 — 직접 만든 것 소개. anon SELECT 허용.';

grant select on public.mobile_showcase to anon;
```

- `key` 와 `open_url` 을 나눈 것이 요점입니다. `key` 는 PK(토픽 URL)라 담기·중복
  제거에 쓰고, `open_url` 은 실제로 열 주소입니다. 두 값이 같은 `mobile_feed` 와
  다른 지점이니 계약 문서에 적어 두세요.
- `where is_hidden = false` 를 **뷰 안에** 두는 것이 0013 의 방침입니다. 앱이 거는
  필터에 맡기면 우회할 수 있습니다.
- 뒤이어 [`supabase/VERIFY.sql`](../supabase/VERIFY.sql) 의 ⑪⑫ 기대값을
  「뷰 4개 / anon grant 4행」으로 고치세요. ⑫ 는 anon 에게 무엇이 열려 있는지
  보는 항목이라, 기대값을 갱신하지 않으면 검증이 무의미해집니다.
- 앱 쪽 질의는 모바일 저장소의 `docs/03-api-contract.md` 에 적습니다.

### 커서 페이지네이션

무한 스크롤에서 `offset` 은 **항목을 건너뛰거나 중복시킵니다.** 스크롤하는 동안 새
글이 앞에 끼어들면 뒤 페이지가 통째로 밀리기 때문입니다. `published_at` 하나만으로도
부족합니다 — 같은 시각에 올라온 글이 있으면 경계에서 같은 문제가 납니다.
**`(published_at, key)` 복합 커서**를 쓰세요.

PostgREST 질의로는 이런 모양입니다.

```
/rest/v1/mobile_showcase
  ?select=*
  &order=published_at.desc,key.desc
  &limit=21                                   # 20건 + hasMore 판정용 1건
  &or=(published_at.lt."<커서 시각>",and(published_at.eq."<커서 시각>",key.lt."<커서 key>"))
```

- 값에 `+` `:` `,` 가 들어가므로 **큰따옴표로 감싸세요.**
- `order` 두 개와 커서 비교의 방향이 **반드시 같아야** 합니다.


## 6. 앱 화면에서 주의할 것

- **썸네일 이미지가 없습니다.** 목록에서 이미지를 긁지 않으므로 텍스트 카드를
  전제로 레이아웃을 잡으세요.
- **`summary` 가 빈 문자열일 수 있습니다.** 소개문 없이 링크만 올린 글입니다.
  두 줄 고정 높이를 잡아 두면 이런 카드에서 빈칸이 생깁니다.
- **탭 했을 때 열 주소는 `external_url ?? url`** 입니다. 사용자가 보고 싶은 것은
  「만든 것」이지 긱뉴스 토픽 페이지가 아닙니다. 다만 `external_url` 이 비어 있는
  글도 있으므로 `url` 로 떨어뜨리세요. 5장의 뷰는 이것을 `open_url` 로 계산해
  내려보내므로, 앱이 다시 판단할 필요가 없습니다 — `mobile_feed` 는 `key` 와
  `open_url` 이 같지만 여기서는 다릅니다.
- **`is_hidden` 필터는 뷰 안에** 있어야 합니다. 앱이 거는 필터에 맡기면 우회할 수
  있고, 앱에서 거르면 감춘 항목이 네트워크로 이미 나간 뒤입니다.
- **오프라인 캐시 키는 `url`** (PK). 안정적이고 재수집해도 바뀌지 않습니다.
- **정렬은 서버 순서를 그대로 믿으세요.** 클라이언트에서 다시 정렬하면 커서
  페이지네이션과 어긋납니다.
- **`points` 는 수집 시점 값**입니다. 「현재 추천 수」처럼 보이는 UI 는 피하세요.

---

## 7. 웹 화면(`/sections/…`)을 붙일 때

이번 작업은 **수집과 문서까지**입니다. 웹 목록 화면을 붙일 때 함께 손봐야 하는
곳을 남겨 둡니다. 지금 미리 넣어 두면 아무 데서도 안 쓰이는 죽은 상수가 됩니다.
(앱 쪽은 [5장](#5-쇼케이스를-앱에서-읽게-하려면) — 서로 독립이라 둘 중 하나만
해도 됩니다.)

- [ ] `src/types/db.ts` — `SectionKey` 에 `"show"` 추가
- [ ] `src/lib/domain.ts` — `SECTIONS` 에 `{ key: "show", ko: "쇼케이스", en: "Showcase", automated: true }`, `NAV_ITEMS` 에 항목 추가
- [ ] `src/lib/data/content.ts` — 위 [①](#-서버에서-조회-웹-화면) 의 `getShowcaseItems()`
- [ ] `src/app/(site)/sections/[section]/page.tsx` — `section === "show"` 분기
- [ ] 보관함까지 지원한다면: `ScrapTargetType` 에 `"show"`, `scraps.target_type`
      CHECK 제약(마이그레이션), `src/app/api/scraps/route.ts` 의 `targetExists`
- [ ] 출처 배지를 쓴다면 `SourceKind` 와 `SRC`

---

## 8. 문제 해결

### 수집이 0건이다

`sync_runs` 를 먼저 보세요.

```sql
select started_at, status, fetched_count, inserted_count, error, logs
  from public.sync_runs
 where kind = 'showcase'
 order by started_at desc limit 3;
```

- **status = `failed` 이고 「목록에서 항목을 하나도 찾지 못했습니다」** — 마크업
  (`div.topic_row`)이 바뀌었거나 WAF 에 막힌 것입니다. 파서는
  `src/lib/sync/sources/geeknews.ts` 에 있습니다. 이 실패는 **일부러** 성공으로
  넘기지 않습니다 — 「새 글이 없다」와 「파싱이 깨졌다」가 둘 다 0건이라
  구분되지 않기 때문입니다.
- **status = `success` 인데 0건** — 정상입니다. `SHOW_LOOKBACK_DAYS` (기본 3일)
  안에 새 글이 없었다는 뜻입니다. `/show` 는 메인보다 글이 뜸합니다.
- **HTTP 403** — `news.hada.io` 는 User-Agent 에 `bot` 이 들어가면 403 을
  돌려줍니다(robots.txt 는 열려 있지만 WAF 단에서 막힘). `SYNC_USER_AGENT` 를
  건드렸다면 되돌리세요.

### 로컬에서 확인하기

```bash
npm run sync:showcase -- --dry-run      # 저장하지 않고 파싱 결과만
npm run sync:showcase -- --days=7       # 7일치
npm run sync:showcase                   # 실제 적재
```

`--dry-run` 은 `sync_runs` 에도 흔적을 남기지 않습니다.

GitHub 에서 확인하려면 Actions → **쇼케이스 동기화** → `Run workflow` →
`dry_run: true` 로 돌려 로그에 제목·URL 이 찍히는지 보면 됩니다.

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `.github/workflows/sync-hada-show.yml` | 매일 07:20 KST 실행 |
| `scripts/sync/showcase.ts` | CLI 진입점 |
| `src/lib/sync/showcase.ts` | 수집 → 중복 제거 → 적재 |
| `src/lib/sync/sources/hada-show.ts` | `/show` 고유 설정 |
| `src/lib/sync/sources/geeknews.ts` | news.hada.io 목록 파서 (메인·쇼케이스 공용) |
| `src/lib/sync/http.ts` | UA · 요청 간격 · 백오프 |
| `supabase/migrations/0014_showcase.sql` | 테이블 · 인덱스 · RLS |
| `supabase/migrations/0013_mobile_read_access.sql` | 앱이 읽는 뷰 3개와 anon grant (쇼케이스는 아직 없음) |
| `src/types/db.ts` | `ShowcaseItemRow` · `SyncRunKind` |
| [`docs/MOBILE_OAUTH2.md`](MOBILE_OAUTH2.md) | 앱 인증 (Bearer 토큰 발급) |

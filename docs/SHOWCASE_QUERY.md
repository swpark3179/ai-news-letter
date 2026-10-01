# 쇼케이스 데이터

`https://news.hada.io/show` 에서 매일 수집하는 **쇼케이스**(직접 만든 것 소개)가 어디에
어떻게 쌓이고, 웹 · 앱이 무엇으로 읽는지 정리한 문서입니다.

> **요약** — 수집기가 `showcase_items` 표에 쌓고, 웹과 앱은 표가 아니라
> **`mobile_showcase` 뷰**를 anon 키로 읽습니다(`0016` · `0019`). 본문은 긱뉴스와 같은
> `mobile_hada_content` 뷰에 있습니다(`0017`).

---

## 1. 무엇이 쌓이나

긱뉴스 메인 목록(`https://news.hada.io/`)이 **읽을 거리**를 모으는 곳이라면,
`/show` 는 사람들이 **직접 만든 것을 소개하는** 게시판입니다. 사이드 프로젝트,
직접 만든 도구·라이브러리·서비스가 올라옵니다.

성격이 달라 긱뉴스와 **테이블을 나눠** 저장합니다. 한 테이블에 섞으면 화면에서
「오늘의 뉴스」와 「누가 뭘 만들었나」를 구분할 수 없기 때문입니다.

| | 긱뉴스 | 쇼케이스 |
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

### 같은 글이 양쪽에 잡힐 때 — 쇼케이스가 이깁니다

`/show` 에 올라온 글은 메인 목록에도 함께 뜹니다. 두 목록이 같은 `div.topic_row`
템플릿이라 **요약부 링크(= 두 테이블의 PK)까지 같은 문자열**이고, 각 테이블 안의
PK 는 테이블을 가로지르는 중복을 막지 못합니다. 그대로 두면 같은 글이 「오늘의
뉴스」와 「누가 뭘 만들었나」에 두 번 보입니다.

그래서 두 수집기가 URL 로 겹침을 확인하고 **한쪽으로만 남깁니다.**

| 겹침을 발견한 쪽 | 하는 일 |
|---|---|
| 긱뉴스 수집 | 쇼케이스에 있는 URL 은 적재하지 않고, 이미 들어가 있던 `geek_news` 행도 지웁니다 |
| 쇼케이스 수집 | `geek_news` 행을 **수집 이력(`collected_at` · `collected_date`)과 `is_hidden` 째로** 넘겨받아 `showcase_items` 에 담고, `geek_news` 에서 지웁니다 |

방향을 쇼케이스로 못박은 이유는 「누가 무엇을 만들었나」가 「읽을 거리 하나」보다
좁고 확실한 정보이고, 무엇보다 **어느 수집기가 먼저 돌든 결과가 같아야** 하기
때문입니다 (지금 일정은 긱뉴스 07:00 → 쇼케이스 07:20 이라 그날치는 긱뉴스에
먼저 들어갑니다).

본문(`hada_contents`)은 지우지 않습니다. PK 가 같은 토픽 URL 이고 상세 페이지도
하나뿐이라 `source` 라벨만 `showcase` 로 고쳐 답니다 — 지우면 다음 실행에서 같은
페이지를 쓸데없이 다시 받습니다.

> 앱 보관함은 기기에만 있고 토픽 URL(`key`)로 항목을 찾습니다. `mobile_feed` 에서
> 못 찾은 키는 `mobile_showcase` 에서 한 번 더 찾으므로, 긱뉴스로 담아 둔 글이
> 쇼케이스로 옮겨 가도 보관함에서 빠지지 않습니다.

구현은 [`src/lib/sync/hada-dedup.ts`](../src/lib/sync/hada-dedup.ts) 한 파일에
모여 있습니다.

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

## 3. 웹 · 앱이 읽는 것 — `mobile_showcase`

표는 닫혀 있고(RLS 켬 · 정책 0건 · anon 권한 없음), 뷰만 anon 에게 SELECT 로 열려
있습니다. 감춘 글(`is_hidden`)은 뷰 안에서 걸러져 **우회할 길이 없습니다.**

| 열 | 값 |
|---|---|
| `type` | 항상 `show` |
| `key` | 토픽 URL (`showcase_items.url`) — 상세 · 보관함 · 본문을 찾는 키 |
| `title` · `lede` | 제목 · 소개문 (`lede` 는 빈 문자열일 수 있습니다) |
| `meta` | `mssj.ai · 12 points · 댓글 3` — 목록에 그대로 찍는 문구 |
| `published_at` | 원문 게시 시각 |
| `open_url` | **만든 것의 주소** (`external_url`, 비었으면 토픽 URL) |
| `host` | `source_domain` |
| `maker` | 만든 사람 (`submitter`) |
| `search_text` | 제목 + 소개문 — 검색용 |
| `collected_date` · `score` | 수집한 날(KST) · points — 웹이 날짜로 묶고 순서를 정할 때 쓴다 (`0019`, 끝에 붙인 열) |

`mobile_feed` 와 다른 점: 거기서는 `key` 와 `open_url` 이 같지만, 쇼케이스는 사람들이
보고 싶은 것이 「만든 것」이라 `open_url` 이 바깥 주소입니다. 토픽 페이지(댓글)는
`key` 로 엽니다.

**웹**

- `/sections/show` — 수집한 날로 묶어 7일씩, `?q=` 로 검색
- `/articles/show/<토픽 id>` — 본문(`mobile_hada_content`)을 사이트 안에서 보여 주고,
  「만든 것 ↗」 · 「news.hada.io 댓글 ↗」 링크를 단다
- 1면 사이드바 — 마지막으로 수집한 날의 쇼케이스 전부

**앱** — 긱뉴스 탭의 「쇼케이스」 칩. 질의와 열 계약은 모바일 저장소의
[`docs/03-api-contract.md`](https://github.com/swpark3179/ai-news-letter-mobile/blob/main/docs/03-api-contract.md)
에 있습니다.

---

## 4. 운영 쿼리

```sql
-- 오늘(KST) 몇 건 들어왔나 (감춘 글 제외)
select count(*)
  from public.mobile_showcase
 where collected_date = (timezone('Asia/Seoul', now()))::date;

-- 최근 20건
select published_at, title, submitter, points, external_url
  from public.showcase_items
 where is_hidden = false
 order by published_at desc
 limit 20;

-- 본문이 아직 없는 쇼케이스
select s.url, s.title
  from public.showcase_items s
  left join public.hada_contents c on c.url = s.url and c.status = 'ok'
 where c.url is null
 order by s.published_at desc
 limit 20;

-- 수집이 제대로 돌았나
select started_at, status, fetched_count, new_count, inserted_count, error
  from public.sync_runs
 where kind = 'showcase'
 order by started_at desc
 limit 10;

-- 특정 항목 감추기 (목록 · 본문 뷰에서 함께 빠진다)
update public.showcase_items
   set is_hidden = true
 where url = 'https://news.hada.io/topic?id=32709';
```

> 행을 **지우지 마세요.** PK 가 사라지면 다음 수집에서 같은 글을 다시 담습니다.

---

## 5. 화면을 만들 때 알아 둘 것

- **썸네일이 없습니다.** 목록에서 이미지를 긁지 않으므로 텍스트 카드를 전제로 합니다.
- **소개문이 빈 글이 있습니다.** 링크만 올린 글입니다. 두 줄 고정 높이를 잡으면 빈칸이
  생깁니다.
- **`points` 는 수집 시점 값**입니다. 「현재 추천 수」처럼 보이는 UI 는 피하세요.
- **정렬은 서버 순서를 그대로 쓰세요.** 클라이언트에서 다시 정렬하면 페이지 경계가
  어긋납니다.

---

## 6. 문제 해결

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
  넘기지 않습니다 — 「새 글이 없다」와 「파싱이 깨졌다」가 둘 다 0건이라 구분되지
  않기 때문입니다.
- **status = `success` 인데 0건** — 정상입니다. `SHOW_LOOKBACK_DAYS`(기본 3일) 안에
  새 글이 없었다는 뜻입니다. `/show` 는 메인보다 글이 뜸합니다.
- **HTTP 403** — `news.hada.io` 는 User-Agent 에 `bot` 이 들어가면 403 을 돌려줍니다.
  `SYNC_USER_AGENT` 를 건드렸다면 되돌리세요.

### 웹 · 앱에 안 보인다

- 표에는 있는데 뷰에 없으면 `is_hidden = true` 인 행입니다.
- 웹 1면 사이드바는 **마지막으로 수집한 날** 것만 싣습니다. 지난 글은 `/sections/show`
  에서 보세요.

### 로컬에서 확인하기

```bash
npm run sync:showcase -- --dry-run      # 저장하지 않고 파싱 결과만
npm run sync:showcase -- --days=7       # 7일치
npm run sync:showcase                   # 실제 적재
```

`--dry-run` 은 `sync_runs` 에도 흔적을 남기지 않습니다. GitHub 에서는 Actions →
**쇼케이스 동기화** → `Run workflow` → `dry_run: true` 로 같은 확인을 합니다.

---

## 관련 파일

| 파일 | 역할 |
|---|---|
| `.github/workflows/sync-hada-show.yml` | 매일 07:20 KST 실행 |
| `scripts/sync/showcase.ts` | CLI 진입점 |
| `src/lib/sync/showcase.ts` | 수집 → 중복 제거 → 적재 |
| `src/lib/sync/hada-dedup.ts` | 긱뉴스 ↔ 쇼케이스 중복 정리 (양쪽 수집기 공용) |
| `src/lib/sync/sources/hada-show.ts` | `/show` 고유 설정 |
| `src/lib/sync/sources/geeknews.ts` | news.hada.io 목록 파서 (메인 · 쇼케이스 공용) |
| `supabase/migrations/0014_showcase.sql` | 표 · 인덱스 · RLS |
| `supabase/migrations/0016_mobile_showcase.sql` | `mobile_showcase` 뷰 |
| `supabase/migrations/0019_web_read_columns.sql` | 뷰 끝에 붙인 `collected_date` · `score` |
| `src/lib/data/feed.ts` | 웹의 읽기 쿼리 (`fromCategory("show")`) |
| `src/components/article/HadaArticle.tsx` | 웹의 쇼케이스 · 긱뉴스 본문 상세 |

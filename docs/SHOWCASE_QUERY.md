# 쇼케이스 데이터 조회 가이드

`https://news.hada.io/show` 에서 매일 수집하는 **쇼케이스** 데이터를 어떻게 읽는지
정리한 문서입니다. 특히 **모바일 앱에서 조회하려면 무엇이 필요한지**를 다룹니다.

> **먼저 알아야 할 것**
> 앱은 Supabase 를 **직접 조회할 수 없습니다.** 모든 조회는 이 서버의 API 를
> 거쳐야 합니다. 이유는 [3-③](#3-모바일--서버-api-를-거쳐야-한다) 에 있습니다.
> 그 읽기 API 는 **아직 만들어져 있지 않습니다** — 무엇을 만들어야 하는지는
> [5장](#5-모바일-읽기-api-를-만들-때-제안)에 적어 두었습니다.

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

스키마 원본은 [`supabase/migrations/0013_showcase.sql`](../supabase/migrations/0013_showcase.sql),
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
| ③ 모바일 앱 | Supabase 직접 조회 | ❌ **불가능** → 서버 API 필요 |

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
있습니다(`0013_showcase.sql`).

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

### ③ 모바일 — 서버 API 를 거쳐야 한다

**앱에서 Supabase 를 직접 조회하는 경로는 막혀 있습니다.** 코드를 잘못 써서가 아니라
설계가 그렇습니다. [`supabase/migrations/0007_rls.sql`](../supabase/migrations/0007_rls.sql)
이 이렇게 해 두었기 때문입니다.

```sql
alter table public.showcase_items enable row level security;
revoke all on public.showcase_items from anon, authenticated;
```

- RLS 는 켜져 있고 **정책(policy)은 하나도 없습니다.** 정책이 없으면 `anon` ·
  `authenticated` 롤의 모든 접근이 거부됩니다.
- 이 서비스는 Supabase Auth 를 쓰지 않습니다. 로그인은 사내 SSO / 소셜 ID 토큰이고,
  브라우저에도 앱에도 **Supabase 키를 일절 내려보내지 않습니다.**
- 그래서 anon 키가 유출되어도 사내 콘텐츠가 새지 않습니다. 이 안전성이 「앱에서
  직접 조회 불가」의 대가입니다.

즉 앱이 할 수 있는 일은 **이 서버의 HTTP API 를 호출하는 것뿐**이고, 그 API 는
아직 없습니다. 다음 장이 그것을 만드는 방법입니다.

---

## 4. 지금 API 가 어디까지 있나

[`docs/MOBILE_OAUTH2.md`](MOBILE_OAUTH2.md) 에 적힌 대로, 앱이 쓸 수 있는 것은
**인증 계열뿐**입니다.

| 있는 것 | 없는 것 |
|---|---|
| `POST /api/auth/google` · `apple` · `refresh` · `logout` · `link-member` | 읽기 엔드포인트 전부 |
| `GET /api/me` (세션 복원) | 긱뉴스 · 트렌드 · **쇼케이스** 목록 |

앱은 읽기 화면을 아직 목업 데이터로 그리고 있습니다.

---

## 5. 모바일 읽기 API 를 만들 때 (제안)

> ⚠️ **아직 구현되지 않았습니다.** 아래는 서버 쪽에서 본 설계 제안입니다.
>
> 앱이 기대하는 **계약의 원본은 모바일 저장소**
> [`ai-news-letter-mobile`](https://github.com/swpark3179/ai-news-letter-mobile) 의
> `docs/03-api-contract.md` 입니다 (`MOBILE_OAUTH2.md` 의 방침). 실제로 만들 때는
> **그 문서에 「읽기」 절을 쓰고 그것을 기준으로 삼으세요.** 여기에 계약을 복사해
> 두면 두 벌이 갈립니다. 이 장은 서버 쪽 제약과 함정만 남깁니다.

### 경로

`MOBILE_OAUTH2.md` 가 읽기 엔드포인트를 `/api/mobile/*` 로 잡아 두었으므로
**`GET /api/mobile/showcase`** 를 따르는 것이 좋습니다.

### 인증 — 여기서 한 번씩 걸립니다

```
Authorization: Bearer <accessToken>
```

1. **`getSessionUser(req)` 에 `req` 를 반드시 넘기세요.**
   안 넘기면 쿠키만 보기 때문에 **웹은 멀쩡히 동작하고 앱만 401** 이 됩니다.
   조용히 어긋나는 종류의 버그라 `src/lib/auth/current-user.ts` 주석에도 경고가
   붙어 있습니다.

   ```ts
   const user = await getSessionUser(req);   // ← req 필수
   if (!user) {
     return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
   }
   ```

2. **proxy 통과는 인증 완료가 아닙니다.**
   `/api/mobile/*` 는 [`src/proxy.ts`](../src/proxy.ts) 의 matcher 안이라 유효한
   쿠키·Bearer 없이는 401 로 끊깁니다. 다만 목업 모드에서는 **게스트 쿠키도
   통과**하므로, 핸들러가 스스로 한 번 더 확인해야 합니다.

3. `runtime = "nodejs"` 를 선언하세요. `supabaseAdmin()` 은 Edge 에서 못 씁니다.

### 페이지네이션 — offset 이 아니라 커서

무한 스크롤에서 `offset` 은 **항목을 건너뛰거나 중복시킵니다.** 스크롤하는 동안
새 글이 앞에 끼어들면 뒤 페이지 전체가 한 칸씩 밀리기 때문입니다.

`published_at` 하나만으로도 부족합니다. 같은 시각에 올라온 글이 있으면 경계에서
같은 문제가 납니다. **`(published_at, url)` 복합 커서**를 쓰세요.

```ts
// cursor = base64url(JSON.stringify({ p: published_at, u: url }))
let q = db
  .from("showcase_items")
  .select("*")
  .eq("is_hidden", false)
  .order("published_at", { ascending: false })
  .order("url", { ascending: false })
  .limit(limit + 1);              // +1 로 hasMore 를 판정한다

if (cursor) {
  const { p, u } = decodeCursor(cursor);
  // (published_at, url) < (p, u) 를 PostgREST 문법으로 쓴 것
  q = q.or(`published_at.lt."${p}",and(published_at.eq."${p}",url.lt."${u}")`);
}
```

- 값에 `+` `:` `,` 가 들어가므로 **큰따옴표로 감싸세요.**
- `limit + 1` 건을 받아 초과분이 있으면 `hasMore = true`, 응답에서는 잘라 냅니다.
- 정렬 두 개(`published_at`, `url`)와 커서 비교의 방향이 **반드시 같아야** 합니다.

### 응답에 담을 것

`ShowcaseItemRow` 를 그대로 내보내지 말고 앱이 쓸 필드만 고르세요.
`collected_at` · `is_hidden` 같은 내부 열은 앱에 필요 없습니다.

- 항목 배열 + 다음 커서 + 더 있는지 여부
- 필드는 `url`(키) · `title` · `summary` · `publishedAt` · `externalUrl` ·
  `sourceDomain` · `points` · `commentCount` · `submitter` 정도

### 오류 형식

기존 라우트가 전부 `{ "error": "한국어 메시지" }` 를 씁니다. 새 엔드포인트도
같은 모양을 지키세요 — 앱이 오류 표시를 한 곳에서 처리할 수 있습니다.

| 상태 | 언제 |
|---|---|
| `401` | 토큰 없음·만료 (앱은 refresh 후 1회 재시도) |
| `400` | `limit` 범위 밖, 커서 해독 실패 |
| `500` | DB 오류 |

`limit` 은 상한을 두세요(예: 기본 20 / 최대 50). 상한이 없으면 한 번의 요청으로
테이블 전체를 끌어갈 수 있습니다.

---

## 6. 앱 화면에서 주의할 것

- **썸네일 이미지가 없습니다.** 목록에서 이미지를 긁지 않으므로 텍스트 카드를
  전제로 레이아웃을 잡으세요.
- **`summary` 가 빈 문자열일 수 있습니다.** 소개문 없이 링크만 올린 글입니다.
  두 줄 고정 높이를 잡아 두면 이런 카드에서 빈칸이 생깁니다.
- **탭 했을 때 열 주소는 `external_url ?? url`** 입니다. 사용자가 보고 싶은 것은
  「만든 것」이지 긱뉴스 토픽 페이지가 아닙니다. 다만 `external_url` 이 비어 있는
  글도 있으므로 `url` 로 떨어뜨리세요.
- **`is_hidden` 필터는 서버에서** 겁니다. 앱에서 거르면 감춘 항목이 네트워크로 이미
  나간 뒤입니다.
- **오프라인 캐시 키는 `url`** (PK). 안정적이고 재수집해도 바뀌지 않습니다.
- **정렬은 서버 순서를 그대로 믿으세요.** 클라이언트에서 다시 정렬하면 커서
  페이지네이션과 어긋납니다.
- **`points` 는 수집 시점 값**입니다. 「현재 추천 수」처럼 보이는 UI 는 피하세요.

---

## 7. 웹 화면(`/sections/…`)을 붙일 때

이번 작업은 **수집과 문서까지**입니다. 웹 목록 화면을 붙일 때 함께 손봐야 하는
곳을 남겨 둡니다. 지금 미리 넣어 두면 아무 데서도 안 쓰이는 죽은 상수가 됩니다.

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
| `supabase/migrations/0013_showcase.sql` | 테이블 · 인덱스 · RLS |
| `src/types/db.ts` | `ShowcaseItemRow` · `SyncRunKind` |
| [`docs/MOBILE_OAUTH2.md`](MOBILE_OAUTH2.md) | 앱 인증 (Bearer 토큰 발급) |

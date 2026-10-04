# AI 뉴스레터

매일 아침 모아 온 AI 소식을 신문 지면처럼 읽는 일간 뉴스레터.
Next.js 16 (App Router) + Supabase. 로그인 · 관리자 기능이 없는 읽기 전용 사이트입니다.

claude.ai/design 프로젝트 `AI 뉴스레터.dc.html` 의 지면 디자인을 구현한 것입니다.

모바일 앱은 별도 저장소([`ai-news-letter-mobile`](https://github.com/swpark3179/ai-news-letter-mobile),
Flutter)에 있고, **이 서버의 API 를 쓰지 않습니다** — Supabase 의 모바일 뷰를
anon 키로 직접 읽습니다 (`supabase/migrations/0013` · `0016` · `0017` · `0019`).
웹도 같은 키로 같은 뷰를 읽습니다.

---

## 카테고리

앱의 탭 · 칩과 같은 다섯 갈래입니다.

| 카테고리 | 출처 | 채우는 방법 |
|---|---|---|
| 긱뉴스 | news.hada.io | 자동 수집 — **LLM 미사용**, 제목·요약·본문을 원문 그대로 |
| 쇼케이스 | news.hada.io/show (직접 만든 것 소개) | 같음 |
| GitHub | GitHub Trending | 자동 수집 + LLM 이 한국어 기사 작성 |
| Hacker News | Hacker News | 같음 |
| arXiv | arXiv | 같음 |

웹과 앱은 같은 뷰(`mobile_feed` · `mobile_showcase` · `mobile_trend_detail` ·
`mobile_hada_content` · `mobile_issue`)를 같은 anon 키로 읽습니다. 쇼케이스의
스키마와 조회 방법은 [docs/SHOWCASE_QUERY.md](docs/SHOWCASE_QUERY.md) 를 보세요.

---

## 빠른 시작

```bash
npm install
cp .env.local.example .env.local     # Supabase 키 등을 채운다
```

Supabase 테이블을 먼저 만듭니다 → [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md)

```bash
npm run sync:geeknews -- --dry-run   # 파싱만 확인 (DB 미기록)
npm run sync:geeknews                # 실제 적재
npm run sync:trend -- --limit=5      # 5건만 기사화해 확인
npm run dev                          # http://localhost:3000
```

---

## 화면

| 경로 | 내용 |
|---|---|
| `/` | 1면 — 카테고리마다 마지막으로 수집한 날 것을 전부. 머리기사 3단 조판, GitHub · HN · arXiv 3열, 긱뉴스 · 쇼케이스 사이드바 |
| `/sections/[geek\|show\|github\|hn\|arxiv]` | 카테고리 목록 — 수집한 날로 묶어 7일씩 (`?until=YYYY-MM-DD`), `?q=` 검색 |
| `/search?q=` | 다섯 카테고리 한꺼번에 검색 |
| `/articles/geek/[...ref]` · `/articles/show/[...ref]` | 긱뉴스 · 쇼케이스 본문 (`mobile_hada_content` 의 마크다운) |
| `/articles/trend/[publicId]` | 트렌드 브리핑 상세 |

예전 주소 `/sections/trend?filter=<출처>` 는 `/sections/<출처>` 로 308 리다이렉트됩니다.

---

## 구조

```
src/
  app/
    (site)/            열람 화면 — 헤더 레이아웃
    tokens.css         디자인 토큰 (claude.ai/design 원본을 그대로 이식)
  components/          화면별 컴포넌트 + 같은 폴더의 .module.css
  lib/
    data/feed.ts       읽기 쿼리 — 모바일 뷰를 anon 키로 읽는다
    llm/               Gemini · OpenAI 공통 인터페이스
    sync/              수집 파이프라인 (sources/ 아래에 출처별 어댑터)
    supabase/          read.ts(웹 · anon 키) · admin-client.ts(수집 스크립트 · service_role)
scripts/sync/          CLI 진입점 (tsx)
supabase/migrations/   스키마 SQL 22개 (0020 이후 안 쓰는 표는 graveyard 스키마에 · 0022 정시 실행 cron)
.github/workflows/     동기화 워크플로 4개 + 백업(워치독) 1개 + 진단 1개
```

**스타일링** — CSS Modules + `src/app/tokens.css`.
디자인 원본이 `var(--purple-600)` 같은 토큰을 인라인으로 참조하고 있어서,
변수명을 그대로 유지하는 것이 재현도의 핵심입니다.

---

## 동기화

### 긱뉴스 (LLM 없음)

`https://news.hada.io/?page=N` 목록을 `cheerio` 로 파싱합니다.

- **PK = 요약부 링크** (`div.topicdesc > a[href]`) — `topic?id=NNNNN` 또는
  긱뉴스 자체글의 `/article/<slug>`. `on conflict do nothing` 이라 재실행해도
  중복이 생기지 않습니다.
- 작성일은 `<time datetime="…+09:00">` 속성을 그대로 씁니다 ("n일전" 역산 불필요).
- 점수순 목록이라 오래된 글이 섞여 있어, 기간 안 항목이 0건인 페이지가 2번 연속
  나오면 멈춥니다 (최대 8페이지).
- 요청 간 1.5초 간격 + 403/429 지수 백오프.
- Atom 피드(`/rss/news`)로 최근 항목의 요약을 더 긴 원문으로 보강합니다.

### 쇼케이스 (LLM 없음)

`https://news.hada.io/show?page=N` — 사람들이 **직접 만든 것을 소개하는** 게시판.
성격이 달라 긱뉴스와 테이블(`showcase_items`)과 워크플로를 나눴습니다.
매일 07:20 · 11:50 KST 에 돕니다 (긱뉴스와 20분 띄워 같은 사이트를 동시에 치지 않습니다).

- 목록 마크업이 메인과 같은 `div.topic_row` 라 **파서를 공유**합니다
  (`crawlHadaList` 에 경로만 갈아 끼움).
- 소개문 없이 링크만 올린 글이 있어, 그런 행은 토픽 id 로 PK 를 복원하고
  `summary` 를 빈 문자열로 둡니다. 메인 기준으로 버리면 조용히 누락됩니다.
- Atom 피드 보강은 **하지 않습니다** — hada.io 공식 피드는 `/rss/news` 와
  `/rss/blog` 뿐이고 `/show` 용이 없습니다. 3rd-party 미러에 의존하지 않습니다.
- 1페이지에서 한 건도 못 뽑으면 **실패로 끝냅니다.** 「새 글이 없다」와
  「파싱이 깨졌다」가 둘 다 0건이라 구분되지 않기 때문입니다.

### 긱뉴스 ↔ 쇼케이스 중복 (LLM 없음)

`/show` 글은 메인 목록에도 함께 뜹니다. 두 목록이 같은 템플릿이라 PK(요약부 링크)
까지 같은 문자열이고, 각 테이블의 PK 는 테이블을 가로지르는 중복을 막지 못합니다.
그대로 두면 같은 글이 「오늘의 뉴스」와 「누가 뭘 만들었나」에 두 번 보입니다.

**겹치면 쇼케이스가 이깁니다** — 어느 수집기가 먼저 돌든 결과가 같아야 하므로
방향을 한쪽으로 못박았습니다 (`src/lib/sync/hada-dedup.ts`).

- **긱뉴스 수집 중** 쇼케이스에 있는 URL 을 만나면 → 담지 않고, 이미 들어가 있던
  `geek_news` 행도 지웁니다.
- **쇼케이스 수집 중** `geek_news` 에 있는 URL 을 만나면 → 수집 이력
  (`collected_at` · `collected_date`)과 `is_hidden` 을 그대로 이어받아 쇼케이스로
  옮겨 담고 긱뉴스에서 지웁니다. 오늘 처음 본 글로 다시 적으면 지난 날짜의
  「오늘 몇 건」 집계가 흔들리고, 감춰 둔 글이 도로 나타납니다.
- 삭제는 **적재가 끝난 뒤**에 합니다. 먼저 지우면 적재가 실패했을 때 그 항목이
  어느 테이블에도 남지 않습니다.
- 본문(`hada_contents`)은 지우지 않고 `source` 라벨만 `showcase` 로 고칩니다 —
  상세 페이지가 하나뿐이라 다시 받을 이유가 없습니다.

### 본문 수집 (LLM 없음)

목록만으로는 앱이 `news.hada.io` 로 링크를 열어 줄 수밖에 없었고, 그 페이지에
광고가 섞여 읽기 불편했습니다. 그래서 목록을 적재한 뒤 **상세 페이지를 열어
본문을 `hada_contents` 에 담습니다.** 긱뉴스와 쇼케이스가 같은 코드를 씁니다.

- **경계는 "함께 보면 좋은 글"** — 상세 페이지는 `제목 → 작성자 → 본문 →
  "함께 보면 좋은 글" → 관련글 → 댓글` 순서입니다. 그 문구가 시작하는 노드부터
  문서 순서로 뒤를 전부 버립니다. 경계가 리터럴 문자열이라 **LLM 이 필요 없습니다** —
  요약이 아니라 원문 이관이므로 모델을 태우면 비용과 변형 위험만 늘 뿐입니다.
- 저장 형식은 **마크다운**입니다. 제목·목록·링크·코드블록 구조를 잃지 않으면서
  평문 대비 10% 남짓만 큽니다. `turndown` 없이 cheerio 로 직접 변환합니다.
- 광고(`ins.adsbygoogle`)·스크립트·관련글 행(`div.topic_row`)은 걷어냅니다.
  `javascript:` / `data:` 링크는 주소를 버리고 글자만 남깁니다.
- **예산제** — 한 실행에서 `HADA_CONTENT_MAX_PER_RUN`(기본 40)건만 받습니다.
  신규 항목을 먼저 채우고, 남으면 아직 본문이 없는 과거 항목을 메웁니다.
  그래서 처음 켤 때도 별도 백필 없이 며칠에 걸쳐 저절로 채워집니다.
- 요청 간 1.5초, 3회 실패한 항목은 포기합니다. **본문 단계는 목록 수집을
  실패시키지 않습니다** — 부가물이고, 다음 실행에서 다시 시도하면 됩니다.
- 본문 컨테이너를 못 찾으면 빈 문자열로 뭉개지 않고 `status = 'parse_failed'`
  로 남깁니다. 절반을 넘으면 실행 로그에 error 로 올립니다 — 마크업이 바뀐 것을
  조용히 넘기면 며칠치가 빈 채로 쌓입니다.

용량은 본문 평균 ~1.2천자(한글 UTF-8 3바이트) ≈ 4KB/행, 하루 35건이면 연 50MB
원시 · TOAST 압축 후 20~25MB 수준입니다. 20,000자 상한이 최악의 행을 묶습니다.

```bash
npm run sync:hada-content -- --url=https://news.hada.io/topic?id=33087   # 구조 진단 (DB 불필요)
npm run sync:hada-content -- --source=geeknews                           # 본문만 따로 채우기
npm run sync:hada-content -- --source=showcase --dry-run
```

`--url` 진단은 어떤 셀렉터가 걸렸는지, 마커를 어디서 찾았는지, 뽑아낸 본문이
무엇인지 그대로 보여 줍니다. 개발 환경에서 news.hada.io 에 닿지 않으면
GitHub Actions 의 **긱뉴스 상세 구조 진단** 워크플로를 dispatch 하면 같은 출력을
얻습니다. 마크업이 바뀌어 `parse_failed` 가 늘 때도 여기서 다시 실측합니다.

### 트렌드 브리핑 (LLM 사용)

| 출처 | 기본 수집 | 방법 | PK |
|---|:---:|---|---|
| GitHub Trending | ✅ | `?since=daily\|weekly\|monthly` 3회 스크레이핑 후 합집합 | `https://github.com/{owner}/{repo}` |
| Hacker News | ✅ | 공식 Firebase API + Algolia 로 상위 댓글 | `https://news.ycombinator.com/item?id=N` |
| arXiv | ✅ | 공식 Atom API (cs.AI/CL/IR/LG) · 429 면 `rss.arxiv.org` 공지 RSS 로 대체 | `https://arxiv.org/abs/{id}` |
| 긱뉴스 | — | 수집된 `geek_news` 재사용 (`--only=geeknews` 로만) | 토픽 URL |

긱뉴스는 **긱뉴스** 카테고리가 원문 그대로 담당하므로 기본 출처에서 빼 두었습니다.
같은 글이 두 카테고리에 겹쳐 실리지 않게 하려는 것입니다.

**출처 하나가 죽어도 실행은 계속됩니다.** 수집에 실패한 출처는 `sync_runs.logs` 에
남기고 나머지 출처로 기사를 만듭니다. 요청한 출처가 전부 실패했을 때만 실행이
실패합니다. arXiv API(`export.arxiv.org`)는 IP 단위로 요청량을 재는데 GitHub
Actions 러너는 IP 대역을 공유해서 첫 요청부터 429 가 오기도 합니다. 그래서
`Retry-After` 를 따르는 재시도 → `rss.arxiv.org` 공지 RSS 대체 수집 → 그래도 안
되면 arXiv 만 건너뛰기 순으로 물러납니다.

신규 URL 만 골라 컨텍스트(README / 상위 댓글 / 초록)를 모으고, 5건씩 묶어 LLM 에
구조화 JSON 으로 요청합니다. 1회 실행당 신규 상한 30건이며, 초과분은
`sync_runs.logs` 에 명시적으로 남깁니다.

**상한은 출처별로 번갈아 나눠 담습니다.** GitHub Trending 합집합만 수십 건이라
앞에서부터 자르면 30건이 GitHub 으로만 채워지고 HN·arXiv 가 매일 밀립니다.

```bash
npm run sync:trend                           # 기본 출처(github,hn,arxiv) 전부
npm run sync:trend -- --dry-run              # LLM 없이 수집 대상만
npm run sync:trend -- --limit=5
npm run sync:trend -- --provider=openai
npm run sync:trend -- --only=github,arxiv
```

정기 실행은 **트렌드 브리핑 동기화 (OpenAI)** 워크플로(07:10 KST)가 맡습니다.
Gemini 워크플로는 키를 등록한 뒤 수동으로 돌리는 용도입니다
([docs/GITHUB_ACTIONS_SETUP.md](docs/GITHUB_ACTIONS_SETUP.md)).

---

## 문서

- **[docs/SUPABASE_MANUAL_SETUP.md](docs/SUPABASE_MANUAL_SETUP.md) — 처음 셋업하는 경우 여기부터** (대시보드 단계별 절차, 약 10분)
- [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) — 표 · 뷰 · 권한 설계와 운영 쿼리
- [docs/VERCEL_DEPLOY.md](docs/VERCEL_DEPLOY.md) — Vercel 배포 절차 · 플랫폼 한도 · 공개 전 점검
- [docs/GITHUB_ACTIONS_SETUP.md](docs/GITHUB_ACTIONS_SETUP.md) — Secrets · 워크플로 · 제약
- [docs/SHOWCASE_QUERY.md](docs/SHOWCASE_QUERY.md) — 쇼케이스 데이터 (수집 · 중복 정리 · 뷰)
- [supabase/LIVE_ONLY.md](supabase/LIVE_ONLY.md) — 운영 DB 에만 있고 마이그레이션에는 없는 객체

---

## 알아 둘 것

**프록시** — `HTTP_PROXY` / `HTTPS_PROXY` 가 있으면 수집 스크립트가 자동으로
undici 디스패처를 설정합니다 (`src/lib/proxy.ts`). Node 의 내장 fetch 는
이 환경변수를 기본적으로 무시하기 때문에 필요한 처리입니다.

**User-Agent** — news.hada.io 는 UA 에 `bot` 이 들어가면 403 을 돌려줍니다
(robots.txt 는 `User-agent: *  Allow: /` 로 열려 있지만 WAF 단에서 막힘).
일반 브라우저 UA 를 쓰되 요청 간격을 넉넉히 두고, 저장하는 모든 항목에 원문 링크와
출처를 함께 남깁니다.

**누가 무엇을 읽는가** — 모든 테이블에 RLS 를 켜고 정책은 두지 않았습니다. 표에
직접 닿는 것은 수집 스크립트의 `service_role` 키뿐입니다. 웹과 앱은 같은 anon 키로
모바일 뷰 5개(`mobile_feed` · `mobile_showcase` · `mobile_trend_detail` ·
`mobile_hada_content` · `mobile_issue`)만 읽고, anon 에게 열린 것은 그 SELECT 뿐입니다
(`0018`). 숨긴 글을 빼는 규칙과 목록의 지표 문구는 뷰 정의 한 곳에 있습니다.

---

## 명령어

```bash
npm run dev            # 개발 서버
npm run build          # 프로덕션 빌드
npm run typecheck      # tsc --noEmit
npm run lint
npm run sync:geeknews
npm run sync:showcase
npm run sync:trend
```

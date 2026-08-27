# AI 뉴스레터

Samsung SDS AI Unit 사내 일간 뉴스레터. Next.js 16 (App Router) + Supabase.

claude.ai/design 프로젝트 `AI 뉴스레터.dc.html` 를 웹서비스와 관리자 페이지로
구현한 것입니다.

모바일 앱은 별도 저장소([`ai-news-letter-mobile`](https://github.com/swpark3179/ai-news-letter-mobile),
Flutter)에 있고, **로그인만 이 서버의 API 를 씁니다** — 사내 SSO 는 PC 트레이
모듈에 붙는 방식이라 모바일에서 쓸 수 없어 Google · Apple OAuth2 로 들어옵니다
([docs/MOBILE_OAUTH2.md](docs/MOBILE_OAUTH2.md)).

---

## 네 개의 카테고리

| 카테고리 | 출처 | 채우는 방법 |
|---|---|---|
| 긱뉴스 데일리 | news.hada.io | 자동 수집 — **LLM 미사용**, 제목·요약을 원문 그대로 |
| 트렌드 브리핑 | GitHub Trending · Hacker News · arXiv | 자동 수집 + LLM 이 한국어 기사 작성 |
| 위클리 리뷰 | 유닛원 4명이 매주 1건 | 관리자 화면에서 직접 작성 |
| 심층 분석 | 월 1회 정기 발표 | 관리자 화면 (사진 · 발표 자료 첨부) |

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

로그인 기본값은 목업입니다(`NEXT_PUBLIC_SSO_MODE=mock`). 실 모드(Knox 트레이
`getknoxsso` → EPID 추출 → 등록사용자 대조) 경로도 이어져 있고, `SecuBase`
복호화 규격 한 곳만 미확정입니다 — [docs/SSO_KNOX_PROTOCOL.md](docs/SSO_KNOX_PROTOCOL.md).

개발 서버에서는 `/` 로 바로 들어가면 로그인 화면을 거치지 않고 목업 사용자로
세션이 만들어집니다. 로그인 화면 자체를 보려면 `/login?force=1`, 실패 화면은
`/login?fail=SSO_TIMEOUT_30S` (`?fail=` 로 실패 5종을 모두 볼 수 있습니다).

목업 전용 우회 경로(무로그인 자동 세션 · 사번+비밀번호 폴백 · 게스트 열람)는
**운영 빌드에서 모드와 무관하게 닫힙니다.** 최종 방침은 「사내 SSO 를 통과하지
못하면 일반 사용을 제공하지 않는다」입니다.

---

## 화면

| 경로 | 내용 |
|---|---|
| `/login` | SSO 4단계 진행 · 실패 5종 (사번 로그인·게스트는 목업 모드에서만) |
| `/login/diag` | 로그인 진단 — 환경변수·트레이 핸드셰이크·디코딩 드라이런 ([docs/SSO_DEBUG.md](docs/SSO_DEBUG.md)) |
| `/` | 1면 — 머리기사 3단 조판, 출처 3열, 긱뉴스 사이드바, 심층 분석, 위클리 리뷰 |
| `/sections/[geek\|trend\|review\|deep]` | 카테고리 목록 (트렌드는 출처 필터) |
| `/articles/[id]` | 유닛원 기사 상세 (심층 분석은 토론 코멘트 포함) |
| `/articles/trend/[publicId]` | 트렌드 브리핑 상세 |
| `/meetings` | 모임 아카이브 · 발표 순번 |
| `/me` | 내 보관함 — 본인이 담아 둔 긱뉴스·트렌드 브리핑만 보인다 |
| `/admin` | 대시보드 + 수집 파이프라인 콘솔 |
| `/admin/compose` | 블록 에디터 + 실시간 지면 미리보기 |
| `/admin/scraps` | 보관 통계 — 많이 보관된 게시물 순위 |
| `/admin/uploads` | 분할 암호화 업로드 이력 |
| `/admin/members` | 유닛 멤버 · 로테이션 |

---

## 구조

```
src/
  app/
    (site)/            열람 화면 — 헤더 + 게스트 배너(목업 전용) 레이아웃
    admin/             관리자 (레이아웃에서 is_admin 재확인)
    api/               auth · me · comments · articles · scraps · uploads · admin/pipeline
    tokens.css         디자인 토큰 (claude.ai/design 원본을 그대로 이식)
  components/          화면별 컴포넌트 + 같은 폴더의 .module.css
  lib/
    auth/sso/          사내 SSO — 트레이 WebSocket · 응답 파싱 · 서버 디코딩
                       (★ SecuBase 복호화만 미확정 → decode-knox.ts)
    auth/*-identity.ts 모바일 OAuth2 (social · google · apple)
    auth/mobile-session.ts  앱 액세스/리프레시 토큰
    data/              읽기 쿼리 (content · ops · settings · scraps)
    llm/               Gemini · OpenAI 공통 인터페이스
    sync/              수집 파이프라인 (sources/ 아래에 출처별 어댑터)
    supabase/          service_role 클라이언트
  proxy.ts             경로별 접근 제어 (쿠키 · Bearer)
scripts/sync/          CLI 진입점 (tsx)
supabase/migrations/   스키마 SQL 12개
.github/workflows/     동기화 워크플로 3개
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

### 트렌드 브리핑 (LLM 사용)

| 출처 | 기본 수집 | 방법 | PK |
|---|:---:|---|---|
| GitHub Trending | ✅ | `?since=daily\|weekly\|monthly` 3회 스크레이핑 후 합집합 | `https://github.com/{owner}/{repo}` |
| Hacker News | ✅ | 공식 Firebase API + Algolia 로 상위 댓글 | `https://news.ycombinator.com/item?id=N` |
| arXiv | ✅ | 공식 Atom API (cs.AI/CL/IR/LG) | `https://arxiv.org/abs/{id}` |
| 긱뉴스 | — | 수집된 `geek_news` 재사용 (`--only=geeknews` 로만) | 토픽 URL |

긱뉴스는 **긱뉴스 데일리**가 원문 그대로 담당하므로 기본 출처에서 빼 두었습니다.
같은 글이 두 카테고리에 겹쳐 실리지 않게 하려는 것입니다.

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

## 보관함

로그인한 사용자가 긱뉴스·트렌드 브리핑 게시물을 나중에 다시 읽으려고 담아 두는
기능입니다 (`scraps` 테이블).

- **담기** — 1면·카테고리 목록·트렌드 브리핑 상세의 `보관` 버튼. 목표 상태를 그대로
  보내는 멱등 API(`POST /api/scraps`)라 두 번 눌러도 어긋나지 않습니다.
- **내 보관함** — 헤더의 `보관함` 버튼 → `/me`. 조회가 항상 본인 `member_id` 로만
  걸려서 다른 사람이 무엇을 담았는지는 나오지 않습니다.
- **보관 통계** — `/admin/scraps` 에서 관리자만 봅니다. 어떤 게시물이 많이 담겼는지
  (건수·최근 보관 시각)만 집계하고 누가 담았는지는 표시하지 않습니다.

---

## 문서

- **[docs/SUPABASE_MANUAL_SETUP.md](docs/SUPABASE_MANUAL_SETUP.md) — 처음 셋업하는 경우 여기부터** (대시보드 단계별 절차, 약 15분)
- [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) — 테이블 구조 · RLS 설계 배경 · 운영 쿼리
- [docs/VERCEL_DEPLOY.md](docs/VERCEL_DEPLOY.md) — Vercel 배포 절차 · 플랫폼 한도 · 공개 전 점검
- [docs/GITHUB_ACTIONS_SETUP.md](docs/GITHUB_ACTIONS_SETUP.md) — Secrets · 워크플로 · 제약
- [docs/SSO_INTEGRATION.md](docs/SSO_INTEGRATION.md) — 사내 SSO 실구현 인계
- [docs/SSO_KNOX_PROTOCOL.md](docs/SSO_KNOX_PROTOCOL.md) — Knox 트레이 프로토콜 · 미확정 규격 질문 목록
- **[docs/SSO_DEBUG.md](docs/SSO_DEBUG.md) — 로그인이 안 될 때** (`/login/diag` 4단계 · 「로직 문제인가 변수 로드 문제인가」)
- [docs/MOBILE_OAUTH2.md](docs/MOBILE_OAUTH2.md) — 모바일 앱 OAuth2 로그인 (Google · Apple)

---

## 알아 둘 것

**사내 프록시** — `HTTP_PROXY` / `HTTPS_PROXY` 가 있으면 수집 스크립트가 자동으로
undici 디스패처를 설정합니다 (`src/lib/sync/proxy.ts`). Node 의 내장 fetch 는
이 환경변수를 기본적으로 무시하기 때문에 필요한 처리입니다.

**User-Agent** — news.hada.io 는 UA 에 `bot` 이 들어가면 403 을 돌려줍니다
(robots.txt 는 `User-agent: *  Allow: /` 로 열려 있지만 WAF 단에서 막힘).
일반 브라우저 UA 를 쓰되 요청 간격을 넉넉히 두고, 저장하는 모든 항목에 원문 링크와
출처를 함께 남깁니다.

**RLS** — 모든 테이블에 RLS 를 켜고 정책은 두지 않았습니다. 브라우저에 Supabase
키를 내려보내지 않고 서버가 `service_role` 로만 접근합니다. 자세한 배경은
Supabase 문서를 참고하세요.

---

## 명령어

```bash
npm run dev            # 개발 서버
npm run build          # 프로덕션 빌드
npm run typecheck      # tsc --noEmit
npm run lint
npm run sync:geeknews
npm run sync:trend
```

# Vercel 배포 가이드

이 앱을 Vercel 프로덕션으로 올리는 절차입니다. 로그인 · 관리자 기능이 없는
읽기 전용 사이트라 필요한 환경변수는 둘뿐입니다.

> 이 문서는 **Supabase 셋업이 끝난 상태**를 전제로 합니다.
> 아직이라면 [SUPABASE_MANUAL_SETUP.md](SUPABASE_MANUAL_SETUP.md) 를 먼저 하세요.

---

## 0. 무엇을 어디에 올리는지 먼저

```
   브라우저 ──── HTTPS ────▶  Vercel  (Next.js 16 · 화면만)
                                 │
                                 │ anon 키로 mobile_* 뷰만 읽는다 (서버 컴포넌트)
                                 ▼
   모바일 앱 ── anon 키 ──▶  Supabase  (Postgres — 웹 · 앱 모두 mobile_* 뷰 5개만)
                                 ▲
                                 │ 매일 07:00 · 07:10 · 07:20 KST
                          GitHub Actions  (긱뉴스 · 트렌드 · 쇼케이스 수집 + LLM 기사 작성)
```

| 역할 | 담당 | 비고 |
|---|---|---|
| 화면 렌더링 | **Vercel** | API 라우트도, 미들웨어(proxy)도 없습니다 |
| 데이터 | **Supabase** | 브라우저에 Supabase 키를 내려보내지 않습니다 |
| 정기 수집 | **GitHub Actions** | Vercel 이 아닙니다 — 아래 이유 참고 |

**수집을 Vercel 에 두지 않는 이유** — 트렌드 브리핑 수집은 LLM 호출 간격 때문에
수 분에서 수십 분이 걸립니다. Vercel 함수는 300초(Hobby) / 800초(Pro)에서 잘리지만
GitHub Actions 러너는 45분까지 돕니다 → [GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md)

---

## 1. 배포 전 로컬 점검

프로덕션 빌드가 로컬에서 깨지면 Vercel 에서도 똑같이 깨집니다.

```bash
npm ci
npm run lint
npm run typecheck
npm run build
```

정상이면 마지막에 라우트 표가 나옵니다.

```
Route (app)
┌ ƒ /
├ ○ /_not-found
├ ƒ /articles/geek/[...ref]
├ ƒ /articles/show/[...ref]
├ ƒ /articles/trend/[publicId]
├ ƒ /search
└ ƒ /sections/[section]
```

`/_not-found` 만 `○ (Static)` 이고 나머지는 `ƒ (Dynamic)` 입니다. 모든 페이지가
`dynamic = "force-dynamic"` 이라 **빌드 시점에 DB 를 읽지 않습니다.** 그래서
Supabase 키가 없어도 빌드는 통과합니다 (대신 화면에 셋업 안내가 뜹니다).

> **사내 프록시 환경에서 빌드가 멈추면** — `src/app/fonts.ts` 의 `next/font/google` 이
> 빌드 중 Google Fonts 를 내려받습니다. `HTTPS_PROXY` 를 설정한 셸에서 빌드하세요.
> Vercel 빌드 환경은 외부 네트워크가 열려 있어 이 문제가 없습니다.

---

## 2. 환경변수

| 이름 | 값 | 빠뜨리면 |
|---|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` — Supabase → Project Settings → API 의 **Project URL** | 셋업 안내 화면만 뜸 |
| `SUPABASE_ANON_KEY` | 같은 화면의 **anon** 키 (publishable 키도 됩니다). 모바일 앱과 같은 값 | 같음 |

이것이 전부입니다. **`service_role` 키는 Vercel 에 넣지 않습니다** — 웹은 anon 키로
모바일 뷰만 읽고, 표에 쓰는 것은 GitHub Actions 의 수집기뿐입니다. LLM 키와 수집
설정도 GitHub Actions 의 Secrets 에만 둡니다.

넣을 때 주의할 것:

1. **Production 과 Preview 둘 다** 넣어도 됩니다. anon 키로는 공개 뷰를 읽는 것밖에
   할 수 없어서, PR 프리뷰가 실제 데이터로 그려져도 운영 DB 에 아무 영향이 없습니다.
2. `SUPABASE_URL` 에는 Project URL 만 넣으세요. 대시보드에 같이 노출되는
   `https://.../rest/v1/` 를 복사하면 경로가 두 번 붙습니다 (코드가 걷어내지만
   처음부터 맞게 넣는 편이 낫습니다).
3. anon 키는 공개 키입니다(앱 바이너리에도 들어 있습니다). 그래도 웹은 서버
   컴포넌트에서만 읽고 `server-only` 로 묶어 두어 브라우저 번들에는 들어가지 않습니다.
4. **`NODE_ENV` 는 넣지 마세요.** Vercel 과 Next 가 빌드 · 실행 단계마다 알아서
   정합니다. 직접 넣으면 개발용 동작이 섞이거나 빌드 경고가 납니다.

### 예전 배포에서 지울 것

로그인을 걷어낸 뒤로 아래 값은 아무도 읽지 않습니다. 남아 있다면 지우세요.

`SESSION_SECRET` · `NEXT_PUBLIC_SSO_MODE` · `NEXT_PUBLIC_SSO_TRAY_WS_URL` ·
`NEXT_PUBLIC_SSO_TRAY_APP_CODE` · `SSO_DECODE_KEY` · `SSO_ALLOW_AUTO_CREATE` ·
`SSO_ALLOW_UNVERIFIED_PAYLOAD` · `SSO_DEBUG_TOKEN` · `GOOGLE_*` ·
`ALLOWED_HOSTED_DOMAINS` · `APPLE_*` · `SUPABASE_STORAGE_BUCKET` · `NODE_ENV` ·
`SUPABASE_SERVICE_ROLE_KEY` (웹이 anon 키로 바뀐 배포가 올라간 뒤에)
(LLM · 수집 관련 값도 Vercel 에서는 쓰지 않습니다 — 관리자 화면의 수동 실행 버튼이
없어졌습니다.)

---

## 3. Vercel 프로젝트 만들기

1. https://vercel.com/new → **Import Git Repository** → `ai-news-letter` 선택
2. Framework Preset 은 **Next.js** 로 자동 감지됩니다. Build · Install · Output 은
   비워 둡니다 (`package-lock.json` 이 있어 npm 을 씁니다). Node.js 는 기본값(24.x).
3. **Environment Variables** 에 2절의 두 값을 넣습니다.
4. **Deploy** → 2~4분 뒤 `https://ai-news-letter-xxxx.vercel.app` 주소가 나옵니다.

CLI 로 하려면:

```bash
npm i -g vercel
vercel login
vercel link
vercel env add SUPABASE_URL production
vercel env add SUPABASE_ANON_KEY production
vercel --prod
```

---

## 4. 배포 직후 설정

| 설정 | 위치 | 권장값 | 이유 |
|---|---|---|---|
| **Function Region** | Settings → Functions | 독자와 Supabase 가까이 | 운영은 **Seoul (icn1)** 입니다 — 독자가 한국에 있고, Supabase(`ap-northeast-1`, 도쿄)와도 가깝습니다. 기본값 `iad1`(워싱턴)이면 매 쿼리가 태평양을 왕복합니다 |
| **Deployment Protection** | Settings → Deployment Protection | 5절 참고 | 누가 사이트를 볼 수 있는지 |

리전을 바꾼 뒤에는 **재배포**해야 적용됩니다.

---

## 5. 누가 볼 수 있는가

앱에는 로그인이 없습니다. 접근을 막는 것은 Vercel 의 **Deployment Protection**
하나뿐이고, `src/app/layout.tsx` 가 `robots: noindex` 를 보내 검색엔진에는 올라가지
않습니다.

| 설정 | 결과 |
|---|---|
| Vercel Authentication — `All Deployments` / `All Except Custom Domains` | `*.vercel.app` 주소는 Vercel 팀 멤버만 볼 수 있습니다 |
| 위 설정 + 커스텀 도메인 연결 (`All Except Custom Domains`) | 커스텀 도메인으로는 누구나, `*.vercel.app` 은 팀 멤버만 |
| Standard Protection 또는 끔 | 주소를 아는 누구나 볼 수 있습니다 |

공개해도 되는 내용인지는 이렇게 판단합니다 — 화면에 나오는 것은 긱뉴스 · GitHub ·
Hacker News · arXiv 의 공개 글과 그것을 요약한 기사뿐이고, **모바일 앱이 같은 내용을
로그인 없이 이미 공개**하고 있습니다.

---

## 6. 스모크 테스트

| # | 동작 | 기대 결과 |
|---|---|---|
| 1 | `/` | 1면 — 머리기사 · GitHub/HN/arXiv 3열 · 긱뉴스/쇼케이스 사이드바, 그날 것 전부 |
| 2 | `/sections/geek` | 긱뉴스 최근 7일, 날짜마다 구분 · 「더 이전 7일」로 넘어감 |
| 3 | `/sections/hn?q=agent` | 그 카테고리 안 검색 |
| 4 | `/search?q=claude` | 다섯 카테고리 검색 결과 |
| 5 | 긱뉴스 글 하나 열기 | `/articles/geek/<id>` — 본문이 이 사이트 안에서 보임 |
| 6 | 트렌드 기사 하나 열기 | `/articles/trend/<id>` 상세 |
| 7 | `/sections/trend?filter=hn` | `/sections/hn` 으로 308 (예전 주소) |
| 8 | `/login` · `/admin` · `/me` | 404 (지운 화면) |

> **화면이 텅 비어 있으면** 데이터가 없는 것입니다. GitHub Actions 워크플로를
> 수동 실행하거나, 로컬에서 `npm run sync:geeknews` 를 한 번 돌리세요.
> 같은 Supabase 를 보므로 로컬에서 넣은 데이터가 바로 배포본에 보입니다.

---

## 7. 수집 파이프라인 연결

Vercel 과 GitHub Actions 는 **환경변수를 공유하지 않습니다.**

1. GitHub 리포 → Settings → Secrets → `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `OPENAI_API_KEY` 등록 → [GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md)
2. Actions 탭에서 **긱뉴스 동기화** 를 `dry_run: true` 로 1회 → 로그 확인
3. `dry_run` 없이 1회 → 실제 적재
4. 배포된 사이트를 새로고침 → 1면에 기사가 채워짐
5. **트렌드 브리핑 동기화 (OpenAI)** 를 `limit: 5` 로 1회 → 품질 확인
6. 이후 매일 07:00 / 07:10 / 07:20 KST 에 자동 실행

> **Supabase 무료 플랜은 일정 기간 무활동 시 프로젝트를 일시정지합니다.**
> 매일 도는 수집이 있으면 정지되지 않습니다.

---

## 8. 운영

| 하고 싶은 일 | 방법 |
|---|---|
| 코드 배포 | `git push` → 자동 배포 (기본 브랜치 = 프로덕션) |
| 환경변수 변경 반영 | 값 저장 후 **Deployments → ⋯ → Redeploy**. 저장만으로는 반영되지 않습니다 |
| 이전 버전으로 되돌리기 | Deployments → 이전 배포 → **Instant Rollback** |
| 런타임 로그 보기 | 프로젝트 → **Logs** |
| 수집 이력 확인 | Supabase `sync_runs` 테이블 → [SUPABASE_SETUP.md](SUPABASE_SETUP.md) 8절 쿼리 |
| PR 프리뷰 | PR 마다 프리뷰 URL 이 생깁니다 |

커스텀 도메인은 Settings → **Domains** → Add 후, Vercel 이 안내하는 `CNAME`
(또는 A) 레코드를 DNS 에 등록하면 됩니다. 인증서는 자동 발급됩니다.

---

## 9. 문제 해결

| 증상 | 원인 · 조치 |
|---|---|
| 셋업 안내 화면만 뜬다 (`SUPABASE_URL 가 설정되지 않았습니다`) | Production 환경에 Supabase 변수가 없거나, 넣고 재배포하지 않음 |
| `Invalid path specified in request URL` | `SUPABASE_URL` 에 `/rest/v1` 이 붙은 주소를 넣음 → Project URL 로 교체 |
| 빌드 실패 — 폰트 다운로드 오류 | 대개 일시적 네트워크 오류. 캐시 없이 Redeploy 재시도 |
| 빌드 실패 — Type error | 로컬 `npm run typecheck` 로 재현해 수정 |
| 배포는 됐는데 화면이 텅 비어 있다 | 데이터가 없는 것. 7절 수집 실행 |
| 사이트를 열면 Vercel 로그인 화면이 뜬다 | Deployment Protection 이 켜져 있음 (5절) |

---

## 참고 문서

- [Vercel Functions 한도](https://vercel.com/docs/functions/limitations)
- [Deployment Protection](https://vercel.com/docs/deployment-protection)
- [지원 Node.js 버전](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)

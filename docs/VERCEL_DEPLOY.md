# Vercel 배포 가이드

로컬에서 돌던 이 앱을 Vercel 프로덕션으로 올리는 전 과정입니다.
위에서부터 순서대로 따라가면 됩니다. 처음이면 **25~40분** 정도 걸립니다.

> 이 문서는 **Supabase 셋업이 끝난 상태**를 전제로 합니다.
> 아직이라면 [SUPABASE_MANUAL_SETUP.md](SUPABASE_MANUAL_SETUP.md) 를 먼저 하세요.

---

## 0. 무엇을 어디에 올리는지 먼저

```
   브라우저 ──── HTTPS ────▶  Vercel  (Next.js 16 · 화면 + API + 접근 제어)
                                 │
                                 │ service_role 키로 서버에서만 접근
                                 ▼
                            Supabase  (Postgres + Storage)
                                 ▲
                                 │ 매일 07:00 / 07:10 KST
                          GitHub Actions  (긱뉴스 · 트렌드 수집 + LLM 기사 작성)
```

| 역할 | 담당 | 비고 |
|---|---|---|
| 화면 렌더링 · API 라우트 · 로그인 제어 | **Vercel** | `src/proxy.ts` 가 Edge 에서 모든 경로를 검사 |
| 데이터 · 첨부파일 | **Supabase** | 브라우저에 Supabase 키를 내려보내지 않습니다 |
| 정기 수집 (긱뉴스 · 트렌드) | **GitHub Actions** | Vercel 이 아닙니다 — 아래 이유 참고 |
| 즉시 수집 (관리자 버튼) | Vercel 함수 | 확인용. 시간 한도가 있어 대량 수집엔 부적합 |

**정기 수집을 Vercel 에 두지 않는 이유** — 트렌드 브리핑 전체 수집은 LLM 호출 간격
때문에 수 분에서 수십 분이 걸립니다. Vercel 함수는 최대 300초(Hobby) / 800초(Pro)에서
잘리지만, GitHub Actions 러너는 45분까지 돕니다. 이미 워크플로 3개가 들어 있으니
그대로 쓰면 됩니다 → [GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md)

### 시작 전 체크리스트

| 항목 | 확인 |
|---|---|
| Supabase 프로젝트 + 마이그레이션 8개 적용 | `supabase/VERIFY.sql` 통과 |
| Storage 버킷 `newsletter` 생성 | Supabase → Storage |
| `SUPABASE_URL` · `service_role` 키 확보 | Project Settings → API |
| 로컬에서 `npm run dev` 가 뜨고 화면이 보임 | http://localhost:3000 |
| GitHub 계정 (private 리포 생성 가능) | |
| Vercel 계정 | https://vercel.com/signup — GitHub 로 가입하면 편합니다 |

---

## 1. 배포 전 로컬 점검 (5분)

프로덕션 빌드가 로컬에서 깨지면 Vercel 에서도 똑같이 깨집니다. 먼저 확인하세요.

```bash
npm ci
npm run typecheck
npm run build
```

정상이면 마지막에 라우트 표가 나옵니다 (2026-08 실측: 빌드 약 20초, 종료 코드 0).

```
▲ Next.js 16.3.1 (Turbopack)
✓ Compiled successfully

Route (app)
┌ ƒ /                            ├ ƒ /admin              ├ ƒ /api/uploads/chunk
├ ○ /_not-found                  ├ ƒ /admin/compose      ├ ƒ /articles/[id]
├ ƒ /api/admin/pipeline/run      ├ ƒ /admin/members      ├ ƒ /login
...
ƒ Proxy (Middleware)
```

확인 포인트 두 가지:

- `/_not-found` 만 `○ (Static)` 이고 나머지는 전부 `ƒ (Dynamic)` 입니다.
  모든 페이지가 `dynamic = "force-dynamic"` 이라 **빌드 시점에 DB 를 읽지 않습니다.**
  그래서 Supabase 키가 없어도 빌드는 통과합니다 (대신 화면에 셋업 안내가 뜹니다).
- `ƒ Proxy (Middleware)` 가 목록에 있어야 합니다. 이게 로그인 검사입니다.

> **사내 프록시 환경에서 빌드가 멈추면** — `src/app/fonts.ts` 의 `next/font/google` 이
> 빌드 중 Google Fonts 를 내려받습니다. `HTTPS_PROXY` 를 설정한 셸에서 빌드하세요.
> Vercel 빌드 환경은 외부 네트워크가 열려 있어 이 문제가 없습니다.

---

## 2. GitHub 리포지터리 준비 (5분)

지금 이 프로젝트는 remote 가 없고 브랜치가 `master` 입니다. 먼저 올립니다.

```bash
cd C:/Users/s-w.park/Desktop/ai-news-letter

# 1) 커밋되지 않은 변경 전부 커밋
git add -A
git commit -m "AI 뉴스레터 구현"

# 2) (선택) 브랜치 이름을 main 으로 — 다른 문서들이 main 기준입니다
git branch -M master main

# 3) private 리포로 만들고 푸시
gh repo create ai-news-letter --private --source=. --remote=origin --push
```

`gh` 가 없으면 github.com 에서 빈 private 리포를 만든 뒤:

```bash
git remote add origin https://github.com/<계정>/ai-news-letter.git
git push -u origin main
```

**비밀값이 안 올라갔는지 확인하세요.**

```bash
git ls-files | grep -i env
# .env.local.example
# src/lib/env.ts        ← 이 두 줄만 나오면 정상 (.env.local 은 .gitignore 대상)
```

> 브랜치를 `master` 로 남겨 둬도 됩니다. Vercel 은 리포의 **기본 브랜치**를
> 프로덕션 브랜치로 잡습니다. 다만 `docs/GITHUB_ACTIONS_SETUP.md` 예시가 `main`
> 기준이라 이름을 맞추는 편이 헷갈리지 않습니다.

---

## 3. 환경변수 값을 먼저 만들어 둔다 (5분)

Vercel 프로젝트를 만드는 화면에서 환경변수를 같이 넣는 것이 가장 편합니다.
그래서 값을 먼저 준비합니다.

특히 `SESSION_SECRET` 은 **첫 배포 전에 반드시** 넣어야 합니다.
`src/lib/env.ts` 가 프로덕션에서 이 값이 없으면 예외를 던지고, 그 예외가
`src/proxy.ts` 에서 터지므로 **모든 페이지가 500** 이 됩니다.

### SESSION_SECRET 생성

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

로컬 `.env.local` 값을 재사용하지 말고 **운영용으로 새로 만드세요.**

### 필수 3개

| 이름 | 값 | 빠뜨리면 |
|---|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` — Supabase → Project Settings → API 의 **Project URL** | 파란 셋업 안내 화면만 뜸 |
| `SUPABASE_SERVICE_ROLE_KEY` | 같은 화면의 **service_role** 키 (`anon` 아님) | 같음 |
| `SESSION_SECRET` | 위에서 만든 32바이트 문자열 | **전 페이지 500** |

> `SUPABASE_URL` 에는 Project URL 만 넣으세요. 대시보드에 같이 노출되는
> `https://.../rest/v1/` 를 복사하면 경로가 두 번 붙습니다 (코드가 걷어내지만
> 처음부터 맞게 넣는 편이 낫습니다).

### 권장 · 선택

| 이름 | 기본값 | 언제 필요한가 |
|---|---|---|
| `SUPABASE_STORAGE_BUCKET` | `newsletter` | 버킷 이름을 다르게 만들었을 때 |
| `NEXT_PUBLIC_SSO_MODE` | `mock` | 사내 SSO 실연동 후 `real` 로 (→ 9절) |
| `NEXT_PUBLIC_SSO_TRAY_WS_URL` | — | `real` 모드에서만 |
| `SSO_DECODE_KEY` | — | `real` 모드에서만 |
| `LLM_PROVIDER` | `gemini` | 관리자 화면에서 **트렌드** 수집을 돌릴 때 |
| `GEMINI_API_KEY` | — | 같음 (https://aistudio.google.com/apikey) |
| `GEMINI_MODEL` | `gemini-2.5-flash` | 모델 교체 시 |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | — / `gpt-5-mini` | `LLM_PROVIDER=openai` 로 쓸 때 |
| `LLM_MIN_CALL_INTERVAL_MS` | gemini 7000 / openai 500 | 429 가 나면 올림 |
| `TREND_MAX_NEW` | `30` | 관리자 버튼 1회당 신규 상한. Vercel 에서는 **5~10 권장** (→ 7.1) |
| `HN_MIN_SCORE` | `150` | 선별 기준 점수 |
| `GEEK_LOOKBACK_DAYS` / `GEEK_MAX_PAGES` | `3` / `8` | 긱뉴스 수집 범위 |
| `GITHUB_TOKEN` | — | GitHub API 레이트리밋 완화 (public repo 읽기 권한이면 충분) |

LLM 키는 **관리자 화면의 수동 실행 버튼을 쓸 때만** 필요합니다. 정기 수집은
GitHub Actions 가 자기 Secrets 로 돌리므로 Vercel 에 없어도 됩니다.

### 넣을 때 주의할 것 4가지

1. **환경(Environment) 선택** — 처음에는 **Production 에만** 넣으세요.
   Preview 에도 같은 Supabase 키를 넣으면 PR 프리뷰 배포가 운영 DB 에 씁니다.
2. **`NEXT_PUBLIC_*` 은 빌드 시점에 번들에 박힙니다.** 값을 바꾸면 재배포해야 반영됩니다.
3. **`SUPABASE_URL` 은 빌드 때도 읽힙니다.** `next.config.ts` 가 이 값으로
   `next/image` 허용 호스트를 만듭니다. 나중에 추가했다면 **반드시 재배포**해야
   Supabase Storage 사진이 뜹니다.
4. `SUPABASE_SERVICE_ROLE_KEY` 는 **Sensitive** 로 저장하세요 (저장 후에는 값을 다시
   볼 수 없습니다 — 대신 Supabase 대시보드에서 언제든 다시 확인할 수 있습니다).

---

## 4. Vercel 프로젝트 만들기 (5분)

### 대시보드로 (권장)

1. https://vercel.com/new 접속
2. **Import Git Repository** → 방금 만든 `ai-news-letter` 선택
   - 리포가 안 보이면 **Adjust GitHub App Permissions** 로 접근 권한을 주세요
3. 설정은 대부분 자동 감지됩니다. 확인만 하세요.

| 항목 | 값 |
|---|---|
| Framework Preset | **Next.js** (자동) |
| Root Directory | `./` |
| Build Command | 비워 둠 (= `next build`) |
| Install Command | 비워 둠 (`package-lock.json` 이 있어 npm 사용) |
| Output Directory | 비워 둠 |
| Node.js Version | 기본값 (현재 **24.x**). 로컬도 24 라 그대로 두면 됩니다 |

4. **Environment Variables** 를 펼쳐 3절의 값을 넣습니다.
   - 입력창에 `KEY=VALUE` 여러 줄을 **한 번에 붙여넣을 수 있습니다.**
     `.env.local` 내용을 붙여넣고 `SESSION_SECRET` 만 운영용 새 값으로 바꾸는 것이 빠릅니다.
5. **Deploy** 클릭 → 2~4분 기다립니다.
6. 성공하면 `https://ai-news-letter-xxxx.vercel.app` 주소가 나옵니다.

### CLI 로 (선택)

```bash
npm i -g vercel
vercel login
vercel link                       # 기존 프로젝트에 연결 (또는 새로 생성)

vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add SESSION_SECRET production

vercel --prod                     # 프로덕션 배포
vercel env pull .env.local        # 반대로: Vercel 값을 로컬로 내려받기
```

---

## 5. 배포 직후 프로젝트 설정 3가지

Settings 에서 확인해 두면 나중에 헤맬 일이 줄어듭니다.

| 설정 | 위치 | 권장값 | 이유 |
|---|---|---|---|
| **Function Region** | Settings → Functions | **Seoul (icn1)** | Supabase 를 서울(ap-northeast-2)에 만들었다면 함수↔DB 왕복 지연이 크게 줄어듭니다. 기본값은 `iad1`(워싱턴)이라 매 쿼리가 태평양을 왕복합니다. Hobby 는 리전 1개만 지정 가능 |
| **Fluid compute** | Settings → Functions | **켜짐** (신규 프로젝트 기본) | 관리자 수집 버튼이 `after()` 로 응답 후에도 계속 도는 구조라, 켜져 있어야 함수 최대 실행 시간까지 백그라운드 작업이 이어집니다 |
| **Deployment Protection** | Settings → Deployment Protection | 8절 참고 | 프로덕션 URL 을 누구에게 열지 |

리전을 바꾼 뒤에는 **재배포**해야 적용됩니다.

---

## 6. 스모크 테스트 (5분)

배포된 URL 로 순서대로 확인하세요.

| # | 동작 | 기대 결과 |
|---|---|---|
| 1 | `/` 접속 (로그아웃 상태) | `/login` 으로 리다이렉트 |
| 2 | `/login` 에서 2~3초 대기 | 4단계 진행 후 자동 로그인 → 1면 (목업 SSO) |
| 3 | 헤더에 이름 표시 | `박세원` — 목업이 발급하는 사용자 (`21084213`, 관리자) |
| 4 | `/sections/geek` | 긱뉴스 목록 |
| 5 | 기사 하나 열기 | 상세 화면 · 코멘트 영역 |
| 6 | `/admin` | 대시보드 + 파이프라인 콘솔 (관리자만) |
| 7 | `/admin` 에서 긱뉴스 수집 실행 | 수 초~1분 내 완료. `sync_runs` 에 기록 |
| 8 | 로그아웃 → `/login` → **게스트로 둘러보기** | 1면 열람 가능, `/admin` 은 `/login` 으로 튕김 |
| 9 | 사번 로그인 `21084213` + 아무 비밀번호 | 관리자로 로그인 (목업은 비밀번호를 검증하지 않습니다) |

강제 실패 시나리오도 배포본에서 그대로 확인할 수 있습니다.

```
/login?fail=SSO_TRAY_NOT_RUNNING
/login?fail=SSO_TRAY_NOT_INSTALLED
/login?fail=SSO_TIMEOUT_30S
```

> **화면이 텅 비어 있으면** 데이터가 없는 것입니다. GitHub Actions 워크플로를
> 수동 실행하거나, 로컬에서 `npm run sync:geeknews` 를 한 번 돌리세요.
> 같은 Supabase 를 보므로 로컬에서 넣은 데이터가 바로 배포본에 보입니다.

---

## 7. 플랫폼 한도 — 이 앱이 실제로 부딪히는 4가지

### 7.1 함수 최대 실행 시간

Fluid compute 기준 (2026-08 시점, Vercel 공식 문서):

| 플랜 | 기본 | 최대 | 확장(베타) |
|---|---|---|---|
| Hobby | 300초 | **300초** | — |
| Pro | 300초 | 800초 | 1800초 |
| Enterprise | 300초 | 800초 | 1800초 |

- `src/app/api/admin/pipeline/run/route.ts` 는 `maxDuration = 300` 입니다.
  **Hobby 에서도 그대로 동작합니다.**
- 다만 트렌드 전체 수집(신규 30건, Gemini 무료 티어 7초 간격)은 **3~5분** 이라
  300초를 넘길 수 있습니다. 관리자 버튼으로는 `limit` 을 **5~10** 으로 줄여 쓰고,
  전체 수집은 GitHub Actions 에 맡기세요.
- 한도를 넘으면 `504 FUNCTION_INVOCATION_TIMEOUT` 이고, `sync_runs` 행이
  `running` 으로 남습니다. 같은 종류는 **15분 뒤부터** 다시 실행할 수 있습니다
  (중복 실행 방지 로직).
- Pro 라면 위 파일의 `maxDuration` 을 `800` 까지 올릴 수 있습니다.

### 7.2 요청 본문 4.5MB

Vercel 함수는 요청/응답 본문이 **4.5MB** 를 넘으면
`413 FUNCTION_PAYLOAD_TOO_LARGE` 를 돌려줍니다.

- 분할 업로드 조각 기본값은 `DEFAULT_CHUNK_BYTES = 4MB` (`src/lib/domain.ts`) 이고
  암호화 오버헤드가 28바이트라 **4.19MB → 통과합니다.**
- `src/app/api/uploads/init/route.ts` 는 조각 크기를 9MB 까지 허용하지만 이는
  사내 게이트웨이(10MB) 기준입니다. **Vercel 에서는 4MB 를 유지하세요.**
  클라이언트에서 `chunkBytes` 를 키우면 413 이 납니다.

### 7.3 함수 메모리

Hobby 2GB / 1 vCPU, Pro 최대 4GB / 2 vCPU.

`src/app/api/uploads/complete/route.ts` 는 조각을 **모두 메모리에 받아** 이어
붙입니다. 발표 자료(수십 MB)는 문제없지만 수백 MB 파일은 실패할 수 있습니다.
그런 파일을 다뤄야 하면 Supabase Storage 의 resumable upload 로 바꾸세요
(해당 파일 주석에도 같은 내용이 있습니다).

### 7.4 Vercel Cron (쓴다면)

| 플랜 | 최소 간격 | 시각 정확도 |
|---|---|---|
| Hobby | **하루 1회** | 시간 단위 (±59분) |
| Pro | 1분 | 분 단위 |

Hobby 에서 `0 * * * *` 처럼 더 자주 도는 표현식은 **배포 자체가 실패합니다.**
게다가 7.1 의 시간 한도가 그대로 적용되므로 트렌드 수집에는 부적합합니다.
정기 수집은 GitHub Actions 로 두는 것을 권합니다 (그래도 하고 싶다면 부록 A).

---

## 8. ⚠️ 공개 URL 로 열기 전에 반드시 읽을 것

앱 자체는 `src/proxy.ts` 가 모든 경로에서 로그인을 요구하고,
`src/app/layout.tsx` 가 `robots: noindex` 를 보냅니다.
**그런데 지금 로그인은 목업입니다.**

- `/login` 에 들어가면 **2.4초 뒤 자동으로 관리자(`21084213` 박세원)로 로그인됩니다**
  (`src/lib/auth/sso/client.mock.ts` 의 `MOCK_USER`).
- 사번 로그인은 **비밀번호를 검증하지 않습니다.** 처음 보는 사번은 구독자로 자동 생성됩니다.
- 게스트 열람도 열려 있습니다.

즉 **URL 을 아는 사람은 누구나 관리자로 들어올 수 있습니다.** 사내 실명·발표
자료가 들어가는 서비스이므로 아래 중 하나를 반드시 적용하세요.

| 방법 | 필요 플랜 | 효과 |
|---|---|---|
| Deployment Protection → **All Deployments** + Vercel Authentication | **Pro 이상** | Vercel 팀 멤버만 접근. 가장 간단 |
| Trusted IPs (사내 IP 만 허용) | Enterprise | 사내망에서만 접근 |
| 사내 SSO 실연동 완료 후 공개 | — | 정식 해법 → [SSO_INTEGRATION.md](SSO_INTEGRATION.md) |
| URL 을 공유하지 않고 본인 검증용으로만 사용 | Hobby | 임시 방편 |

> **Hobby 플랜의 한계** — Hobby 는 Standard Protection(프리뷰·생성 URL 보호)만
> 지원하고 **프로덕션 도메인은 보호되지 않습니다.** 프로덕션까지 잠그려면
> Pro 이상이 필요합니다.

그 밖에:

- `SESSION_SECRET` 을 바꾸면 발급된 모든 세션이 즉시 무효화됩니다(전원 로그아웃).
  키가 유출됐을 때의 대응책입니다.
- `service_role` 키는 `server-only` 로 보호되어 브라우저 번들에 들어가지 않습니다.
  그래도 Vercel 에서는 Sensitive 로 저장하세요.
- 실연동 전 반드시 채워야 하는 곳: `src/lib/auth/sso/decode.ts` 의 서명 검증·만료
  확인. 빠뜨리면 누구든 임의의 사번으로 로그인할 수 있습니다 (파일 주석 참고).

---

## 9. SSO — 배포하면 달라지는 것

`NEXT_PUBLIC_SSO_MODE=mock` 이면 배포 후에도 지금처럼 동작합니다.
`real` 로 바꿀 때 **HTTPS 환경 특유의 문제**가 세 가지 있습니다.

1. **`ws://` 는 차단됩니다.** HTTPS 페이지에서 평문 WebSocket 은 브라우저가
   mixed content 로 막습니다. 트레이 모듈이 `wss://` 를 제공해야 합니다.
2. **`wss://127.0.0.1:포트` 는 인증서 문제가 남습니다.** 자체 서명 인증서면
   연결이 실패합니다. 사내 CA 가 서명한 인증서를 트레이 모듈이 써야 합니다.
3. **`real` 모드에서 사번 폴백 로그인은 501 을 반환합니다**
   (`src/app/api/auth/signin/route.ts` 가 아직 비어 있음).
   트레이 모듈이 없는 기기에서는 로그인할 방법이 없어지므로 실전환 전에 채우세요.

전환 절차와 채워야 할 코드는 [SSO_INTEGRATION.md](SSO_INTEGRATION.md) 에 있습니다.

---

## 10. 수집 파이프라인 연결 (5분)

Vercel 과 GitHub Actions 는 **환경변수를 공유하지 않습니다.** 같은 값을 두 곳에
각각 등록해야 합니다.

권장 순서:

1. Vercel 배포 완료 (여기까지 끝)
2. GitHub 리포 → Settings → Secrets → `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `GEMINI_API_KEY` 등록 → [GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md)
3. Actions 탭에서 **긱뉴스 동기화** 를 `dry_run: true` 로 1회 → 로그 확인
4. `dry_run` 없이 1회 → 실제 적재
5. 배포된 사이트를 새로고침 → 1면에 기사가 채워짐
6. **트렌드 브리핑 동기화 (Gemini)** 를 `limit: 5` 로 1회 → 품질 확인
7. 이후 매일 07:00 / 07:10 KST 에 자동 실행

> **Supabase 무료 플랜은 일정 기간 무활동 시 프로젝트를 일시정지합니다.**
> 매일 도는 수집이 있으면 정지되지 않습니다. 수집을 꺼 둘 거라면 정지 여부를
> 주기적으로 확인하세요 (정지되면 사이트가 DB 연결 오류를 냅니다).

---

## 11. 커스텀 도메인 (선택)

1. Settings → **Domains** → Add
2. 사내 DNS 에 Vercel 이 안내하는 `CNAME`(또는 A) 레코드 등록
3. 인증서는 자동 발급됩니다 (수 분)

> 도메인이 바뀌면 세션 쿠키는 도메인별로 따로이므로 다시 로그인해야 합니다.

---

## 12. 운영

| 하고 싶은 일 | 방법 |
|---|---|
| 코드 배포 | `git push` → 자동 배포 (기본 브랜치 = 프로덕션) |
| 환경변수 변경 반영 | 값 저장 후 **Deployments → ⋯ → Redeploy**. 저장만으로는 반영되지 않습니다 |
| 이전 버전으로 되돌리기 | Deployments → 이전 배포 → **Instant Rollback** |
| 런타임 로그 보기 | 프로젝트 → **Logs**. `console.error("[pipeline]", …)` 가 여기 찍힙니다 |
| CLI 로 로그 보기 | `vercel logs <deployment-url>` |
| 수집 이력 확인 | Supabase `sync_runs` 테이블 → [SUPABASE_SETUP.md](SUPABASE_SETUP.md) 8절 쿼리 |
| PR 프리뷰 | PR 마다 프리뷰 URL 이 생깁니다. Preview 환경에 운영 키를 넣어 뒀다면 **운영 DB 를 건드립니다** — 3절 주의 1번 참고 |

---

## 13. 문제 해결

| 증상 | 원인 · 조치 |
|---|---|
| 모든 페이지가 500. 로그에 `운영 환경에서는 SESSION_SECRET 을 반드시 설정해야 합니다` | `SESSION_SECRET` 미등록 → 추가 후 **재배포** |
| 파란 셋업 안내 화면만 뜬다 (`SUPABASE_URL 가 설정되지 않았습니다`) | Production 환경에 Supabase 변수가 없거나, 넣고 재배포하지 않음 |
| `Invalid path specified in request URL` | `SUPABASE_URL` 에 `/rest/v1` 이 붙은 주소를 넣음 → Project URL 로 교체 |
| 사진 자리에 `hostname … is not configured under images` | **빌드 시점**에 `SUPABASE_URL` 이 없었음 (`next.config.ts` 가 빌드 때 읽습니다) → 재배포 |
| 사진 URL 이 403/404 | private 버킷인데 `getPublicUrl()` 을 쓰는 상태 → [SUPABASE_MANUAL_SETUP.md](SUPABASE_MANUAL_SETUP.md) 3단계의 서명 URL 코드로 교체 |
| `/login` 에서 계속 되돌아온다 | 브라우저가 쿠키를 막고 있거나, 배포마다 `SESSION_SECRET` 이 달라짐 (한 번 정하면 고정) |
| `/admin` 이 `/` 로 튕긴다 | 그 사번의 `members.is_admin` 이 `false` → SQL 로 확인·수정 |
| 업로드 중 `413 FUNCTION_PAYLOAD_TOO_LARGE` | 조각 크기가 4.5MB 초과 → 4MB 유지 (7.2) |
| 파이프라인 실행이 `504 FUNCTION_INVOCATION_TIMEOUT` | 함수 시간 한도 초과 → `limit` 축소 또는 GitHub Actions 사용 (7.1) |
| `sync_runs` 가 `running` 에서 멈춤 | 함수가 타임아웃으로 죽은 경우. 15분 뒤 재실행 가능 |
| 빌드 실패 — 폰트 다운로드 오류 | 대개 일시적 네트워크 오류. 캐시 없이 Redeploy 재시도 |
| 빌드 실패 — Type error | 로컬 `npm run typecheck` 로 재현해 수정 |
| 배포는 됐는데 화면이 텅 비어 있다 | 데이터가 없는 것. 10절 수집 실행 |

---

## 부록 A. Vercel Cron 으로 수집을 돌리려면 (비권장)

7.1 · 7.4 의 한도 때문에 권하지 않지만, GitHub 을 쓸 수 없는 상황이라면
**직접 만들어야 하는 파일**이 두 개입니다.

`src/app/api/cron/sync/route.ts` (신규 작성):

```ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { syncGeekNews } from "@/lib/sync/geeknews";
import { enableEnvProxy } from "@/lib/proxy";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  // Vercel Cron 은 이 헤더를 붙여 호출한다. 외부 호출을 막는 유일한 수단이다.
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  enableEnvProxy();
  const db = supabaseAdmin();
  const { data } = await db
    .from("sync_runs")
    .insert({ kind: "geeknews", trigger: "cron", status: "running" })
    .select("id")
    .single<{ id: string }>();
  await syncGeekNews(db, { runId: data!.id, lookbackDays: 3, maxPages: 8 });
  return NextResponse.json({ ok: true });
}
```

`vercel.json` (신규 작성):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/cron/sync", "schedule": "0 22 * * *" }]
}
```

추가로 `CRON_SECRET` 환경변수를 등록하고, `src/proxy.ts` 의 matcher 에서
`api/cron` 을 제외해야 합니다 (지금 상태로는 로그인 검사에 걸립니다).
트렌드 수집은 시간이 길어 이 방식으로는 잘릴 가능성이 높습니다.

---

## 부록 B. 최종 체크리스트

- [ ] `npm run typecheck` · `npm run build` 로컬 통과
- [ ] GitHub private 리포에 푸시, `.env.local` 미포함 확인
- [ ] Vercel 프로젝트 생성 + 필수 환경변수 3개 (Production)
- [ ] 배포 성공, `/login` → 1면까지 확인
- [ ] Function Region = Seoul (icn1) 로 변경 후 재배포
- [ ] `/admin` 접근 + 긱뉴스 수집 1회 성공
- [ ] Deployment Protection 또는 SSO 실연동 계획 결정 (8절)
- [ ] GitHub Actions Secrets 등록 + 워크플로 수동 1회 성공
- [ ] 다음날 07:00 KST 자동 실행 결과 확인

---

## 참고 문서

- [Vercel Functions 한도](https://vercel.com/docs/functions/limitations) — 실행 시간 · 본문 4.5MB · 메모리
- [maxDuration 설정](https://vercel.com/docs/functions/configuring-functions/duration)
- [Deployment Protection](https://vercel.com/docs/deployment-protection)
- [Cron Jobs 한도](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [지원 Node.js 버전](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)

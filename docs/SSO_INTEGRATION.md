# 사내 SSO 연동 인계 문서

로그인 기본값은 여전히 **목업**입니다(`NEXT_PUBLIC_SSO_MODE=mock`). 실 모드
경로도 이제 다 이어져 있습니다 — 트레이 WebSocket 통신, 응답 파싱, 서버 디코딩,
EPID 추출, 등록사용자 대조까지.

남은 미지수는 **한 곳뿐**입니다: `SecuBase` 복호화 알고리즘. 그 파일을 받지
못해 `decode-knox.ts` 가 「단순 인코딩」을 가정하고 있습니다 —
[SSO_KNOX_PROTOCOL.md](SSO_KNOX_PROTOCOL.md) 에 아는 것/모르는 것과 담당자에게
보낼 질문을 정리해 두었습니다.

> ⚠ 그 가정은 **페이로드 위조를 막지 못합니다.** 그래서 운영 빌드에서 `real`
> 모드는 `SSO_ALLOW_UNVERIFIED_PAYLOAD=1` 을 명시해야만 세션을 발급합니다.
> 개발·스테이징에서는 연동 확인을 위해 열려 있습니다.

**로그인이 안 되는데 원인을 모르겠으면 `/login/diag` 를 먼저 여세요.**
환경변수(변수 로드)와 연동 로직을 4단계로 갈라 줍니다 —
[SSO_DEBUG.md](SSO_DEBUG.md). 실제 트레이에 처음 붙일 때 어느 복호화 전략이
통하는지도 그 화면의 3단계가 알려 줍니다.

---

## 지금 어떻게 동작하나

```
NEXT_PUBLIC_SSO_MODE=mock  (기본값)
```

`/login` 에 들어가면 4단계 진행 표시가 흐르고 약 2.4초 뒤 자동으로 로그인됩니다.
목업 사용자는 사번 `21084213` / 박세원 (`src/lib/auth/sso/mock-user.ts`).

개발 서버에서는 **로그인 화면을 거치지 않아도 됩니다.** 쿠키 없이 `/` 로 들어가면
proxy 가 `/api/auth/mock-session` 으로 보내고, 그 라우트가 목업 사용자로 세션을
만들어 원래 경로로 돌려보냅니다.

확인해 볼 수 있는 상태:

| URL | 결과 |
|---|---|
| `/login/diag` | 로그인 진단 4단계 (모드와 무관하게 동작 — [SSO_DEBUG.md](SSO_DEBUG.md)) |
| `/` (쿠키 없음) | 로그인 화면을 거치지 않고 목업 사용자로 세션 생성 |
| `/login` | 정상 자동 로그인 (세션이 이미 있으면 `/` 로 되돌림) |
| `/login?force=1` | 세션이 있어도 로그인 화면을 그대로 보여 줌 |
| `/login?fail=SSO_TRAY_NOT_RUNNING` | 트레이 모듈 미실행 실패 화면 |
| `/login?fail=SSO_TRAY_NOT_INSTALLED` | 모듈 미설치 실패 화면 |
| `/login?fail=SSO_TIMEOUT_30S` | 30초 타임아웃 실패 화면 |
| `/login?fail=SSO_NOT_REGISTERED` | 등록되지 않은 사용자 화면 |
| `/login?fail=SSO_CONFIG_MISSING` | 연동 설정 누락 화면 |

실패 화면에서 **사번으로 로그인** → 아무 사번/비밀번호나 통과(목업),
**뉴스레터로 이동 →** → 게스트 모드(공개 기사만, 코멘트·스크랩 차단).

이 세 가지(무로그인 자동 세션 · 사번 폴백 · 게스트)는 **목업 전용**입니다 —
아래 「목업 전용 우회 경로」 참고.

---

## 전체 흐름

```
브라우저                        Next 서버                     Supabase
   │
   │ ① WebSocket (wss://localhost:29283)
   ├──────────────▶ PC 트레이 인증 모듈
   │   {"rqtype":"getknoxsso","token":"","data":"<앱코드>"}
   │◀────────────── {"data":{"userInfo":"…","key":"…"}}
   │
   │ ② POST /api/auth/sso { kind:"knox", userInfo, privateKey }
   ├──────────────────────────────▶ decodeSsoPayload(payload)
   │                                     │  모드/종류 교차확인 → 디코딩
   │                                     ▼
   │                                 { epid, empNo, name, email, dept }
   │                                     │  ★ EPID 를 얻으면 성공
   │                                     │
   │                                 resolveMemberFromSso
   │                                     ├──── epid 조회 ───────────▶
   │                                     ├──── 없으면 emp_no 조회 ──▶
   │                                     │     (찾으면 epid 백필)
   │                                     │
   │                                 없거나 비활성이면 403 SSO_NOT_REGISTERED
   │                                     │
   │                                 jose 로 JWT 서명
   │◀──── Set-Cookie: ainl_session ──────┘
   │
   │ ③ 이후 요청 — proxy.ts 가 쿠키 검증
```

목업 모드는 ①이 `MockSsoClient` 로 바뀌고 페이로드가
`{ kind:"mock", encoded }` 인 것만 다릅니다. ② 이후는 완전히 같은 경로입니다.

---

## 채워야 할 곳은 이제 한 곳

### ★ `src/lib/auth/sso/decode-knox.ts` — SecuBase 복호화

`SecuBase.java` 를 받지 못해 「단순 인코딩」을 가정한 전략 테이블이 들어 있습니다.
규격이 오면 **이 파일만** 고칩니다 — 시그니처는 고정입니다.

```ts
decodeKnoxPayload(payload: { userInfo, privateKey }) => Promise<DecodedUser>
```

할 일은 세 가지입니다.

1. `STRATEGIES` 배열을 진짜 `secuDecode` 하나로 바꾼다
2. 서명·무결성 검증, 만료(`decodeTime` 계열이면), 대상(`aud`) 확인을 추가한다
3. `ssoServerEnv.allowUnverifiedPayload` 게이트를 제거한다 (`env.ts` · `.env.local.example`)

호출부(`decode.ts`)·라우트·화면은 손대지 않습니다. 아는 것/모르는 것과 담당자에게
보낼 질문 목록은 [SSO_KNOX_PROTOCOL.md](SSO_KNOX_PROTOCOL.md) 에 있습니다.

### 이미 이어진 것 — 참고용

| 파일 | 하는 일 |
|---|---|
| `sso/tray-protocol.ts` | `getknoxsso` 요청 조립 · 응답 프레임 파싱 (DOM 비의존 순수 함수) |
| `sso/client.ts` | `KnoxTraySsoClient` — 소켓 수명과 실패 분류 |
| `sso/decode.ts` | 모드/종류 교차확인 → 디코더 호출 → `assertDecodedUser` 관문 |
| `auth/current-user.ts` | `resolveMemberFromSso` — EPID 대조 · 사번 폴백 · EPID 백필 |
| `api/auth/sso/route.ts` | 태그 유니온 zod · 403/401 분기 · 레이트리밋 |

`onProgress(i)` 의 소유권이 갈렸습니다. **트레이는 메시지를 한 번만 보내므로**
클라이언트는 0·1·2 만 내고, 3(구독 정보 동기화)은 서버 왕복이라 `LoginClient` 가
`POST` 직전에 켭니다. 없는 단계를 지어내지 않으려는 것입니다.

| i | 라벨 | 실제 시점 | 켜는 쪽 |
|---|---|---|---|
| 0 | Tray 인증 모듈 연결 | `ws.onopen` | client |
| 1 | SSO 토큰 요청 | `ws.send()` 반환 후 | client |
| 2 | 사내 계정 확인 | `userInfo`+`key` 프레임 수신 | client |
| 3 | 구독 정보 동기화 | `POST /api/auth/sso` 직전 | LoginClient |

에러는 `SsoError` 로 던지면 화면이 안내 문구를 고릅니다. 실패 코드 5종:

```ts
"SSO_TRAY_NOT_RUNNING"    // 연결 거부 · 응답 전 끊김 · **인증서 불신도 여기** (구분 불가)
"SSO_TRAY_NOT_INSTALLED"  // 모듈 없음
"SSO_TIMEOUT_30S"         // 열린 뒤 30초 초과 (열리지도 못했으면 NOT_RUNNING)
"SSO_NOT_REGISTERED"      // 서버가 403 으로 — 등록되지 않았거나 비활성
"SSO_CONFIG_MISSING"      // 트레이 주소·앱코드 미설정 (배포 문제)
```

뒤 두 개는 서버가 응답 본문의 `code` 로 돌려주고, `LoginClient` 의 `isFailureCode`
분기가 「서버 오류」 대신 전용 안내 카드를 띄웁니다.

### 등록사용자 대조 — 「EPID 로 비교」

`resolveMemberFromSso` (`src/lib/auth/current-user.ts`) 가 담당합니다.

1. **`epid` 로 조회** — 트레이가 주는 진짜 식별자. 사번이 바뀌어도 따라옵니다.
2. **없으면 `emp_no` 로 조회** — EPID 를 아직 모르는 기존 계정(시드 5명 포함)을
   흡수하는 폴백. 찾으면 그 행에 **EPID 를 채웁니다**(백필).
3. 그래도 없으면 → `SSO_ALLOW_AUTO_CREATE` 가 꺼져 있으면 `SsoNotRegisteredError`
4. `is_active === false` → 같은 예외지만 **다른 문구** (사용자가 할 일이 다릅니다)

`0012_member_epid.sql` 이 **SQL 백필을 하지 않는 이유**가 여기 있습니다. EPID 는
사번과 다른 체계라 `epid = emp_no` 로 미리 채우면 **틀린 값**이 `members_epid_key`
유니크 인덱스를 선점하고, 정작 진짜 EPID 로 들어오는 사람이 막힙니다. 위 2번의
런타임 백필이 그 자리를 대신합니다.

`role`·`is_admin` 은 운영자가 관리하는 값이라 SSO 가 덮어쓰지 않습니다.

### (선택) `src/app/api/auth/signin/route.ts` — 사번 폴백 로그인

SSO 를 쓸 수 없는 상황(모듈 미설치, 사외 기기)의 대체 경로입니다.
**현재 방침에서는 닫혀 있습니다** — 목업 모드에서만 살아 있고, 그때도 비밀번호를
검증하지 않습니다.

방침이 바뀌어 사내 인증 API 를 붙이기로 하면:

- 사내 LDAP / 인증 API 에 `(사번, 비밀번호)` 검증을 위임
- 같은 사번·IP 기준 실패 횟수 제한
- **비밀번호를 이 서비스의 DB 에 저장하지 않는다**는 원칙 유지

---

## 목업 전용 우회 경로

최종 방침은 **「사내 SSO 를 통과하지 못하면 일반 사용을 제공하지 않는다」** 입니다.
그래서 아래 세 경로는 개발용으로만 열려 있습니다.

| 경로 | 하는 일 |
|---|---|
| `GET /api/auth/mock-session` | 쿠키 없는 화면 요청을 목업 사용자 세션으로 바꿔 준다 |
| `POST /api/auth/signin` | 사번 + 비밀번호 (비밀번호 미검증) |
| `POST /api/auth/guest` | 게스트 쿠키 — 공개 기사만 열람 |

열리는 조건은 `src/lib/env.ts` 의 `devAuthEnv.mockShortcuts` 한 곳입니다.

```ts
NODE_ENV !== "production" && ssoPublicEnv.mode === "mock"
```

**운영 빌드를 모드보다 먼저 봅니다.** `NEXT_PUBLIC_SSO_MODE` 의 기본값이 `mock`
이고 `VERCEL_DEPLOY.md` 도 첫 배포를 `mock` 으로 안내하기 때문에, 모드만 보고
판단하면 환경변수 하나를 빠뜨린 운영 배포에서 「아무 사번 + 아무 비밀번호」가
통과합니다. 시드의 사번 `21084213` 은 `is_admin` 입니다.

닫혔을 때의 동작:

| 경로 | 응답 |
|---|---|
| `/api/auth/mock-session` | 404 — 존재를 알리지 않는다 |
| `/api/auth/signin` · `/api/auth/guest` | 403 「사내 인증을 통과한 계정만 이용할 수 있습니다.」 |
| 화면 요청 | 언제나 `/login` 으로 |
| 로그인 화면 | 「SSO 다시 시도」만 남고 사번·게스트 버튼이 사라진다 |

게스트 차단은 `isGuest()` 한 줄이 게이트입니다 — `getViewer().guest`,
`canView`, `<Header guest>`, 게스트 배너가 전부 따라 닫힙니다.

> 목업 모드에서 여전히 열려 있는 것은 **목업 SSO 자동 로그인** 하나입니다
> (`POST /api/auth/sso` + `decodeMock`). 목업 모드로 배포한 URL 을 공개하기
> 전에 `VERCEL_DEPLOY.md` 8절을 반드시 읽으세요.

---

## 모바일 앱 로그인

앱은 사내 SSO 를 쓸 수 없습니다 — 트레이 모듈이 PC 전용입니다. 그래서 Google ·
Apple 네이티브 로그인으로 받은 ID 토큰을 서버가 검증하고, 웹 세션과 **같은 서명**
의 JWT 를 `Authorization: Bearer` 로 내줍니다. 그래서 `verifySession()` 이 두
경로에 그대로 쓰입니다.

- 엔드포인트 · 연결 규칙 · 환경변수 · 운영 절차: **[MOBILE_OAUTH2.md](MOBILE_OAUTH2.md)**
- 앱이 기대하는 계약 원본: 모바일 저장소 `docs/03-api-contract.md`

이 문서와 겹치는 부분은 두 곳입니다.

1. `getSessionUser(req?)` 가 쿠키와 Bearer 두 경로를 받습니다.
   **API 라우트는 반드시 `req` 를 넘겨야 합니다.**
2. `src/proxy.ts` 의 `/api/*` 분기가 `Authorization` 헤더를 함께 봅니다.
   화면 경로는 여전히 쿠키만 봅니다.

---

## 실 모드로 전환

```dotenv
NEXT_PUBLIC_SSO_MODE=real
NEXT_PUBLIC_SSO_TRAY_WS_URL=wss://localhost:29283
NEXT_PUBLIC_SSO_TRAY_APP_CODE=<발급받은 코드>
SSO_DECODE_KEY=<32바이트 키 (base64 권장)>
SSO_ALLOW_AUTO_CREATE=false
```

`NEXT_PUBLIC_` 값은 빌드에 박히므로 환경변수만 바꾸고는 반영되지 않습니다 —
**재배포가 필요합니다.** 반영됐는지는 `/login/diag` 1단계의 `build-sync` 항목이
빌드에 박힌 값과 프로세스의 값을 나란히 보여 줍니다.

전환 전 확인:

- [ ] `supabase/migrations/0012_member_epid.sql` 을 적용했다 (`members.epid`)
- [ ] 이 서비스용 **애플리케이션 코드**를 발급받았다 (`KCC60TRAY0109` 는 교육포털 것)
- [ ] 트레이 인증서가 사용자 PC 에서 신뢰되는지 확인했다
- [ ] `members` 에 실제 사용자를 등록했다 — **미등록자는 로그인할 수 없습니다**
- [ ] `SESSION_SECRET` 을 운영용 임의값으로 지정했다
- [ ] 사번 폴백을 열지 말지 정했다 (기본은 닫힘 — 「목업 전용 우회 경로」 참고)

운영 배포 전 반드시:

- [ ] **`decode-knox.ts` 에 실제 `SecuBase` 규격을 넣었다** — 넣기 전까지 운영
      빌드는 `SSO_ALLOW_UNVERIFIED_PAYLOAD=1` 없이는 로그인을 거절합니다.
      그 스위치를 켠 채 운영하는 것은 **페이로드 위조를 허용**하는 것입니다.

---

## 세션 · 권한

| 항목 | 값 |
|---|---|
| 방식 | `jose` 로 서명한 HS256 JWT |
| 쿠키 (웹) | `ainl_session` · HttpOnly · SameSite=Lax · 운영에선 Secure |
| 헤더 (앱) | `Authorization: Bearer <accessToken>` — 같은 서명·같은 페이로드 |
| 유효 기간 | 8시간 (`sessionEnv.maxAgeSec`) |
| 앱 리프레시 | `member_refresh_tokens` · 60일 · 회전 (`sessionEnv.refreshTtlDays`) |
| 게스트 | `ainl_guest` 쿠키 2시간 — **목업 모드에서만** |

Supabase Auth 를 쓰지 않는 이유: 로그인 주체가 사내 SSO 라서 Supabase 쪽에 사용자를
만들 필요가 없고, 만들면 사용자 상태를 두 곳에서 관리하게 됩니다.

접근 제어는 두 겹입니다.

1. `src/proxy.ts` (Edge) — 쿠키 유무와 JWT 의 `isAdmin` 으로 1차 차단
2. `src/app/admin/layout.tsx` — `members.is_admin` 을 DB 에서 다시 확인

2번이 필요한 이유: 관리자 권한을 회수해도 이미 발급된 JWT 는 만료 전까지 유효하기
때문입니다.

---

## 관련 파일

```
src/lib/env.ts        devAuthEnv — 목업 전용 경로의 게이트
src/lib/rate-limit.ts 로그인 시도 레이트리밋 (best-effort · 인스턴스 메모리)
src/lib/auth/
  session.ts          JWT 서명·검증 · bearerToken · getBearerUser (Edge 호환)
  current-user.ts     세션 읽기(쿠키·Bearer) · resolveMemberFromSso(등록 대조)
                      · upsertMemberFromSso(자동 가입) · isGuest 게이트
  sso/
    types.ts          AUTH_STEPS · SsoError · SsoDecodeError · SsoTrayPayload · DecodedUser
    failures.ts       실패 5종의 안내 문구
    tray-protocol.ts  getknoxsso 요청 조립 · 응답 프레임 파싱 (순수 함수)
    client.ts         KnoxTraySsoClient — 트레이 WebSocket
    client.mock.ts    목업
    mock-user.ts      목업 사용자 (서버·브라우저 공용)
    payload-schema.ts 요청 본문 규격 (실제 로그인·진단 드라이런이 공유)
    diagnostics.ts    진단 — 환경변수·DB 확인 · 드라이런 (docs/SSO_DEBUG.md)
    diag-types.ts     진단 자료구조 · 디코딩 추적 (서버·화면 공용)
    probe.ts          트레이 핸드셰이크 관찰 (브라우저)
    shape.ts          페이로드 모양 분석 (값을 드러내지 않는다)
    last-attempt.ts   마지막 로그인 시도 기록 (sessionStorage)
    decode.ts         디코딩 진입점 — 모드 교차확인 · 최종 검증 관문
    decode-knox.ts    ★ 남은 실구현 자리 — SecuBase 복호화
    index.ts          mode 로 분기

supabase/migrations/0012_member_epid.sql   members.epid + 부분 유니크 인덱스
docs/SSO_KNOX_PROTOCOL.md                  프로토콜 규격 · 담당자 질문 목록

src/app/login/        로그인 화면 (4단계 · 실패 · 사번 · 게스트)
src/app/api/auth/     sso · signin · guest · signout · mock-session
                      google · apple · refresh · logout · link-member  ← 모바일
src/app/api/me/       모바일 세션 복원
src/proxy.ts          경로별 접근 제어 (쿠키 · Bearer)
```

모바일 쪽 파일은 [MOBILE_OAUTH2.md](MOBILE_OAUTH2.md) 에 따로 정리해 두었습니다.

# 사내 SSO 연동 인계 문서

로그인은 지금 **목업으로 동작**합니다. 화면·세션·권한 처리는 전부 완성되어 있고,
실제 사내 규격이 들어갈 자리 두 곳만 비어 있습니다.

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
| `/` (쿠키 없음) | 로그인 화면을 거치지 않고 목업 사용자로 세션 생성 |
| `/login` | 정상 자동 로그인 (세션이 이미 있으면 `/` 로 되돌림) |
| `/login?force=1` | 세션이 있어도 로그인 화면을 그대로 보여 줌 |
| `/login?fail=SSO_TRAY_NOT_RUNNING` | 트레이 모듈 미실행 실패 화면 |
| `/login?fail=SSO_TRAY_NOT_INSTALLED` | 모듈 미설치 실패 화면 |
| `/login?fail=SSO_TIMEOUT_30S` | 30초 타임아웃 실패 화면 |

실패 화면에서 **사번으로 로그인** → 아무 사번/비밀번호나 통과(목업),
**뉴스레터로 이동 →** → 게스트 모드(공개 기사만, 코멘트·스크랩 차단).

이 세 가지(무로그인 자동 세션 · 사번 폴백 · 게스트)는 **목업 전용**입니다 —
아래 「목업 전용 우회 경로」 참고.

---

## 전체 흐름

```
브라우저                        Next 서버                     Supabase
   │
   │ ① WebSocket
   ├──────────────▶ PC 트레이 인증 모듈
   │◀────────────── { encoded }        ← 인코딩된 페이로드
   │
   │ ② POST /api/auth/sso { encoded }
   ├──────────────────────────────▶ decodeSsoPayload(encoded)
   │                                     │  복호화 · 서명검증 · 만료확인
   │                                     ▼
   │                                 { empNo, name, email, dept }
   │                                     │
   │                                     ├──── members upsert ──────▶
   │                                     │
   │                                 jose 로 JWT 서명
   │◀──── Set-Cookie: ainl_session ──────┘
   │
   │ ③ 이후 요청 — proxy.ts 가 쿠키 검증
```

---

## 채워야 할 곳은 두 개뿐

### ① `src/lib/auth/sso/client.ts` — 브라우저 WebSocket 클라이언트

인터페이스는 확정되어 있습니다. 바꿀 것은 **메시지 규격**뿐입니다.

```ts
export interface SsoClient {
  authenticate(
    onProgress: (step: 0 | 1 | 2 | 3) => void,
    signal: AbortSignal,
  ): Promise<{ encoded: string }>;
}
```

`TODO(사내연동)` 주석이 붙은 지점:

| 지점 | 지금 값 | 확인할 것 |
|---|---|---|
| 접속 주소 | `NEXT_PUBLIC_SSO_TRAY_WS_URL` | 트레이 모듈의 로컬 포트 (`wss://127.0.0.1:xxxxx`) |
| 핸드셰이크 | `{ type: 'auth-request', app: 'ai-newsletter', version: 1 }` | 실제 요청 메시지 규격 |
| 응답 분기 | `account-verified` / `auth-result` / `auth-error` | 실제 메시지 타입명 |
| 페이로드 필드 | `msg.encoded ?? msg.payload` | 실제 필드명 |

`onProgress(i)` 는 화면의 체크리스트와 1:1로 대응합니다.

| i | 라벨 | 호출 시점 |
|---|---|---|
| 0 | Tray 인증 모듈 연결 | WebSocket open |
| 1 | SSO 토큰 요청 | 요청 메시지 전송 완료 |
| 2 | 사내 계정 확인 | 서버가 계정 확인 응답을 보냄 |
| 3 | 구독 정보 동기화 | 최종 페이로드 수신 직전 |

에러는 `SsoError` 로 던지면 화면이 알아서 안내 문구를 고릅니다.

```ts
throw new SsoError("SSO_TRAY_NOT_RUNNING");   // 연결 거부
throw new SsoError("SSO_TRAY_NOT_INSTALLED"); // 모듈 없음
throw new SsoError("SSO_TIMEOUT_30S");        // 30초 초과 (기본 타이머가 이미 처리)
```

### ② `src/lib/auth/sso/decode.ts` — 서버 디코딩

```ts
export async function decodeSsoPayload(encoded: string): Promise<DecodedUser>
// DecodedUser = { empNo, name, email?, dept? }
```

`decodeReal()` 안에 주석으로 골격을 남겨 두었습니다. **네 가지를 모두** 처리해야
합니다.

1. **복호화** — 알고리즘·모드·IV 규격. 키는 `SSO_DECODE_KEY` 환경변수에서 읽습니다.
2. **서명 검증** — 사내 인증서버가 서명했는지 확인. 위조 페이로드를 막습니다.
3. **만료 확인** — `issuedAt` / `expiresAt` 이 현재 시각 기준 유효한지.
4. **대상 확인** — `audience` 가 이 애플리케이션인지.

> **2~4번을 빠뜨리면 누구든 임의의 사번으로 로그인할 수 있습니다.**
> 실운영 전환 체크리스트로 삼으세요.

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
NEXT_PUBLIC_SSO_TRAY_WS_URL=wss://127.0.0.1:<포트>
SSO_DECODE_KEY=<복호화 키>
```

전환 전 확인:

- [ ] `client.ts` 의 메시지 규격을 실제 프로토콜로 교체했다
- [ ] `decode.ts` 의 복호화 · 서명검증 · 만료확인 · 대상확인을 모두 구현했다
- [ ] 사번 폴백을 열지 말지 정했다 (기본은 닫힘 — 「목업 전용 우회 경로」 참고)
- [ ] `members` 의 사번을 실제 값으로 바꿨다 (시드는 임시값)
- [ ] `SESSION_SECRET` 을 운영용 임의값으로 지정했다

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
src/lib/auth/
  session.ts          JWT 서명·검증 · bearerToken · getBearerUser (Edge 호환)
  current-user.ts     세션 읽기(쿠키·Bearer), members upsert, isGuest 게이트
  sso/
    types.ts          AUTH_STEPS · SsoError · DecodedUser
    failures.ts       실패 3종의 안내 문구
    client.ts         ★ 실구현 자리 — WebSocket
    client.mock.ts    목업
    mock-user.ts      목업 사용자 (서버·브라우저 공용)
    decode.ts         ★ 실구현 자리 — 서버 디코딩
    index.ts          mode 로 분기

src/app/login/        로그인 화면 (4단계 · 실패 · 사번 · 게스트)
src/app/api/auth/     sso · signin · guest · signout · mock-session
                      google · apple · refresh · logout · link-member  ← 모바일
src/app/api/me/       모바일 세션 복원
src/proxy.ts          경로별 접근 제어 (쿠키 · Bearer)
```

모바일 쪽 파일은 [MOBILE_OAUTH2.md](MOBILE_OAUTH2.md) 에 따로 정리해 두었습니다.

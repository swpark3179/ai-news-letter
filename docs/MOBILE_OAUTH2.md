# 모바일 OAuth2 로그인

모바일 앱([`swpark3179/ai-news-letter-mobile`](https://github.com/swpark3179/ai-news-letter-mobile))이
이 서버로 로그인하는 경로입니다.

사내 SSO 는 **PC 트레이 인증 모듈에 WebSocket 으로 붙는 방식**이라 iOS·Android
에서는 성립하지 않습니다. 그래서 앱은 Google · Apple 네이티브 로그인으로 받은
**ID 토큰**을 이 서버에 보내고, 서버가 서명을 검증한 뒤 세션을 내줍니다.
액세스 토큰이 아니라 ID 토큰인 이유는, 필요한 것이 「Google/Apple API 호출
권한」이 아니라 「이 사람이 누구인지에 대한 공급자의 서명된 진술」이기 때문입니다.

구현은 모바일 저장소의 `server/` 참조 구현을 옮겨 온 것이고, 앱이 기대하는
계약 전문은 그쪽 [`docs/03-api-contract.md`](https://github.com/swpark3179/ai-news-letter-mobile/blob/main/docs/03-api-contract.md)
에 있습니다. **계약은 그 문서가 원본입니다** — 여기에 다시 적으면 두 벌이 갈립니다.
이 문서는 서버 쪽 결정과 운영 절차만 다룹니다.

---

## 엔드포인트

| 경로 | 인증 | 하는 일 |
|---|---|---|
| `POST /api/auth/google` | — | Google ID 토큰 → 세션 |
| `POST /api/auth/apple` | — | Apple ID 토큰 → 세션 (nonce 검사) |
| `POST /api/auth/apple/callback` | — | **Android 전용** — Apple 의 form_post 를 앱으로 307 |
| `POST /api/auth/refresh` | 리프레시 토큰 | 회전 |
| `POST /api/auth/logout` | Bearer(선택) | 폐기 |
| `POST /api/auth/link-member` | Bearer | 사번으로 기존 계정 연결 |
| `GET /api/me` | Bearer | 세션 복원 |

`/api/auth/*` 는 `src/proxy.ts` 의 matcher 밖이라 인증 없이 닿습니다.
`/api/me` 는 matcher 안이고, proxy 가 `Authorization` 헤더를 함께 보기 때문에
유효한 토큰만 통과합니다.

읽기 엔드포인트(`/api/mobile/*`)는 **아직 없습니다.** 앱은 그 부분을 계속
목업 데이터로 그립니다. 만들 때는 위 계약 문서의 「읽기」 절을 기준으로 하세요.

---

## 웹 세션과의 관계

```
                      웹                          앱
자격증명       HttpOnly 쿠키 ainl_session    Authorization: Bearer
값             HS256 JWT (8시간)             같은 서명·같은 페이로드의 JWT
갱신           재로그인                       리프레시 토큰으로 회전
```

액세스 토큰이 웹 세션과 같은 JWT 라서 `verifySession()` 을 그대로 재사용합니다.
그래서 **`SESSION_SECRET` 을 웹과 공유합니다.** 이 값을 바꾸면 앱의 모든 세션도
같이 끊깁니다.

두 경로를 받는 자리는 한 곳입니다 — `src/lib/auth/current-user.ts` 의
`getSessionUser(req?)`. **API 라우트는 반드시 `req` 를 넘겨야 합니다.** 넘기지
않으면 웹은 그대로 동작하고 앱만 401 이 되어 조용히 어긋납니다. 서버 컴포넌트에는
`Request` 가 없으므로 인자 없이 호출합니다.

헤더 파싱(`getBearerUser`)은 `src/lib/auth/session.ts` 에 있습니다. 참조 구현은
이 함수를 `mobile-session.ts` 에 두었지만, `proxy.ts`(Edge 런타임)도 같은 함수를
써야 하는데 그 파일은 `node:crypto` 와 `supabaseAdmin` 을 끌어와 Edge 번들에
들어갈 수 없어 옮겼습니다.

### CSRF · CORS

CSRF 토큰이 없는 근거는 세션 쿠키의 `sameSite=lax` 입니다
(`src/app/api/articles/[id]/route.ts` 주석). Bearer 는 브라우저가 스스로 붙이는
자격증명이 아니라 이 근거를 깨지 않습니다 — **단 액세스 토큰을 헤더 외의 경로로
받기 시작하면 그 순간 무너집니다.** 쿼리스트링·쿠키·폼 필드로 토큰을 받지 마세요
(`session.ts` 의 `bearerToken` 참고).

**CORS 헤더는 넣지 않았습니다.** Flutter 는 브라우저가 아니라 네이티브 HTTP
클라이언트라 preflight 가 없습니다. `Access-Control-Allow-Origin` 을 열면
사내 콘텐츠를 아무 웹 페이지에서나 읽을 수 있게 됩니다.

---

## 계정 연결 규칙

Google 과 Apple 은 토큰 검증 방법만 다르고, 「이 사람을 어느 `members` 행에
붙일 것인가」는 같습니다. 규칙은 `src/lib/auth/social-identity.ts` 한 곳에
모여 있습니다.

1. **`google_sub` / `apple_sub` 매칭** — 재로그인. 가장 확실합니다.
2. **검증된 이메일이 `members.email` 과 같음** — 기존 웹 계정과 자동 연동.
3. **둘 다 실패 → 자동 가입** — `emp_no` 를 `google:<sub>` / `apple:<sub>` 로
   채운 새 `members` 행을 subscriber 로 만듭니다. 실제 사번(숫자 8자리)과
   충돌하지 않고, 앱이 이 접두사를 보고 「사번으로 기존 계정 연결」을 안내합니다.

공급자별 매핑 표는 따로 둡니다 — `member_google_identities` ·
`member_apple_identities`. 합치지 않은 이유는
`supabase/migrations/0011_apple_identities.sql` 머리말에 있습니다.

> **2단계는 지금 거의 동작하지 않습니다.** `members.email` 이 nullable 이고
> `0008_seed.sql` 로 들어간 계정은 비어 있습니다. 그래서 기존 웹 사용자도 3단계
> 자동 가입으로 떨어지고, 「사번으로 기존 계정 연결」을 눌러야 합쳐집니다.
> 사내 메일 규칙이 확정되면 `0010_google_identities.sql` 아래쪽의 백필 SQL 을
> 한 번 실행해 두세요 — 그러면 이 경로를 타는 사람이 거의 없어집니다.
> (규칙을 모르는 상태로 실행하면 엉뚱한 계정이 연결되므로 마이그레이션에
> 넣지 않고 주석으로 남겨 두었습니다.)

### 사번 연결의 한계 — 읽어 둘 것

`POST /api/auth/link-member` 는 **사번의 소유를 증명하지 않습니다.** 사번은
동료들이 아는 8자리 숫자이고, 서버가 확인하는 것은 「그 사번의 계정에 아직
소셜 계정이 붙어 있지 않다」뿐입니다. 즉 개인 Google 계정으로 자동 가입한
사람이 임의의 사번을 주장할 수 있습니다.

그래서 **관리자 계정(`is_admin`)은 대상에서 제외했습니다.** 그게 없으면 개인
메일 하나로 관리자 콘솔까지 올라가는 길이 열립니다. 없음·비활성·관리자는 모두
같은 404 를 돌려줍니다 — 응답을 갈라 놓으면 사번 존재 여부를 확인하는 도구가
됩니다.

관리자·유닛장이 앱을 쓰는 정상 경로는 이렇습니다: **웹에서 사내 SSO 로 한 번
로그인**하면 `upsertMemberFromSso` 가 `members.email` 을 채우고, 그 뒤에는 위
연결 규칙 2단계가 자동으로 이어 붙입니다.

제대로 막으려면 사번 소유 증명(사내 메일로 보낸 확인 코드 등)이 필요합니다.
지금은 없습니다.

---

## 토큰

| | 값 | 비고 |
|---|---|---|
| 액세스 토큰 | HS256 JWT, 8시간 (`sessionEnv.maxAgeSec`) | 웹 쿠키와 같은 서명. **폐기 수단이 없다** |
| 리프레시 토큰 | 임의 256비트, 60일 (`sessionEnv.refreshTtlDays`) | DB 에 sha256 해시만 남긴다. 폐기 가능 |

리프레시는 **회전**합니다 — 쓰면 폐기되고 새 것이 나옵니다. 이미 폐기된 토큰이
다시 오면 탈취로 보고 그 계정의 모든 세션을 끊습니다
(`rotateMobileSession`).

액세스 토큰에는 `jti` 가 없고 폐기 목록도 없습니다. 유출된 토큰은 남은 유효
기간(최대 8시간) 동안 그대로 쓸 수 있습니다. 짧게 하고 싶으면 `signSession` 에
수명 인자를 받도록 늘리고 `issueMobileSession` 만 짧은 값을 쓰게 하면 됩니다 —
앱은 응답의 `expiresIn` 을 그대로 읽어 선제 갱신하므로 앱을 고치지 않아도 됩니다.

### 퇴사·계정 정지 절차

`is_active = false` 만으로는 **앱 세션이 끊기지 않습니다.** 리프레시 회전
(`rotateMobileSession`)과 `requireMember` 는 `is_active` 를 보지만, 액세스
토큰만 쓰는 요청은 JWT 만 보기 때문입니다. 두 가지를 함께 하세요.

1. `members.is_active = false`
2. `revokeAllForMember(memberId)` — 또는
   `update public.member_refresh_tokens set revoked_at = now() where member_id = '<id>' and revoked_at is null;`

그 뒤 최대 8시간(액세스 토큰 수명) 동안은 기존 토큰이 살아 있습니다.

---

## 환경변수

| 이름 | 필수 | 설명 |
|---|---|---|
| `GOOGLE_WEB_CLIENT_ID` | ✔ | ID 토큰의 `aud` 로 허용할 값. 앱의 `GOOGLE_SERVER_CLIENT_ID` 와 같아야 한다 |
| `GOOGLE_IOS_CLIENT_ID` | | 설정이 어긋난 빌드 대비. 안정되면 빼도 된다 |
| `GOOGLE_ANDROID_CLIENT_ID` | | 위와 같음 |
| `ALLOWED_HOSTED_DOMAINS` | | 쉼표 구분. **비우면 도메인 제한 없음**(현재 방침). Google 에만 걸린다 |
| `APPLE_CLIENT_IDS` | ✔ | 쉼표 구분. iOS 는 **번들 ID**, Android 는 **Services ID** 가 `aud` 다 |
| `APPLE_ANDROID_PACKAGE` | | 콜백이 되돌릴 앱. 기본값 `io.github.swpark3179.ainewsletter` |
| `SESSION_SECRET` | ✔ | 웹과 공유. 액세스 토큰이 같은 서명이다 |

전부 `src/lib/env.ts` 의 `socialAuthEnv` 에서 lazy getter 로 읽습니다.
Google · Apple 클라이언트를 만드는 절차는 모바일 저장소
[`docs/04-google-oauth-setup.md`](https://github.com/swpark3179/ai-news-letter-mobile/blob/main/docs/04-google-oauth-setup.md) ·
[`docs/13-apple-signin-setup.md`](https://github.com/swpark3179/ai-news-letter-mobile/blob/main/docs/13-apple-signin-setup.md)
에 있습니다.

### 나중에 사내 전용으로 잠글 때

`ALLOWED_HOSTED_DOMAINS=samsung.com` **만으로는 부족합니다.** Apple 에는 `hd`
같은 클레임이 없어서 Apple 경로는 그대로 열려 있습니다. 잠그려면 세 가지를
함께 정해야 합니다.

1. Google — `ALLOWED_HOSTED_DOMAINS` 를 채운다 (코드 수정 없음)
2. Apple — 검증된 메일의 도메인을 검사하거나, Apple 로그인을 아예 닫는다.
   「이메일 가리기」를 쓴 사용자는 릴레이 주소가 와서 도메인 검사가 불가능하다
3. 자동 가입(연결 규칙 3단계)을 막는다 — `createMemberForIdentity` 호출을
   차단하고 403 을 돌려주면 「웹에서 사내 SSO 로 먼저 로그인한 사람」만 남는다

3번을 켜면 사내 계정만 남지만, Apple 「이메일 가리기」 사용자는 앱을 아예 쓸 수
없게 됩니다(릴레이 주소는 `members.email` 과 절대 맞지 않음). 그때는 Google 만
쓰게 하거나 관리자가 미리 연결해 주어야 합니다.

App Store 가이드라인 4.8 과의 관계도 같이 봐야 합니다 — 도메인을 실제로 잠그면
「사내 계정 시스템」 예외를 주장할 수 있어 Apple 로그인이 선택이 되고, 잠그지
않으면 Apple 로그인이 사실상 필수입니다 (모바일 저장소 `docs/10-deploy-ios.md`).

---

## 적용 절차

1. **마이그레이션** — `supabase/migrations/0010_google_identities.sql`,
   `0011_apple_identities.sql` 을 Supabase SQL 편집기에서 번호 순서대로 실행.
   (이 저장소는 Supabase CLI 를 쓰지 않습니다.) 확인은 `supabase/VERIFY.sql`.
2. **환경변수** — 위 표의 값을 `.env.local` 또는 배포 환경에 넣습니다.
3. **앱 빌드** —
   ```bash
   flutter build appbundle \
     --dart-define=API_BASE_URL=https://… \
     --dart-define=GOOGLE_SERVER_CLIENT_ID=<GOOGLE_WEB_CLIENT_ID 와 같은 값>
   ```
   Apple 로그인은 iOS 에서 dart-define 이 필요 없습니다(번들 ID + Xcode 기능만).
   Android 까지 열려면 Services ID 를 만들고 두 값을 더 넘깁니다.

### 확인

```bash
# 앱 로그에서 복사한 실제 ID 토큰으로
curl -X POST http://localhost:3000/api/auth/google \
  -H 'content-type: application/json' \
  -d '{"idToken":"eyJhbGciOi…","deviceLabel":"iPhone 15"}'
# → { accessToken, refreshToken, expiresIn, user }

curl http://localhost:3000/api/me -H "authorization: Bearer <accessToken>"
curl -X POST http://localhost:3000/api/auth/refresh -d '{"refreshToken":"…"}'
curl -X POST http://localhost:3000/api/auth/refresh -d '{"refreshToken":"같은 값"}'  # → 401, 전체 세션 폐기
```

토큰 없이도 확인되는 것: 잘못된 `idToken` → 401, `GOOGLE_WEB_CLIENT_ID` 미설정
→ 500, `APPLE_CLIENT_IDS` 미설정 → 500, `/api/me` 헤더 없이 → 401,
`?access_token=` 쿼리로는 통하지 않음 → 401.

DB 확인:

```sql
select emp_no, name, email from public.members
 where emp_no like 'google:%' or emp_no like 'apple:%' order by created_at desc;

select member_id, device_label, created_at, revoked_at
  from public.member_refresh_tokens order by created_at desc limit 20;
```

---

## 관련 파일

```
src/lib/auth/
  session.ts            JWT 서명·검증 · bearerToken · getBearerUser (Edge 호환)
  current-user.ts       getSessionUser(req?) — 쿠키와 Bearer 두 경로
  social-identity.ts    공통 — 연결 규칙 3단계 · userPayload · 사번 연결
  google-identity.ts    Google ID 토큰 검증 (+ hd 도메인 제한)
  apple-identity.ts     Apple ID 토큰 검증 (JWKS · nonce · 릴레이 메일)
  mobile-session.ts     액세스/리프레시 발급 · 회전 · 폐기

src/app/api/auth/       google · apple · apple/callback · refresh · logout · link-member
src/app/api/me/         세션 복원
src/proxy.ts            /api/* 에서 Bearer 를 세션으로 인정
supabase/migrations/    0010_google_identities.sql · 0011_apple_identities.sql
```

사내 SSO(웹) 쪽은 [`SSO_INTEGRATION.md`](SSO_INTEGRATION.md) 를 보세요.

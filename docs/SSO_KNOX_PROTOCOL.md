# Knox SSO 트레이 프로토콜 — 아는 것과 모르는 것

레거시 교육포털 코드(`ssoLogin.js` · `LoginFrSingle.jsp` · `Secu.java` ·
`SecuKeyGen.java`)에서 읽어낸 규격과, **아직 확인하지 못해 담당자에게 물어야 하는
것**을 정리한 문서입니다.

연동 자체의 구조와 코드 위치는 [SSO_INTEGRATION.md](SSO_INTEGRATION.md) 를 보세요.
이 문서는 「규격이 어디까지 확정됐나」만 다룹니다.

---

## 확인된 것

### ① WebSocket 대화 — 한 번의 왕복이 전부

```
브라우저 ──▶ wss://localhost:29283
         ──▶ {"rqtype":"getknoxsso","token":"","data":"KCC60TRAY0109"}
         ◀── {"rqtype":"getknoxsso", … ,"data":{"userInfo":"…","key":"…"}}
         ──▶ close
```

`token` 은 레거시에서도 빈 문자열이었습니다. `data` 는 애플리케이션 코드입니다
(아래 ④).

구현: `src/lib/auth/sso/tray-protocol.ts` · `client.ts`

### ② 응답의 중첩 JSON

`data.userInfo` 와 `data.key` 는 「문자열 안에 든 JSON」일 수도, 그냥 암호문일
수도 있습니다. 레거시는 이렇게 풀었습니다 (`ssoLogin.js:11`).

```js
JSON.stringify(event.data).replace(/\\/g,'').replace(/"\{/g,'{').replace(/\}"/g,'}')
```

`event.data` 는 **이미 문자열**이라 `JSON.stringify` 가 이스케이프를 한 겹 더
씌우고(`"` → `\"`), 백슬래시를 전부 지우면 두 겹이 한꺼번에 풀립니다. `"{` → `{`
치환은 중첩된 JSON *문자열*을 객체 리터럴로 승격시키는 것입니다. 의도는 「바깥
JSON 을 파싱하고 안쪽 JSON 문자열을 한 번 더 파싱한다」인데 문자열 치환으로
흉내 낸 것입니다.

**값에 백슬래시가 하나라도 들어가면 조용히 깨집니다** — `\n`, `\uXXXX`, 이름 속
따옴표. 암호문이라면 원문이 훼손됩니다. 그래서 옮겨 오지 않고 정직하게
파싱합니다: 바깥 프레임 `JSON.parse` 한 번, `data` 가 문자열이면 한 번 더,
`userInfo`·`key` 는 **무변형**으로 추출.

### ③ 서버 디코딩의 흔적

`Secu.java` 는 `type` 에 따라 `baseKey` 만 고르고, 실제 암복호화는 부모 클래스
`SecuBase` 에 위임합니다.

```java
static public String decode(String wb64str, String type) { setBasekey(type); return SecuBase.decode(wb64str); }
```

여기서 읽어낼 수 있는 것:

| 단서 | 뜻 |
|---|---|
| 파라미터명 `wb64str` | 입력이 **web-safe base64** 로 보인다 |
| `baseKey` 가 32글자 | `SecuKeyGen.makeKey2(32)` — 코드포인트 1~126, 한 글자 = 1바이트 |
| `encode`/`decode` 와 `encodeTime`/`decodeTime` 두 쌍 | **시각이 함께 실리는 변형**이 있다 → 만료 검사 자리 |
| SSO 전용 baseKey 가 따로 있음 | DB·URL·JS 와 키를 나눠 쓴다 |

### ④ 애플리케이션 코드

`KCC60TRAY0109` 는 **레거시 교육포털의 코드**입니다. 이 서비스용 코드를 따로
발급받아 `NEXT_PUBLIC_SSO_TRAY_APP_CODE` 에 넣어야 합니다. 코드에 기본값을 두지
않은 이유는, 그럴듯한 기본값이 박혀 있으면 잘못 설정된 배포가 전 사용자에게
「인증 모듈 미실행」으로 조용히 실패하기 때문입니다.

### ⑤ 서버가 RSA 개인키를 들고 있었다 (`rsaprivkey8`)

레거시 운영 코드에 **`rsaprivkey8`** 이라는 RSA 개인키가 있었습니다. 이것이
후보 (B)를 사실상 확정합니다 — 대칭키(baseKey) 하나로 푸는 구조가 아니라
**하이브리드 암호**입니다.

```
트레이의 key      = 세션키(대칭키)를 서버 공개키로 RSA 암호화한 것
트레이의 userInfo = 그 세션키로 암호화한 사용자 정보
                              │
서버:  RSA 개인키로 key 를 푼다 ─┘ → 세션키 → userInfo 복호화
```

이름의 `8` 은 **PKCS#8** 표기를 뜻할 가능성이 큽니다 (`rsaprivkey.pem` = PKCS#1,
`rsaprivkey8.pem` = PKCS#8 로 나눠 두는 관례). 어느 쪽이든 코드가 둘 다 받습니다.

넣는 자리는 `SSO_RSA_PRIVATE_KEY` 입니다. **`SSO_DECODE_KEY` 가 아닙니다** —
그쪽은 SecuBase 의 32바이트 대칭키 자리라 개인키를 넣으면 길이 검사에서 거절됩니다.

| | `SSO_DECODE_KEY` | `SSO_RSA_PRIVATE_KEY` |
|---|---|---|
| 정체 | SecuBase SSO baseKey (대칭) | 서버 개인키 (`rsaprivkey8`) |
| 길이 | 정확히 32바이트 | 2048비트 키 → 수백 바이트 |
| 표기 | 8진 이스케이프 · base64 | PEM · 이스케이프 PEM · base64(PEM) · base64(DER) |
| 쓰는 곳 | `wb64-xor-basekey` 전략 | `rsa-key→…` 전략 전부 |

---

## 확인하지 못한 것 — **`SecuBase.java` 와 `ssoLoginService.jsp` 를 받지 못했습니다**

이 둘이 없으면 `userInfo` 복호화를 정확히 재현할 수 없습니다.

1. **알고리즘 자체** — XOR 스트림인지 블록 암호인지, 패딩·IV·MAC 유무
2. **`privateKey` 와 `userInfo` 의 관계** — 후보 셋
   - (A) `userInfo` 를 baseKey 로 풀면 되고 `key` 는 무결성 확인용
   - (B) `key` 를 풀면 세션키가 나오고 그것으로 `userInfo` 를 푼다
   - (C) 둘 다 baseKey 로 풀리는 독립된 값
3. **평문의 필드 이름** — 특히 EPID 의 키 (`epid` / `EPID` / `knoxId` …)
4. **시각 필드의 형식과 허용 오차** — `encodeTime` 계열이라면

### 그동안 무엇을 하고 있나

`src/lib/auth/sso/decode-knox.ts` 가 후보 조합을 순서대로 시도해, EPID 가 나오는
첫 조합을 채택하고 **무엇이 통했는지를 기록**합니다. 그 기록이 곧 규격 확인입니다.

**RSA 계열 — `SSO_RSA_PRIVATE_KEY` 가 있을 때 (권장 경로)**

| 전략 | 내용 |
|---|---|
| `rsa-key→aes-cbc-iv` | key 를 풀어 세션키 → AES-CBC, **IV 는 암호문 앞 16바이트** |
| `rsa-key→aes-cbc-zero` | 같되 IV 를 0 으로 |
| `rsa-key→aes-ecb` | 같되 ECB |
| `rsa-key→xor` | 같되 세션키로 반복 XOR (SecuBase 가 XOR 스트림이라면) |
| `rsa-userinfo` | userInfo 자체를 개인키로 직접 복호화 |

RSA 패딩은 `pkcs1` · `oaep-sha1` · `oaep-sha256` 을 **전부** 시도합니다.
「예외가 안 났으니 이 패딩이 맞다」로 판정하지 않는 이유는 OpenSSL 3 이 PKCS#1
v1.5 복호화에 암묵적 거부(implicit rejection)를 적용해 **패딩이 틀려도 예외 없이
쓰레기를 돌려주기** 때문입니다. 그래서 모든 패딩의 결과를 후보로 모으고, 판정은
「세션키 길이(16·24·32바이트)가 나오는가 → 대칭 복호화가 텍스트가 되는가」로 합니다.
세션키가 base64·hex 문자열로 실려 오는 경우도 후보에 넣습니다.

**평문 계열 — RSA 키가 **없을 때만** 열립니다**

| 전략 | 내용 |
|---|---|
| `raw-plain` | 이미 평문 (JSON 또는 쿼리스트링) |
| `wb64-plain` | web-safe base64 → UTF-8 |
| `wb64-xor-basekey` | base64 디코딩 후 `SSO_DECODE_KEY` 로 반복 XOR — 후보 (A)/(C) |
| `wb64-xor-privatekey` | base64 디코딩 후 `privateKey` 로 반복 XOR |

RSA 개인키가 설정돼 있으면 위 넷은 `skipped` 로 닫힙니다. 진짜 키를 들고도
base64 평문을 받아 주면 **그 경로가 그대로 위조 통로**가 되기 때문입니다 —
공격자는 언제나 가장 약한 전략을 고릅니다.

평문 판정은 「유효한 UTF-8 인가 + 제어문자가 없는가 + JSON/쿼리스트링으로
해석되는가」로 합니다. base64 디코딩은 아무 입력이나 받아 바이트를 뱉으므로,
이 판정이 없으면 첫 전략이 항상 이겨 버립니다.

**실제 트레이에 한 번 붙여 보면 답이 나옵니다.** 개발 모드에서 성공한 전략명과
클레임 키 목록이 서버 로그에 찍히고, 전부 실패하면 시도한 전략이 에러 메시지에
나열됩니다. 그 로그가 아래 질문의 근거가 됩니다.

### ⚠ RSA 복호화가 되어도 위조를 막는 것은 아닙니다

`userInfo` 가 실제로 base64 평문이라면 누구든 임의의 EPID 로 페이로드를 만들 수
있고, 등록사용자 대조를 통과하면 **등록된 아무 사람으로나 로그인**됩니다.

RSA 로 좁혀졌어도 사정이 크게 달라지지는 않습니다. **공개키는 공개된 값**이라
그것을 가진 사람(트레이가 깔린 모든 PC)은 페이로드를 만들 수 있습니다 —
RSA 암호화가 주는 것은 기밀성이지 인증이 아닙니다. 인증은 서명이나 MAC,
또는 `encodeTime` 계열의 만료 검사가 붙어야 생깁니다.

그래서 운영 빌드에서 `real` 모드는 `SSO_ALLOW_UNVERIFIED_PAYLOAD=1` 을 명시해야만
세션을 발급합니다. 개발·스테이징에서는 연동 확인을 위해 열려 있습니다.

규격을 받으면 **`decode-knox.ts` 한 파일만** 고칩니다 — 후보 배열을 확정된
조합 하나로 줄이고, 무결성 확인(서명·MAC·만료)을 붙인 뒤 이 게이트를 제거합니다. 시그니처
(`decodeKnoxPayload(payload) => Promise<DecodedUser>`)는 고정이라 호출부·라우트·
화면은 손대지 않습니다.

---

## 담당자에게 보낼 질문

1. **`SecuBase.java` 소스** — 또는 알고리즘 규격 (모드 · IV · 패딩 · MAC).
   특히 **세션키로 `userInfo` 를 푸는 부분**: 알고리즘(AES? SEED?), 모드(CBC/ECB),
   IV 를 어디서 얻는지(암호문 앞? 고정값?), 패딩(PKCS#7? 제로?).
2. **`rsaprivkey8` 을 쓰는 코드** — `Cipher.getInstance("RSA/ECB/…")` 의 변환 문자열
   한 줄이면 패딩이 확정됩니다. 세션키를 그대로 쓰는지, base64·hex 문자열로
   실어 보내는지도 그 근처에 있습니다.
3. **`ssoLoginService.jsp`** — `key`(=`privateKey`)를 복호화하는가, 복호화 키로
   쓰는가, 무결성 확인에만 쓰는가? 위 (A)/(B)/(C) 중 어느 것인지.
   (`rsaprivkey8` 의 존재로 (B)가 유력해졌지만 확인은 필요합니다.)
4. **`rsaprivkey8` 이 지금도 유효한 키인가** — 이 서비스에 그대로 써도 되는지,
   서비스마다 키를 나눠 쓰는지. 짝이 되는 공개키가 트레이 쪽에 어떻게 등록되는지.
5. 트레이는 `encode` 를 쓰는가 `encodeTime` 을 쓰는가? **`encodeTime` 이라면**
   시각 형식과 허용 오차(skew)는?
6. 복호화된 `userInfo` 의 **정확한 필드 이름** — 특히 EPID 의 키. 전체 필드
   목록이 있으면 가장 좋습니다.
7. EPID 와 사번의 관계 — 이 프로젝트는 **다른 체계**로 가정하고 `members.epid`
   컬럼을 따로 두었습니다 (`supabase/migrations/0012_member_epid.sql`).
8. 새 서비스용 **애플리케이션 코드** 발급 절차 (`KCC60TRAY0109` 상당).
9. 트레이가 `Origin` 허용목록을 검사하는가? 그렇다면 운영 오리진을 등록해야
   합니다. (WebSocket 에는 CORS 가 없지만 서버가 `Origin` 헤더를 볼 수 있습니다.)
10. 트레이의 `localhost` TLS 인증서가 사내 신뢰 저장소에 체인되는가? 주소는
   `localhost` 인가 `127.0.0.1` 인가 (인증서 SAN 에 따라 다릅니다).

---

## `wss://localhost:29283` 에 대해 알아 둘 것

- **`ws://` 가 아니라 `wss://`** — https 페이지에서 `ws://` 는 혼합 콘텐츠로
  차단됩니다. 루프백은 "potentially trustworthy" 로 예외를 주는 브라우저도
  있지만 일관되지 않습니다. 레거시도 `wss://` 를 썼으니 그대로 갑니다.
- **인증서가 신뢰되지 않으면 브라우저가 「인증서 거부」와 「아무것도 안 떠
  있음」을 구분해 주지 않습니다.** `new WebSocket()` 이 불투명한 오류로 실패할
  뿐입니다. 그래서 두 경우를 같은 `SSO_TRAY_NOT_RUNNING` 으로 묶고, 안내 카드에
  인증서 확인 항목을 넣어 두었습니다.
- **개발 PC 첫 실행 우회** — `https://localhost:29283/` 를 새 탭에서 한 번 열어
  인증서를 수락하면 이후 WebSocket 이 붙습니다.
- **`localhost` 와 `127.0.0.1` 은 교환 가능하지 않습니다** — 인증서 SAN 에
  달렸습니다. 받은 문자열 그대로 환경변수에 넣으세요.

---

## 실 트레이로 확인하는 순서

미지수를 하나씩 떼어 내는 순서입니다.

**1. 우리 코드 없이 프레임부터 캡처** — 사내 PC 브라우저 콘솔에서:

```js
const ws = new WebSocket("wss://localhost:29283");
ws.onopen    = () => ws.send(JSON.stringify({rqtype:"getknoxsso", token:"", data:"<APP_CODE>"}));
ws.onmessage = e => console.log("frame:", e.data);
ws.onerror   = e => console.error("error", e);
ws.onclose   = e => console.log("close", e.code, e.reason);
```

여기서 열리지도 않으면 포트·인증서·`Origin` 문제입니다 — 우리 코드 이전 단계.

**2. 캡처한 프레임을 파서에 넣어 본다** — `parseTrayFrame(frame)` 이
`kind === "result"` 를 내고 `userInfo` 가 원본과 **한 글자도 다르지 않은지**
확인합니다.

**3. 앱을 실 모드로 띄운다**

```dotenv
NEXT_PUBLIC_SSO_MODE=real
NEXT_PUBLIC_SSO_TRAY_WS_URL=wss://localhost:29283
NEXT_PUBLIC_SSO_TRAY_APP_CODE=<발급받은 코드>
SSO_RSA_PRIVATE_KEY=<rsaprivkey8 (base64 로 감싸는 것을 권함)>
SSO_DECODE_KEY=<32바이트 대칭키 — RSA 를 쓰면 필요 없습니다>
SSO_ALLOW_AUTO_CREATE=false
```

`/login?force=1` → 0·1·2 단계가 실제 트레이에서 차오르고, 그다음:

- **EPID 가 추출되면 성공** — 서버 로그에 어느 전략이 통했는지와 클레임 키
  목록이 찍힙니다. 이어서 등록사용자 대조가 돕니다.
- **전부 실패하면** 401 과 함께 시도한 전략이 나열됩니다. 그것이 곧 「SecuBase
  규격이 필요하다」는 답입니다. 마스킹한 샘플 프레임과 함께 위 질문 목록을
  보내세요.

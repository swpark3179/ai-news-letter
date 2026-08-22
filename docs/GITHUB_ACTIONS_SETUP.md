# GitHub Actions 설정 가이드

동기화 워크플로 3개를 실제로 돌리기 위한 절차입니다.

| 워크플로 | 트리거 | LLM | 하는 일 |
|---|---|---|---|
| `sync-geeknews.yml` | 매일 07:00 KST + 수동 | **없음** | news.hada.io 제목·요약을 그대로 수집 |
| `sync-trend-gemini.yml` | 매일 07:10 KST + 수동 | Gemini | GitHub·HN·arXiv·긱뉴스 → 한국어 기사 |
| `sync-trend-openai.yml` | **수동만** | OpenAI | 같은 작업을 OpenAI 로 |

긱뉴스가 먼저(07:00) 돌고 트렌드가 나중(07:10)에 도는 이유는, 트렌드 브리핑이
그날 수집된 긱뉴스 항목도 재료로 쓰기 때문입니다.

---

## 1. 리포지터리 만들기 및 푸시

```bash
cd C:/Users/s-w.park/Desktop/ai-news-letter

git add -A
git commit -m "AI 뉴스레터 초기 구현"

# private 으로 만드는 것을 권장합니다 (사내 콘텐츠·시드에 실명이 들어갑니다)
gh repo create ai-news-letter --private --source=. --remote=origin
git push -u origin main
```

> `.env.local` 은 `.gitignore` 에 있어 커밋되지 않습니다.
> `.env.local.example` 만 올라갑니다.

---

## 2. Secrets 등록

리포 → Settings → Secrets and variables → Actions → **New repository secret**

| 이름 | 필수 | 값 |
|---|:---:|---|
| `SUPABASE_URL` | ✅ | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase Project Settings → API 의 `service_role` 키 |
| `GEMINI_API_KEY` | 트렌드(Gemini)에 필요 | https://aistudio.google.com/apikey |
| `OPENAI_API_KEY` | 트렌드(OpenAI)에 필요 | https://platform.openai.com/api-keys |

CLI 로:

```bash
gh secret set SUPABASE_URL
gh secret set SUPABASE_SERVICE_ROLE_KEY
gh secret set GEMINI_API_KEY
gh secret set OPENAI_API_KEY
```

### Variables (선택)

Settings → Secrets and variables → Actions → **Variables** 탭

| 이름 | 기본값 | 용도 |
|---|---|---|
| `GEMINI_MODEL` | `gemini-2.5-flash` | 모델 교체 시 |
| `OPENAI_MODEL` | `gpt-5-mini` | 모델 교체 시 |

---

## 3. 첫 실행 (수동)

Actions 탭 → 워크플로 선택 → **Run workflow**

권장 순서:

1. `긱뉴스 동기화` 를 `dry_run: true` 로 → 로그에서 파싱이 정상인지 확인
2. `긱뉴스 동기화` 를 그냥 실행 → 실제 적재
3. `트렌드 브리핑 동기화 (Gemini)` 를 `dry_run: true` 로 → 수집 대상 확인 (LLM 호출 없음)
4. `트렌드 브리핑 동기화 (Gemini)` 를 `limit: 5` 로 → 5건만 기사화해 품질 확인
5. 결과가 괜찮으면 그대로 두면 다음날 07:00 부터 자동으로 돕니다

---

## 4. 알아 둘 제약

### schedule 은 정확하지 않다

GitHub 무료 러너의 `schedule` 은 큐 상황에 따라 **수 분에서 수십 분까지 지연되거나
아예 건너뛸 수 있습니다.** `cron: "0 22 * * *"` 가 07:00 KST 정각을 보장하지
않습니다. 발행 시각을 엄격히 지켜야 한다면 아래 대안을 쓰세요.

### 60일 무활동 시 자동 비활성화

리포에 60일간 커밋이 없으면 GitHub 이 예약 워크플로를 자동으로 끕니다.
Actions 탭에 뜨는 안내 배너에서 다시 켜거나, 주기적으로 커밋이 생기게 하세요.

### Gemini 무료 티어 할당량

`gemini-2.5-flash` 기준 **10 RPM / 500 RPD** 입니다 (2026-08 기준).
워크플로는 호출 간 7초 간격(`LLM_MIN_CALL_INTERVAL_MS=7000`)을 두고, 5건씩 묶어
보냅니다. 신규 30건이면 6회 호출 ≈ 42초라 여유가 충분합니다.

할당량을 소진했다면 `sync-trend-openai.yml` 을 수동 실행하세요.

### 무료 티어의 데이터 이용 정책

Google AI Studio **무료 티어는 입력이 Google 제품 개선에 사용될 수 있습니다.**

이 파이프라인이 LLM 에 보내는 것은 공개 웹 콘텐츠뿐입니다.

- GitHub 저장소 설명과 README
- Hacker News 스레드 제목과 공개 댓글
- arXiv 논문 초록
- 긱뉴스 공개 요약

사내 문서·발표 자료·구성원 정보는 **전송되지 않습니다.** 그래도 사내 정책상
외부 학습 데이터 이용을 금지한다면 두 가지 선택지가 있습니다.

1. `sync-trend-openai.yml` 만 사용 (OpenAI API 는 기본적으로 학습에 미사용)
2. Gemini 를 유료 Tier 1 으로 전환 (결제 수단 등록 시 학습 미사용으로 전환)

---

## 5. 외부 GitHub 을 쓸 수 없다면

사내 정책상 github.com 사용이 어려운 경우의 대안입니다. 어느 쪽이든
`npm run sync:geeknews` / `npm run sync:trend` 를 돌리기만 하면 됩니다.

### A. 사내 서버 cron

```cron
# /etc/cron.d/ai-newsletter
0 7 * * * deploy cd /srv/ai-news-letter && /usr/bin/npm run sync:geeknews >> /var/log/ainl-geek.log 2>&1
10 7 * * * deploy cd /srv/ai-news-letter && /usr/bin/npm run sync:trend    >> /var/log/ainl-trend.log 2>&1
```

사내 프록시 환경이라면 `HTTP_PROXY` / `HTTPS_PROXY` 를 cron 환경에도 넣어 주세요.
스크립트가 이 값을 읽어 undici 디스패처를 설정합니다 (`src/lib/sync/proxy.ts`).

### B. Supabase pg_cron + Edge Function

수집 로직을 Edge Function 으로 옮기고 `pg_cron` 으로 호출합니다.
외부 인프라가 필요 없지만 Deno 환경에 맞춰 코드를 옮겨야 합니다.

### C. 관리자 화면에서 수동 실행

`/admin` 의 **최신 트렌드 정보 업데이트하기** 버튼으로 언제든 돌릴 수 있습니다.
다만 서버리스 함수의 최대 실행 시간(`maxDuration = 300`) 안에 끝나야 하므로,
신규 항목이 많으면 중간에 잘릴 수 있습니다. 정기 실행에는 A 나 B 가 낫습니다.

---

## 6. 문제 해결

| 증상 | 원인 / 조치 |
|---|---|
| `HTTP 403 — https://news.hada.io/` | UA 에 `bot` 이 들어가면 차단됩니다. `SYNC_USER_AGENT` 를 건드렸다면 되돌리세요 |
| `ConnectTimeoutError` | 프록시 환경. `HTTPS_PROXY` 를 설정하면 스크립트가 자동으로 적용합니다 |
| `429 Too Many Requests` (Gemini) | `LLM_MIN_CALL_INTERVAL_MS` 를 10000 이상으로 올리거나 `TREND_MAX_NEW` 를 줄이세요 |
| 수집은 되는데 저장이 0건 | 이미 있는 URL 입니다. `sync_runs.skipped_count` 를 확인하세요 (정상 동작) |
| `sync_runs` 가 `running` 에서 멈춤 | 함수/잡이 타임아웃으로 죽은 경우입니다. 다음 실행은 15분 뒤부터 다시 시작됩니다 |

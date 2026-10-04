# GitHub Actions 설정 가이드

동기화 워크플로 4개, 백업 워크플로 1개, 진단 워크플로 1개를 실제로 돌리기 위한 절차입니다.

| 워크플로 | 트리거 | LLM | 하는 일 |
|---|---|---|---|
| `sync-geeknews.yml` | 매일 07:00 · 11:30 KST (pg_cron) + 수동 | **없음** | news.hada.io 제목·요약 + **상세 본문** 수집 |
| `sync-trend-openai.yml` | 매일 07:10 · 11:40 KST (pg_cron) + 수동 | OpenAI | GitHub·HN·arXiv → 한국어 기사 |
| `sync-hada-show.yml` | 매일 07:20 · 11:50 KST (pg_cron) + 수동 | **없음** | news.hada.io/show — 직접 만든 것 소개 + 본문 |
| `sync-watchdog.yml` | GitHub schedule 하루 2회 + 수동 | **없음** | 회차가 빠졌으면 위 셋을 대신 깨우는 백업 |
| `sync-trend-gemini.yml` | **수동만** | Gemini | 같은 작업을 Gemini 로 |
| `probe-hada-topic.yml` | **수동만** | **없음** | 상세 페이지 한 장의 본문 추출을 진단 (DB·시크릿 불필요) |

**정시 실행은 GitHub 이 아니라 Supabase 가 시계를 쥡니다.** pg_cron 이 정해진 시각에
GitHub API 로 `workflow_dispatch` 를 보내고, 수집 워크플로 셋에는 `schedule` 이
없습니다. 이유와 켜는 법은 [4절](#4-정시-실행-켜기-supabase-pg_cron).

긱뉴스·쇼케이스는 목록을 적재한 뒤 상세 페이지를 열어 본문을 `hada_contents` 에
담습니다. 경계("함께 보면 좋은 글")가 리터럴 문자열이라 LLM 을 쓰지 않으므로
API 키가 추가로 필요하지 않습니다. 한 실행에서 받는 건수는
`HADA_CONTENT_MAX_PER_RUN`(기본 40)이 정하고, 요청 간 1.5초를 둡니다 —
그래서 두 워크플로의 `timeout-minutes` 를 20분으로 잡았습니다.

정기 실행을 OpenAI 가 맡고 있습니다. `GEMINI_API_KEY` 를 아직 등록하지 않았기
때문입니다. Gemini 로 넘기려면 Supabase 의 cron 잡 명령과 `ops.dispatch_sync_workflow`
의 허용 목록(`0022_sync_dispatch.sql`), `sync-watchdog.yml` 의 워크플로 이름을
`sync-trend-gemini.yml` 로 바꾸세요. **두 워크플로를 같이 정기 실행하면 안 됩니다** —
같은 URL 을 두고 경쟁하고(먼저 저장한 쪽이 이김) API 비용도 이중으로 나갑니다.

트렌드 브리핑은 `github,hn,arxiv` 세 출처를 모두 수집합니다 (스크립트 기본값).
긱뉴스는 `긱뉴스 동기화` 가 원문 그대로 담당하므로 트렌드 쪽에서는 제외했고,
필요하면 수동 실행에서 `only: geeknews` 로 지정할 수 있습니다. 1회 상한(30건)은
출처별로 번갈아 나눠 담기 때문에 GitHub 항목이 상한을 다 차지하지 않습니다.

회차마다 긱뉴스가 먼저(07:00 · 11:30) 돌고 트렌드(+10분) · 쇼케이스(+20분)가 나중에
도는 이유는 러너와 DB 접근이 겹치지 않게 하려는 것입니다. 특히 긱뉴스와 쇼케이스는 **같은
사이트**(news.hada.io)를 긁으므로, 같은 분에 두 잡이 동시에 요청하면 403 위험이
커집니다.

쇼케이스는 긱뉴스와 Secrets 를 그대로 공유합니다 — **추가로 등록할 것이 없습니다.**
데이터를 읽는 방법은 [SHOWCASE_QUERY.md](SHOWCASE_QUERY.md) 를 보세요.

---

## 1. 리포지터리 만들기 및 푸시

새로 세우는 경우에만 필요합니다.

```bash
gh repo create ai-news-letter --source=. --remote=origin   # --public 또는 --private
git push -u origin main
```

> `.env.local` 은 `.gitignore` 에 있어 커밋되지 않습니다.
> `.env.local.example` 만 올라갑니다. 저장소에는 키도 개인 정보도 들어가지 않습니다.

---

## 2. Secrets 등록

리포 → Settings → Secrets and variables → Actions → **New repository secret**

| 이름 | 필수 | 값 |
|---|:---:|---|
| `SUPABASE_URL` | ✅ | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase Project Settings → API 의 `service_role` 키. 표에 쓰는 것은 수집기뿐이라 **이 키는 여기에만** 둡니다 (Vercel · 앱에는 anon 키) |
| `OPENAI_API_KEY` | ✅ (정기 실행이 OpenAI) | https://platform.openai.com/api-keys |
| `GEMINI_API_KEY` | Gemini 워크플로를 쓸 때만 | https://aistudio.google.com/apikey |

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
| `OPENAI_MODEL` | `gpt-5.6-luna` | 모델 교체 시 |

---

## 3. 첫 실행 (수동)

Actions 탭 → 워크플로 선택 → **Run workflow**

권장 순서:

1. `긱뉴스 동기화` 를 `dry_run: true` 로 → 로그에서 파싱이 정상인지 확인
2. `긱뉴스 동기화` 를 그냥 실행 → 실제 적재
3. `트렌드 브리핑 동기화 (OpenAI)` 를 `dry_run: true` 로 → 수집 대상 확인 (LLM 호출 없음)
   로그의 `신규 N건 (github .. · hn .. · arxiv ..)` 줄에서 세 출처가 다 들어왔는지 봅니다
4. `트렌드 브리핑 동기화 (OpenAI)` 를 `limit: 5` 로 → 5건만 기사화해 품질 확인
5. `쇼케이스 동기화` 를 `dry_run: true` 로 → 로그에 제목·URL 이 찍히는지 확인
   `/show` 는 이번에 새로 붙인 수집기라 **이 단계가 셀렉터 실측 지점**입니다.
   0건이면 성공으로 넘어가지 않고 빨간 실패로 끝납니다
6. `쇼케이스 동기화` 를 그냥 실행 → 실제 적재. 한 번 더 돌려 `저장 0건` 이면
   중복 방지(멱등성)까지 확인된 것입니다
7. 결과가 괜찮으면 그대로 두면 다음날 07:00 부터 자동으로 돕니다

**본문 수집을 처음 켤 때는 0번을 먼저 하세요.**

0. `긱뉴스 상세 구조 진단` 을 토픽 URL 하나로 실행 → 로그에서
   `추출 결과 — status=ok` 와 본문 내용을 확인합니다.
   `status=parse_failed` 면 `src/lib/sync/sources/hada-topic.ts` 의
   `BODY_SELECTORS` 가 실제 마크업과 어긋난 것입니다. 같은 로그의
   **텍스트가 많은 요소** 목록에서 진짜 본문 컨테이너를 골라 그 배열에 넣으세요.
   쇼케이스 URL 로도 한 번 돌려 두 소스의 구조가 같은지 확인합니다.

   이 워크플로는 시크릿도 DB 도 쓰지 않으므로 아무 때나 돌려도 안전합니다.
   나중에 사이트 마크업이 바뀌어 `parse_failed` 가 늘 때도 여기서 다시 봅니다.

---

## 4. 정시 실행 켜기 (Supabase pg_cron)

### 왜 GitHub schedule 을 쓰지 않나

GitHub 의 `schedule` 은 큐 사정에 따라 밀립니다. 2026-09-25 ~ 10-04 실측으로
`0 22 * * *`(07:00 KST) 예약이 **09:24 ~ 10:57 KST 에 시작했습니다 — 2.5 ~ 4시간
지연.** 정각을 피한 `:10` · `:20` 예약도 똑같이 늦었습니다.

`workflow_dispatch` 는 그 큐를 타지 않고 바로 돕니다. 그래서 시계를 Supabase 의
`pg_cron` 에 두고, 정해진 시각에 GitHub API 로 "지금 돌려라" 만 보냅니다
(`supabase/migrations/0022_sync_dispatch.sql`).

| cron 잡 | KST | 워크플로 |
|---|---|---|
| `sync-geeknews-0700` · `sync-geeknews-1130` | 07:00 · 11:30 | `sync-geeknews.yml` |
| `sync-trend-0710` · `sync-trend-1140` | 07:10 · 11:40 | `sync-trend-openai.yml` |
| `sync-showcase-0720` · `sync-showcase-1150` | 07:20 · 11:50 | `sync-hada-show.yml` |

점심 회차는 12시 전에 끝나도록 11:30 에 시작합니다. 같은 URL 은 다시 저장되지 않으므로
(`ignoreDuplicates`) 아침 이후 새로 올라온 것만 그날 지면에 더해집니다. arXiv 는
09:00 KST 에 새 논문을 내므로 그날 논문은 점심 회차가 가져옵니다.

### 켜는 순서

1. **GitHub PAT 발급** — GitHub → Settings → Developer settings → Personal access
   tokens → **Fine-grained tokens** → Generate new token
   - Repository access: **Only select repositories** → 이 저장소 하나
   - Permissions → Repository permissions → **Actions: Read and write**
   - 만료일을 정하고 **달력에 적어 두세요.** 만료되면 정시 실행이 조용히 멈추고
     (아래 워치독이 늦게 대신 돌립니다) VERIFY ㉔ 에 401 이 찍힙니다.
2. **Vault 에 넣기** — Supabase 대시보드 → SQL Editor 에서

   ```sql
   select vault.create_secret('<PAT>', 'github_dispatch_token');
   select vault.create_secret('swpark3179/ai-news-letter', 'github_dispatch_repo');
   ```

   토큰을 바꿀 때는 `create_secret` 을 다시 부르지 말고(이름이 겹쳐 실패합니다)

   ```sql
   select vault.update_secret(
     (select id from vault.secrets where name = 'github_dispatch_token'),
     '<새 PAT>');
   ```
3. **0022 적용** — `supabase/migrations/0022_sync_dispatch.sql` 을 SQL Editor 에서 Run.
   pg_cron · pg_net 확장을 켜고 잡 6개를 등록합니다. 여러 번 돌려도 같은 상태가 됩니다.
   비밀값을 넣기 전에 돌려도 됩니다 — 그동안은 잡이 경고만 남기고 아무것도 보내지 않습니다.
4. **확인** — 한 번 손으로 깨워 봅니다.

   ```sql
   select ops.dispatch_sync_workflow('sync-geeknews.yml');
   ```

   몇 초 뒤 Actions 탭에 `workflow_dispatch` 로 `긱뉴스 동기화` 가 떠야 합니다.
   `supabase/VERIFY.sql` 의 ㉒~㉕ 로 잡 · 실행 이력 · GitHub 응답(204) · 비밀값을 봅니다.

### 백업 — `sync-watchdog.yml`

pg_cron 의 호출이 끊기면(토큰 만료, 비밀값 누락, Supabase 장애) 아무도 수집을 돌리지
않습니다. 워치독은 GitHub `schedule` 로 회차 40분 뒤(22:40 · 03:10 UTC)에 예약돼
있고 — 실제로는 2~4시간 늦게 돕니다 — 가장 최근 회차가 시작된 뒤로 `sync_runs` 에
성공 기록이 없는 수집만 `gh workflow run` 으로 깨웁니다. dry-run · preview 는
`sync_runs` 에 쓰지 않으므로 "돌았다" 로 잘못 세지 않습니다.

수동 실행에서 `dry_run: true` 로 두면 판정만 하고 깨우지 않습니다.

---

## 5. 알아 둘 제약

### 수집 워크플로에 schedule 을 달지 말 것

공개 저장소에서 `schedule` 이 걸린 워크플로는 **60일간 커밋이 없으면 GitHub 이 통째로
끕니다.** 꺼진 워크플로는 `workflow_dispatch` 도 받지 않으므로, 수집 워크플로에
`schedule` 이 있으면 pg_cron 의 호출까지 같이 죽습니다. 그래서 `schedule` 은
`sync-watchdog.yml` 한 곳에만 둡니다 — 그게 꺼져도 잃는 것은 백업뿐입니다. 꺼졌다면
Actions 탭의 안내 배너에서 다시 켜세요.

### Gemini 무료 티어 할당량

`gemini-2.5-flash` 기준 **10 RPM / 500 RPD** 입니다 (2026-08 기준).
워크플로는 호출 간 7초 간격(`LLM_MIN_CALL_INTERVAL_MS=7000`)을 두고, 5건씩 묶어
보냅니다. 신규 30건이면 6회 호출 ≈ 42초라 여유가 충분합니다.

정기 실행은 OpenAI 가 맡고 있으므로 이 한도는 `sync-trend-gemini.yml` 을 수동으로
돌릴 때만 걸립니다.

### 무료 티어의 데이터 이용 정책

Google AI Studio **무료 티어는 입력이 Google 제품 개선에 사용될 수 있습니다.**

이 파이프라인이 LLM 에 보내는 것은 공개 웹 콘텐츠뿐입니다.

- GitHub 저장소 설명과 README
- Hacker News 스레드 제목과 공개 댓글
- arXiv 논문 초록
- 긱뉴스 공개 요약

그 밖의 것은 **전송되지 않습니다.** 그래도 외부 학습 데이터 이용을 피하고 싶다면
두 가지 선택지가 있습니다.

1. `sync-trend-openai.yml` 만 사용 (OpenAI API 는 기본적으로 학습에 미사용) — 현재 구성
2. Gemini 를 유료 Tier 1 으로 전환 (결제 수단 등록 시 학습 미사용으로 전환)

---

## 6. GitHub Actions 대신 돌리려면

어느 쪽이든 `npm run sync:geeknews` · `npm run sync:trend` · `npm run sync:showcase` 를
돌리기만 하면 됩니다. 필요한 환경변수는 2절의 Secrets 와 같습니다.

### A. 서버 cron

```cron
# /etc/cron.d/ai-newsletter  (서버 시간대가 KST 라고 가정)
0 7 * * *     deploy cd /srv/ai-news-letter && /usr/bin/npm run sync:geeknews >> /var/log/ainl-geek.log 2>&1
10 7 * * *    deploy cd /srv/ai-news-letter && /usr/bin/npm run sync:trend    >> /var/log/ainl-trend.log 2>&1
20 7 * * *    deploy cd /srv/ai-news-letter && /usr/bin/npm run sync:showcase >> /var/log/ainl-show.log 2>&1
30 11 * * *   deploy cd /srv/ai-news-letter && /usr/bin/npm run sync:geeknews >> /var/log/ainl-geek.log 2>&1
40 11 * * *   deploy cd /srv/ai-news-letter && /usr/bin/npm run sync:trend    >> /var/log/ainl-trend.log 2>&1
50 11 * * *   deploy cd /srv/ai-news-letter && /usr/bin/npm run sync:showcase >> /var/log/ainl-show.log 2>&1
```

프록시 환경이라면 `HTTP_PROXY` / `HTTPS_PROXY` 를 cron 환경에도 넣어 주세요.
스크립트가 이 값을 읽어 undici 디스패처를 설정합니다 (`src/lib/proxy.ts`).

### B. Supabase pg_cron + Edge Function

4절의 pg_cron 은 시계만 맡고 수집은 여전히 GitHub Actions 러너가 합니다. 수집 로직
자체를 Edge Function 으로 옮기면 러너도 필요 없지만, Deno 환경에 맞춰 코드를 옮겨야
하고 함수 실행 시간 제한(트렌드 1회 4~7분)에 걸립니다.

---

## 7. 문제 해결

| 증상 | 원인 / 조치 |
|---|---|
| `HTTP 403 — https://news.hada.io/` | UA 에 `bot` 이 들어가면 차단됩니다. `SYNC_USER_AGENT` 를 건드렸다면 되돌리세요 |
| `ConnectTimeoutError` | 프록시 환경. `HTTPS_PROXY` 를 설정하면 스크립트가 자동으로 적용합니다 |
| `429 Too Many Requests` (Gemini) | `LLM_MIN_CALL_INTERVAL_MS` 를 10000 이상으로 올리거나 `TREND_MAX_NEW` 를 줄이세요 |
| `HTTP 429 — http://export.arxiv.org/api/query…` | arXiv 는 IP 단위로 요청량을 잽니다(러너 IP 는 공유). `Retry-After` 재시도 → `rss.arxiv.org` RSS 대체 → 그래도 안 되면 arXiv 만 빼고 진행합니다. 로그에 `수집하지 못한 출처: arxiv` 경고가 뜨면 그 날치 논문만 빠진 것이라 다음 실행에서 따라잡습니다. 차단이 계속되면 `ARXIV_USER_AGENT` 에 연락처를 넣어 두세요 |
| 수집은 되는데 저장이 0건 | 이미 있는 URL 입니다. `sync_runs.skipped_count` 를 확인하세요 (정상 동작) |
| 특정 출처만 들어온다 | `only` 입력값을 확인하세요. 비워 두면 `github,hn,arxiv` 세 출처를 모두 돌고 상한은 출처별로 나눠 담습니다 |
| 07:00 · 11:30 에 Actions 실행이 생기지 않는다 | VERIFY ㉔ 의 `status_code` 를 보세요. 401 은 PAT 만료 · 오타, 403 은 권한(Actions: Read and write) 부족, 404 는 `github_dispatch_repo` 오타, 422 는 main 에 워크플로가 없는 것. 응답이 아예 없으면 ㉒ ㉓ 으로 잡이 등록 · 실행됐는지 봅니다 |
| 정시 실행이 안 됐는데 워치독도 안 돈다 | 워치독은 GitHub schedule 이라 2~4시간 늦습니다. 60일 무커밋으로 꺼졌으면 Actions 탭 배너에서 다시 켜세요 (5절) |
| `sync_runs` 가 `running` 에서 멈춤 | 함수/잡이 타임아웃으로 죽은 경우입니다. 다음 실행은 15분 뒤부터 다시 시작됩니다 |

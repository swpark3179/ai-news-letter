# 운영 DB 에만 있는 것

`migrations/` 를 처음부터 돌려 만든 DB 와 운영 DB(`ai-news-letter`)는 같지 않습니다.
아래는 **운영 DB 에는 있는데 이 저장소의 마이그레이션 어디에도 정의가 없는**
객체들입니다. 2026-10-01 에 카탈로그를 직접 조회해 만든 목록입니다.

새 프로젝트를 이 저장소로 세우면 여기 있는 것은 하나도 생기지 않습니다. 그래도
웹·앱·수집기가 모두 정상으로 돕니다 — 셋 다 이 객체들을 쓰지 않습니다.

## A. 모바일 로그인 시절의 잔재 — 5단계에서 지운다

모바일 앱이 Google · Apple 로그인을 하던 때 만들어졌고, 정의는 모바일 저장소에서
걷어 낸 뒤 어디에도 남지 않았습니다. 앱은 로그인을 전면 제거했고, 아래 표는 모두
**0행**이라 기다릴 사용자도 없습니다.

| 종류 | 이름 |
|---|---|
| 표 | `allowed_social_identities` · `member_auth_accounts` (`auth.users` 를 FK 로 참조) |
| 열 · 인덱스 | `members.oauth_sign_key` · `members_oauth_sign_key_uidx` |
| security definer 함수 | `current_member_id()` · `is_active_member()` · `mobile_resolve_member()` · `mobile_match_member(uuid)` · `mobile_member_json(uuid, uuid)` · `mobile_link_member_by_emp_no(text)` · `mobile_link_member_by_sign_key(text)` · `mobile_clear_scraps()` · `mobile_delete_account()` |

함수 9개는 anon 이 실행할 수 있었던 것을 `0018` 이 닫았습니다. 표와 함께 5단계에서
지웁니다. Supabase Auth 에 남은 사용자 1명과 Google · Apple 공급자 설정도 그때
대시보드에서 정리합니다.

## B. 외부 수집기(collector) — 쓰지 않음, 검토 대기

LLM(`fabrix` 공급자)으로 긱뉴스 · 쇼케이스 요약을 다시 쓰고 트렌드를 적재하던
별도 수집기가 RPC 로 쓰던 것들입니다. 코드는 이 저장소에도 모바일 저장소에도
없습니다. 마지막 흔적은 `collector_receipts` 의 9/4 기록 2건과 `sync_runs` 의
9/7 실패 2건(`provider = 'fabrix'`)입니다.

**지금은 쓰지 않지만 다시 검토하기로 해서 그대로 둡니다.** 5단계의 삭제 대상이
아닙니다.

| 종류 | 이름 |
|---|---|
| 표 | `collector_receipts` · `collector_transfers` · `collector_trend_pending` |
| 함수 (invoker, service_role 만 실행) | `collector_preflight()` · `collector_topic_key(text)` · `collector_external_key(text)` · `collector_body_due(text)` · `collector_probe_hada(text, jsonb)` · `collector_put_body(text, text, jsonb)` · `collector_retry_hada(text, integer)` · `collector_save_hada(...)` · `collector_save_trend(...)` |
| `geek_news` · `showcase_items` 의 열 | `raw_summary` · `summary_status`(not null, 기본 `'legacy'`) · `llm_provider` · `llm_model` · `prompt_hash` · `summarized_at` · `summary_error` · `topic_key`(생성 열) · `normalized_external_url`(생성 열) |
| 같은 두 표의 인덱스 · 제약 | `*_collector_topic_idx` · `*_collector_external_idx` · `*_summary_status_check` |
| `trend_items` 의 열 | `source_context` · `prompt_hash` · `summarized_at` |
| 넓혀진 CHECK | `trend_items_llm_provider_check` · `sync_runs_provider_check` 가 `'fabrix'` 를 허용 (저장소 정의는 `gemini` · `openai` 뿐) |

이 저장소의 수집기는 위 열을 읽지도 쓰지도 않습니다. `summary_status` 는 기본값이
있어 적재에 지장이 없습니다.

> ⚠️ **나중에 지울 때 `cascade` 를 쓰지 마세요.** `topic_key` 와
> `normalized_external_url` 은 `collector_topic_key()` · `collector_external_key()`
> 로 계산되는 **생성 열**입니다. `drop function ... cascade` 를 하면 이 두 열과
> 그 위의 인덱스가 아무 경고 없이 함께 사라집니다. 순서는 인덱스 → 생성 열 →
> 함수 → 표입니다.

## C. 저장소에 정의가 있지만 더는 쓰지 않는 것 — 5단계에서 지운다

참고로 함께 적습니다. 2단계에서 웹의 로그인 · 관리자 · 기사 · 댓글 · 모임 · 업로드를
걷어 내면 아래를 읽거나 쓰는 코드가 없어집니다.

| 표 | 만든 마이그레이션 | 2026-10-01 행 수 |
|---|---|---|
| `members` | 0002 · 0012 | 5 |
| `articles` · `article_sources` · `comments` | 0003 | 2 · 1 · 0 |
| `meetings` · `meeting_attendees` · `rotations` · `scraps` | 0004 | 0 · 0 · 8 · 0 |
| `attachments` | 0005 | 0 |
| `member_google_identities` · `member_refresh_tokens` | 0010 | 0 · 0 |
| `member_apple_identities` | 0011 | 0 |

Storage 의 `newsletter` 버킷(파일 0개)도 같은 때 지웁니다.

**남기는 것:** `geek_news` · `showcase_items` · `trend_items` · `hada_contents` ·
`app_settings`(`mobile_issue` 가 `issue_no` 를 읽는다) · `sync_runs`(수집 실행 기록) ·
모바일 뷰 5개.

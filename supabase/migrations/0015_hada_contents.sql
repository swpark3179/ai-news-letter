-- 0015_hada_contents.sql
-- 긱뉴스 / 쇼케이스 상세 페이지 **본문** 적재
--
--   목록 수집(0003, 0014)은 제목과 요약만 담는다. 앱은 news.hada.io 로 링크를
--   열어 줬는데, 그 페이지에 광고가 섞여 읽기 불편하다는 요구가 있었다.
--   그래서 상세 페이지에서 본문만 긁어 여기에 담고, 앱은 이 값을 보여 준다.
--
--   저장 범위 — 상세 페이지는 `제목 → 작성자 → 본문 → "함께 보면 좋은 글"`
--   순서다. 그 문구 **이전까지**의 본문을 마크다운으로 담는다. 경계가 리터럴
--   문자열이라 DOM 절단으로 정확히 끊을 수 있고, 그래서 LLM 을 쓰지 않는다
--   (요약이 아니라 원문 이관이므로 모델을 태우면 비용과 변형 위험만 는다).
--
--   왜 별도 테이블인가 —
--     1) geek_news / showcase_items 는 목록 조회용으로 계속 얇아야 한다.
--        getGeekNews() 가 select('*') + limit 60 이라, 본문을 그 테이블에 넣으면
--        목록 한 번 그릴 때마다 본문 60건을 통째로 끌어오게 된다.
--     2) 두 소스의 상세 페이지 구조가 같아 추출 코드가 하나다. 저장소도 하나로
--        두고 source 로만 구분하면 백필·재시도 로직이 한 벌로 끝난다.
--
--   PK 는 두 목록 테이블과 같은 값(토픽 URL)이다. 부모가 둘이라 단일 FK 로
--   표현할 수 없어 FK 는 걸지 않는다 — url 생성 규칙이 양쪽에서 동일하므로
--   PK 만으로 조인이 성립한다.
--
--   용량 — 본문 평균 ~1.2천자(한글 UTF-8 3바이트) ≈ 4KB/행, 하루 35건이면
--   연 12,775행 ≈ 원시 50MB. 2KB 를 넘는 text 는 Postgres 가 TOAST 로 자동
--   압축하므로 실제 디스크는 연 20~25MB 수준이다. body_chars 로 이상치를
--   언제든 찾을 수 있고, 최악의 경우도 수집기의 20,000자 상한에 묶인다.

create table if not exists public.hada_contents (
  url            text primary key,   -- geek_news.url / showcase_items.url 과 같은 값

  source         text not null check (source in ('geeknews', 'showcase')),

  body_md        text not null default '',      -- "함께 보면 좋은 글" 이전까지의 본문
  body_chars     integer not null default 0,    -- char_length(body_md) — 이상치 추적용
  truncated      boolean not null default false,-- 상한에 걸려 잘렸는지

  -- 수집 상태.
  --   ok           본문을 얻었다
  --   empty        컨테이너는 찾았는데 본문이 사실상 비어 있다
  --   parse_failed 본문 컨테이너를 못 찾았다 (마크업 변경 의심)
  --   fetch_failed HTTP 실패 / 타임아웃
  -- 실패를 빈 문자열로 뭉개지 않고 상태로 남긴다. 목록 파서의 EmptyListError 와
  -- 같은 이유 — "본문이 원래 없다"와 "셀렉터가 깨졌다"는 구분되어야 한다.
  status         text not null default 'ok'
                 check (status in ('ok', 'empty', 'parse_failed', 'fetch_failed')),

  container      text,     -- 어떤 셀렉터로 뽑았는지. 마크업 드리프트를 조기에 본다.
  attempts       integer not null default 0,   -- 실패 누적 횟수 (상한을 넘으면 포기)
  last_error     text,

  content_hash   text,     -- md5(body_md) — 재수집 시 내용 변경 감지
  fetched_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table  public.hada_contents            is 'news.hada.io 상세 페이지 본문. PK = 토픽 URL (geek_news / showcase_items 와 동일).';
comment on column public.hada_contents.url        is 'geek_news.url 또는 showcase_items.url 과 같은 값. FK 는 부모가 둘이라 걸지 않는다.';
comment on column public.hada_contents.source     is 'geeknews | showcase — 어느 목록에서 온 항목인지';
comment on column public.hada_contents.body_md    is '"함께 보면 좋은 글" 직전까지의 본문을 마크다운으로. 요약이 아니라 원문 그대로다.';
comment on column public.hada_contents.status     is 'ok | empty | parse_failed | fetch_failed — 실패를 빈 본문으로 뭉개지 않는다';
comment on column public.hada_contents.container  is '본문을 뽑아낸 CSS 셀렉터. 마크업이 바뀌면 여기서 먼저 드러난다.';
comment on column public.hada_contents.attempts   is '실패 누적 횟수. 수집기가 상한을 넘긴 행은 더 시도하지 않는다.';

-- ---------------------------------------------------------------------------
-- 인덱스
--
--   조회는 PK(url) 단건이 대부분이라 별도 인덱스가 필요 없다. 다만 백필이
--   "아직 성공하지 못한 행"을 훑으므로, 그 부분만 부분 인덱스로 덮는다.
--   status = 'ok' 인 행이 절대다수가 될 것이므로 인덱스는 아주 작게 유지된다.
-- ---------------------------------------------------------------------------
create index if not exists hada_contents_retry_idx
  on public.hada_contents (source, attempts)
  where status <> 'ok';

-- ---------------------------------------------------------------------------
-- RLS — 0007_rls.sql / 0014_showcase.sql 방침 그대로 "켜고 정책은 두지 않는다".
--   service_role(서버)만 접근하고 anon / authenticated 는 전부 거부된다.
--   모바일 앱에 본문을 열어 주는 뷰는 화면 설계가 끝난 뒤 따로 추가한다.
-- ---------------------------------------------------------------------------
alter table public.hada_contents enable row level security;

revoke all on public.hada_contents from anon, authenticated;

-- 0005_ops.sql
-- 운영 : 동기화 실행 로그, 분할 암호화 업로드 이력.

-- ---------------------------------------------------------------------------
-- sync_runs : 수집 파이프라인 실행 기록
--   관리자 화면의 pipeline.log 콘솔(디자인 722~736행)이 이 테이블을 읽는다.
-- ---------------------------------------------------------------------------
create table if not exists public.sync_runs (
  id             uuid primary key default gen_random_uuid(),

  kind           text not null check (kind in ('geeknews', 'trend')),
  provider       text check (provider in ('gemini', 'openai')),   -- geeknews 는 null
  trigger        text not null default 'manual'
                 check (trigger in ('schedule', 'manual', 'admin_ui')),

  status         text not null default 'running'
                 check (status in ('running', 'success', 'failed')),

  started_at     timestamptz not null default now(),
  finished_at    timestamptz,

  fetched_count  integer not null default 0,   -- 원문에서 긁어온 총 건수
  new_count      integer not null default 0,   -- 기존 PK 와 겹치지 않은 신규 건수
  inserted_count integer not null default 0,   -- 실제 저장된 건수
  skipped_count  integer not null default 0,   -- 중복/기간 밖으로 건너뛴 건수

  -- [{ "at": "07:12:04", "level": "info"|"warn"|"error"|"done", "msg": "..." }]
  logs           jsonb not null default '[]'::jsonb,
  error          text
);

comment on table  public.sync_runs      is '긱뉴스/트렌드 동기화 실행 기록. 관리자 콘솔의 pipeline.log 원천.';
comment on column public.sync_runs.logs is '진행 로그 배열 — 관리자 화면이 폴링해 콘솔에 렌더';

-- ---------------------------------------------------------------------------
-- attachments : 발표 자료 분할 암호화 업로드
--   사내 정책상 1회 전송 최대 10MB → 클라이언트에서 조각내 AES-256-GCM 으로
--   암호화 전송하고, 서버가 복호화해 Storage 에 합친다.
-- ---------------------------------------------------------------------------
create table if not exists public.attachments (
  id               uuid primary key default gen_random_uuid(),
  article_id       uuid references public.articles (id) on delete cascade,

  file_name        text not null,
  mime_type        text,
  size_bytes       bigint not null,

  chunk_size_bytes integer not null,
  chunk_count      integer not null,
  received_chunks  integer not null default 0,

  status           text not null default 'pending'
                   check (status in ('pending', 'uploading', 'assembling', 'stored', 'failed')),

  storage_path     text,
  uploaded_by      uuid references public.members (id) on delete set null,
  error            text,

  -- 이 업로드 전용 AES-256-GCM 키(base64). 서버가 생성해 HTTPS 로 클라이언트에
  -- 내려주고, 조각을 복호화하는 데 쓴다. 업로드가 끝나면 null 로 지운다.
  -- 이 테이블은 RLS 로 잠겨 있어 service_role 만 읽을 수 있다.
  encryption_key   text,

  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

comment on table  public.attachments        is '발표 자료 분할 암호화 업로드 이력 (10MB 전송 한도 대응)';
comment on column public.attachments.status is 'pending → uploading → assembling → stored / failed';
comment on column public.attachments.encryption_key is '업로드 진행 중에만 보관하는 임시 AES 키. 완료 시 null 로 지운다.';

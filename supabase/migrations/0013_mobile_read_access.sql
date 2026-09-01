-- 0013_mobile_read_access.sql
-- 모바일 앱이 읽을 뷰 3개와 anon 권한.
--
-- ---------------------------------------------------------------------------
-- 0007_rls.sql 의 방침을 여기서 한 걸음 넓힌다
-- ---------------------------------------------------------------------------
-- 0007 은 "RLS 를 켜고 정책은 하나도 만들지 않는" 구성이었다. 브라우저에 Supabase
-- 키를 내려보내지 않고 모든 접근을 Next.js 서버가 service_role 로 대신하기 때문이다.
-- 그 파일의 마지막 줄이 이 변경을 예고해 두었다 —
--   "나중에 클라이언트 직접 조회가 필요해지면 그때 select 정책을 명시적으로 추가한다."
--
-- 모바일 앱이 그 경우다. 앱은 웹 API 를 거치지 않고 PostgREST 를 직접 읽는다.
-- 앱 바이너리에는 anon 키가 실린다(그것이 anon 키의 설계다). 따라서 안전성은
-- 전적으로 아래 grant 구성에서 나온다.
--
-- **테이블이 아니라 뷰만 연다.** 두 가지 이유다.
--
--   ① 쿼리 표면을 좁힌다. 테이블에 grant 하면 PostgREST 가 그 테이블의 모든
--      컬럼·필터·정렬을 열어 준다. 뷰만 열면 노출 범위가 뷰 정의로 고정된다.
--      숨긴 콘텐츠 필터(is_hidden / status)도 뷰 안에 박혀 있어 우회할 길이 없다.
--
--   ② 목록의 지표 문구(meta)를 SQL 이 만들어 내려보낸다. 이 규칙을 클라이언트로
--      옮겨 적으면 규칙이 두 벌이 되고, 그건 이미 한 번 어긋난 지점이다.
--      정본은 웹의 src/lib/trendItem.ts 의 metricOf() / metaTextOf() 다.
--
--      웹과 일부러 다르게 둔 곳이 하나 있다. metrics 의 값이 숫자가 아니면
--      (예: comments 에 문자열이 들어오면) 웹은 그 값을 그대로 이어 붙이지만
--      여기서는 지표를 비운다. 수집 스크립트가 숫자만 넣으므로 실제로는 생기지
--      않는 경우이고, 생겼다면 화면에 이상한 문구를 내보내는 것보다 비우는 편이 낫다.
--
-- 뷰는 security_invoker 를 켜지 않는다(기본값). 소유자 권한으로 돌아야 anon 이
-- 뷰를 읽어도 밑에 있는 테이블의 RLS 를 건드리지 않는다.
--
-- 열리는 것: mobile_feed · mobile_trend_detail · mobile_issue (SELECT 만)
-- 닫힌 채로 남는 것: 원본 테이블 전부, members · scraps · articles · comments
--
-- 앱이 거는 질의는 mobile/docs/03-api-contract.md 에 적어 두었다.
-- ---------------------------------------------------------------------------

-- 컬럼 구성이 바뀌어도 다시 실행할 수 있도록 지우고 만든다.
drop view if exists public.mobile_feed;
drop view if exists public.mobile_trend_detail;
drop view if exists public.mobile_issue;

-- ---------------------------------------------------------------------------
-- mobile_feed : 목록 화면 전부를 덮는 하나의 뷰
--
--   긱뉴스와 트렌드를 같은 모양으로 정규화한 union 이다. 홈은 이 뷰를 그대로
--   시간 역순으로 읽고, 긱뉴스 탭·트렌드 탭은 type/source 필터만 더한다.
--
--   union 을 뷰 안에서 해 두는 것이 핵심이다. 앱이 두 테이블을 따로 읽어 합치면
--   커서가 서로 다른 시간축(geek=published_at, trend=collected_at)을 하나로
--   다루게 되고, 그 지점에서 항목이 조용히 사라진다.
--
--   published_at 의 의미:
--     geek  — 긱뉴스 목록의 <time datetime> (원문 게시 시각)
--     trend — collected_at. trend_items 에는 원문 발행일 컬럼이 없다.
-- ---------------------------------------------------------------------------
create view public.mobile_feed as
select
    'geek'::text                                   as type,
    g.url                                          as key,
    null::text                                     as source,
    null::text                                     as repo,
    g.title                                        as title,
    g.summary                                      as lede,
    -- 디자인 규칙: "github.com · 42 points · 댓글 12"
    concat_ws(' · ',
      nullif(btrim(coalesce(g.source_domain, '')), ''),
      g.points || ' points',
      '댓글 ' || g.comment_count
    )                                              as meta,
    g.published_at                                 as published_at,
    -- 원문 사이트(external_url)가 아니라 긱뉴스 토픽 URL 을 연다. 요약과 댓글이
    -- 거기 있고, 이 값이 곧 담기 키다.
    g.url                                          as open_url,
    coalesce(g.source_domain, '')                  as host,
    null::text                                     as public_id,
    null::text                                     as source_variant,
    concat_ws(' ', g.title, g.summary)             as search_text
  from public.geek_news g
  where g.is_hidden = false

union all

select
    'trend'::text,
    t.source_url,
    t.source,
    -- 저장소 이름이 AI 헤드라인보다 눈에 빨리 들어와 제목 자리를 가져간다.
    -- raw_title 이 비어도 PK 가 https://github.com/{owner}/{repo} 라 복구할 수 있다.
    case
      when t.source <> 'github' then null
      else coalesce(
        nullif(btrim(coalesce(t.raw_title, '')), ''),
        nullif(regexp_replace(t.source_url, '^https?://github\.com/|/+$', '', 'g'), t.source_url)
      )
    end,
    t.title,
    coalesce(t.deck, ''),
    -- "★ 4,812 this week · Python" / "412 comments" / "arXiv:2608.01234"
    concat_ws(' · ', m.metric, nullif(btrim(coalesce(m.language, '')), '')),
    t.collected_at,
    t.source_url,
    coalesce(substring(t.source_url from '^https?://([^/?#]+)'), ''),
    t.public_id,
    t.source_variant,
    concat_ws(' ', t.title, t.deck, t.raw_title, array_to_string(t.tags, ' '))
  from public.trend_items t
  -- metrics 는 jsonb 라 어떤 값이든 들어올 수 있다. 숫자인지 먼저 확인하고 꺼낸다 —
  -- 한 행의 이상한 값 때문에 목록 전체가 죽으면 안 된다.
  cross join lateral (
    select
      t.metrics ->> 'language' as language,
      case t.source
        when 'github' then
          case
            when coalesce(
                   case when jsonb_typeof(t.metrics -> 'stars_in_period') = 'number'
                        then nullif((t.metrics ->> 'stars_in_period')::bigint, 0) end,
                   case when jsonb_typeof(t.metrics -> 'stars') = 'number'
                        then nullif((t.metrics ->> 'stars')::bigint, 0) end
                 ) is null then null
            else '★ '
              || btrim(to_char(
                   coalesce(
                     case when jsonb_typeof(t.metrics -> 'stars_in_period') = 'number'
                          then nullif((t.metrics ->> 'stars_in_period')::bigint, 0) end,
                     case when jsonb_typeof(t.metrics -> 'stars') = 'number'
                          then nullif((t.metrics ->> 'stars')::bigint, 0) end
                   ), 'FM999,999,999,999'))
              || ' '
              || case t.source_variant
                   when 'weekly'  then 'this week'
                   when 'monthly' then 'this month'
                   else 'today'
                 end
          end
        when 'hn' then
          case when jsonb_typeof(t.metrics -> 'comments') = 'number'
                 and nullif((t.metrics ->> 'comments')::bigint, 0) is not null
               then (t.metrics ->> 'comments') || ' comments' end
        when 'arxiv' then
          case when nullif(btrim(coalesce(t.metrics ->> 'arxiv_id', '')), '') is not null
               then 'arXiv:' || btrim(t.metrics ->> 'arxiv_id') end
        when 'geeknews' then
          case when jsonb_typeof(t.metrics -> 'points') = 'number'
                 and nullif((t.metrics ->> 'points')::bigint, 0) is not null
               then (t.metrics ->> 'points') || ' points' end
      end as metric
  ) m
  where t.status = 'published';

comment on view public.mobile_feed is
  '모바일 목록용. geek_news + trend_items 를 FeedItem 모양으로 정규화한 union. anon SELECT 허용.';

-- ---------------------------------------------------------------------------
-- mobile_trend_detail : 트렌드 상세
--
--   body(jsonb) 와 tags 는 목록 질의에 실리면 무거우므로 mobile_feed 와 나눈다.
-- ---------------------------------------------------------------------------
create view public.mobile_trend_detail as
select
    t.source_url                                   as key,
    t.source                                       as source,
    t.public_id                                    as public_id,
    case
      when t.source <> 'github' then null
      else coalesce(
        nullif(btrim(coalesce(t.raw_title, '')), ''),
        nullif(regexp_replace(t.source_url, '^https?://github\.com/|/+$', '', 'g'), t.source_url)
      )
    end                                            as repo,
    t.source_variant                               as source_variant,
    t.title                                        as title,
    coalesce(t.deck, '')                           as deck,
    coalesce(t.raw_title, '')                      as raw_title,
    coalesce(substring(t.source_url from '^https?://([^/?#]+)'), '') as host,
    t.collected_at                                 as collected_at,
    t.llm_model                                    as llm_model,
    t.body                                         as body,
    t.tags                                         as tags
  from public.trend_items t
  where t.status = 'published';

comment on view public.mobile_trend_detail is
  '모바일 트렌드 상세. trend_items.body 를 그대로 내보낸다. anon SELECT 허용.';

-- ---------------------------------------------------------------------------
-- mobile_issue : 홈 마스트헤드 (항상 한 행)
--
--   건수 기준은 웹의 countGeekNewsToday() / countTrendToday() 와 같은
--   collected_date(KST) 다. 원문 발행일이 불명확한 출처가 섞여 있어 "오늘 몇 건을
--   퍼왔나"가 유일하게 말이 되는 셈법이다.
--
--   한 가지는 웹과 일부러 다르다: 웹의 두 함수는 is_hidden / status 를 보지 않지만
--   여기서는 건다. 이 숫자 바로 아래에 그 목록이 붙으므로, 목록에 없는 것을 세면
--   "긱뉴스 8" 아래에 7건이 보이는 일이 생긴다.
-- ---------------------------------------------------------------------------
create view public.mobile_issue as
select
    coalesce(s.issue_no, 1)                        as issue_no,
    coalesce(greatest(f.latest_geek, f.latest_trend), now()) as date,
    coalesce(c.geek_count, 0)                      as geek_count,
    coalesce(c.trend_count, 0)                     as trend_count
  from (
    select case when jsonb_typeof(value) = 'number' then (value #>> '{}')::int end as issue_no
      from public.app_settings
     where key = 'issue_no'
  ) s
  full join (
    select
      (select max(published_at) from public.geek_news   where is_hidden = false)     as latest_geek,
      (select max(collected_at) from public.trend_items where status = 'published')  as latest_trend
  ) f on true
  full join (
    select
      (select count(*) from public.geek_news
        where is_hidden = false
          and collected_date = (timezone('Asia/Seoul', now()))::date)                as geek_count,
      (select count(*) from public.trend_items
        where status = 'published'
          and collected_date = (timezone('Asia/Seoul', now()))::date)                as trend_count
  ) c on true;

comment on view public.mobile_issue is
  '모바일 홈 마스트헤드 — 호수·최신 시각·오늘(KST) 건수. 항상 한 행. anon SELECT 허용.';

-- ---------------------------------------------------------------------------
-- 권한
--
--   0007 이 anon 에게서 모든 권한을 회수했으므로, 이 세 줄이 anon 이 가진 권한의
--   전부가 된다. 나중에 뷰를 더 만들더라도 여기에 명시적으로 적기 전까지는
--   열리지 않는다 — grant 를 스키마 단위로 주지 않는 이유다.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon;
grant select on public.mobile_feed         to anon;
grant select on public.mobile_trend_detail to anon;
grant select on public.mobile_issue        to anon;

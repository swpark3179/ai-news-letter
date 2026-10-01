-- 0019_web_read_columns.sql
-- 웹도 앱과 같은 뷰를 anon 키로 읽는다. 그러려고 웹 지면에 필요한 열을 뷰 끝에 덧붙인다.
--
-- ---------------------------------------------------------------------------
-- 왜 웹이 뷰를 읽는가
-- ---------------------------------------------------------------------------
-- 지금까지 웹은 service_role 키로 표를 직접 읽었고, 「숨긴 글은 빼고」 · 「공개된
-- 트렌드만」 같은 규칙을 웹 코드(src/lib/data/content.ts)와 뷰 정의가 따로 들고
-- 있었다. 실제로 둘이 달랐다 — 웹은 status = 'review' 인 트렌드도 상세 화면에서
-- 보여 줬고, 오늘 건수에 숨긴 긱뉴스까지 셌다.
--
-- 이제 웹도 0013 · 0016 · 0017 의 뷰를 anon 키로 읽는다. 무엇이 보이는지는 뷰 정의
-- 한 곳이 정하고, 웹 배포에는 service_role 키가 필요 없다 (그 키는 GitHub Actions 의
-- 수집기에만 남는다). 목록 행의 지표 문구(meta) 도 SQL 이 만드는 것 하나만 쓴다 —
-- 웹 쪽 사본(src/lib/trendItem.ts)은 지운다.
--
-- ---------------------------------------------------------------------------
-- 덧붙이는 열
-- ---------------------------------------------------------------------------
--   mobile_feed          collected_date · score · origin_url
--   mobile_showcase      collected_date · score
--   mobile_trend_detail  collected_date · origin_url
--
--   collected_date  수집한 날(KST). 웹 1면이 「그날 들어온 것」을 한 장으로 묶는 기준이다.
--                   published_at 은 긱뉴스에서 원문 게시 시각이라 날짜가 어긋난다.
--   score           같은 날 안에서 앞에 세울 순서. 긱뉴스 · 쇼케이스 · HN 은 points,
--                   GitHub 은 기간 별(stars_in_period, 없으면 stars). arXiv 는 지표가 없어 null.
--                   meta 는 사람이 읽는 문구라 정렬에 쓸 수 없다.
--   origin_url      「원문」 링크. 긱뉴스는 external_url(소개한 글), HN 은 스레드가 가리키는
--                   주소(metrics.hn_external_url). open_url 은 그대로 토론 페이지를 가리킨다.
--                   쇼케이스는 open_url 이 이미 「만든 것」의 주소라 따로 두지 않는다.
--
-- 하나 더 — mobile_feed 의 meta 계산이 metrics 의 숫자를 ::bigint 로 바로 바꾸던 것을
-- numeric 을 거치게 고친다. 소수 하나에 뷰 전체가 죽던 문제다 (아래 lateral 주석).
--
-- **열은 끝에만 붙인다.** create or replace view 는 기존 열의 이름 · 순서 · 타입을
-- 바꿀 수 없고, 앱은 열 이름을 골라 읽으므로(select=type,key,…) 끝에 붙은 열은 보지도
-- 않는다. 이미 배포된 앱 빌드는 아무 영향이 없다.
--
-- drop 하지 않고 create or replace 로 바꾸는 이유: 뷰를 지우는 순간 grant 가 같이
-- 사라지고, 다시 만들기 전까지 앱 요청이 실패한다. replace 는 한 번에 바뀌고
-- 0018 이 정리한 권한(anon 에게 SELECT 만)을 그대로 둔다.
-- ---------------------------------------------------------------------------

create or replace view public.mobile_feed as
select
    'geek'::text                                   as type,
    g.url                                          as key,
    null::text                                     as source,
    null::text                                     as repo,
    g.title                                        as title,
    g.summary                                      as lede,
    concat_ws(' · ',
      nullif(btrim(coalesce(g.source_domain, '')), ''),
      g.points || ' points',
      '댓글 ' || g.comment_count
    )                                              as meta,
    g.published_at                                 as published_at,
    g.url                                          as open_url,
    coalesce(g.source_domain, '')                  as host,
    null::text                                     as public_id,
    null::text                                     as source_variant,
    concat_ws(' ', g.title, g.summary)             as search_text,
    -- ↓ 0019
    g.collected_date                               as collected_date,
    g.points::bigint                               as score,
    nullif(btrim(coalesce(g.external_url, '')), '') as origin_url
  from public.geek_news g
  where g.is_hidden = false

union all

select
    'trend'::text,
    t.source_url,
    t.source,
    case
      when t.source <> 'github' then null
      else coalesce(
        nullif(btrim(coalesce(t.raw_title, '')), ''),
        nullif(regexp_replace(t.source_url, '^https?://github\.com/|/+$', '', 'g'), t.source_url)
      )
    end,
    t.title,
    coalesce(t.deck, ''),
    concat_ws(' · ', m.metric, nullif(btrim(coalesce(m.language, '')), '')),
    t.collected_at,
    t.source_url,
    coalesce(substring(t.source_url from '^https?://([^/?#]+)'), ''),
    t.public_id,
    t.source_variant,
    concat_ws(' ', t.title, t.deck, t.raw_title, array_to_string(t.tags, ' ')),
    -- ↓ 0019
    t.collected_date,
    m.score,
    m.origin_url
  from public.trend_items t
  -- metric 은 0013 과 같은 문구를 만든다. 다른 곳은 숫자 변환 하나다 — 0013 은
  -- (값)::bigint 로 바로 바꿔서, 별 수에 55.0 같은 소수가 한 행만 들어와도
  -- 「invalid input syntax for type bigint」로 이 뷰 전체가 죽었다(앱 홈이 빈다).
  -- numeric 을 거치면 정수 데이터에서는 결과가 같고, 소수가 와도 반올림해 살아남는다.
  cross join lateral (
    select
      t.metrics ->> 'language' as language,
      case t.source
        when 'github' then
          case
            when coalesce(
                   case when jsonb_typeof(t.metrics -> 'stars_in_period') = 'number'
                        then nullif(round((t.metrics ->> 'stars_in_period')::numeric)::bigint, 0) end,
                   case when jsonb_typeof(t.metrics -> 'stars') = 'number'
                        then nullif(round((t.metrics ->> 'stars')::numeric)::bigint, 0) end
                 ) is null then null
            else '★ '
              || btrim(to_char(
                   coalesce(
                     case when jsonb_typeof(t.metrics -> 'stars_in_period') = 'number'
                          then nullif(round((t.metrics ->> 'stars_in_period')::numeric)::bigint, 0) end,
                     case when jsonb_typeof(t.metrics -> 'stars') = 'number'
                          then nullif(round((t.metrics ->> 'stars')::numeric)::bigint, 0) end
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
                 and nullif(round((t.metrics ->> 'comments')::numeric)::bigint, 0) is not null
               then (t.metrics ->> 'comments') || ' comments' end
        when 'arxiv' then
          case when nullif(btrim(coalesce(t.metrics ->> 'arxiv_id', '')), '') is not null
               then 'arXiv:' || btrim(t.metrics ->> 'arxiv_id') end
        when 'geeknews' then
          case when jsonb_typeof(t.metrics -> 'points') = 'number'
                 and nullif(round((t.metrics ->> 'points')::numeric)::bigint, 0) is not null
               then (t.metrics ->> 'points') || ' points' end
      end as metric,
      -- 숫자가 아니면 null. 소수가 들어와도 죽지 않게 numeric 을 거친다.
      case t.source
        when 'github' then coalesce(
          case when jsonb_typeof(t.metrics -> 'stars_in_period') = 'number'
               then round((t.metrics ->> 'stars_in_period')::numeric)::bigint end,
          case when jsonb_typeof(t.metrics -> 'stars') = 'number'
               then round((t.metrics ->> 'stars')::numeric)::bigint end)
        when 'hn' then
          case when jsonb_typeof(t.metrics -> 'points') = 'number'
               then round((t.metrics ->> 'points')::numeric)::bigint end
        when 'geeknews' then
          case when jsonb_typeof(t.metrics -> 'points') = 'number'
               then round((t.metrics ->> 'points')::numeric)::bigint end
      end as score,
      case when t.source = 'hn'
           then nullif(btrim(coalesce(t.metrics ->> 'hn_external_url', '')), '')
      end as origin_url
  ) m
  where t.status = 'published';

comment on view public.mobile_feed is
  '앱 · 웹 목록용. geek_news + trend_items 를 FeedItem 모양으로 정규화한 union. anon SELECT 허용.';

-- ---------------------------------------------------------------------------

create or replace view public.mobile_showcase as
select
    'show'::text                                   as type,
    s.url                                          as key,
    s.title                                        as title,
    s.summary                                      as lede,
    concat_ws(' · ',
      nullif(btrim(coalesce(s.source_domain, '')), ''),
      s.points || ' points',
      '댓글 ' || s.comment_count
    )                                              as meta,
    s.published_at                                 as published_at,
    coalesce(nullif(btrim(coalesce(s.external_url, '')), ''), s.url) as open_url,
    coalesce(s.source_domain, '')                  as host,
    s.submitter                                    as maker,
    concat_ws(' ', s.title, s.summary)             as search_text,
    -- ↓ 0019
    s.collected_date                               as collected_date,
    s.points::bigint                               as score
  from public.showcase_items s
  where s.is_hidden = false;

comment on view public.mobile_showcase is
  '앱 · 웹 쇼케이스 목록 — 직접 만든 것 소개. key(토픽 URL)와 open_url(만든 것의 주소)이 다르다. anon SELECT 허용.';

-- ---------------------------------------------------------------------------

create or replace view public.mobile_trend_detail as
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
    t.tags                                         as tags,
    -- ↓ 0019
    t.collected_date                               as collected_date,
    case when t.source = 'hn'
         then nullif(btrim(coalesce(t.metrics ->> 'hn_external_url', '')), '')
    end                                            as origin_url
  from public.trend_items t
  where t.status = 'published';

comment on view public.mobile_trend_detail is
  '앱 · 웹 트렌드 상세. trend_items.body 를 그대로 내보낸다. anon SELECT 허용.';

-- ---------------------------------------------------------------------------
-- 권한은 replace 로 그대로 남는다. 그래도 확인한다 — 0018 과 같은 기준이다.
-- ---------------------------------------------------------------------------
do $$
declare
  v text;
begin
  foreach v in array array['mobile_feed', 'mobile_showcase', 'mobile_trend_detail'] loop
    if not has_table_privilege('anon', format('public.%I', v), 'SELECT') then
      raise exception 'anon 이 % 를 읽을 수 없습니다', v;
    end if;
    if has_table_privilege('anon', format('public.%I', v), 'INSERT')
       or has_table_privilege('anon', format('public.%I', v), 'UPDATE')
       or has_table_privilege('anon', format('public.%I', v), 'DELETE') then
      raise exception 'anon 이 % 에 쓸 수 있습니다 — 0018 을 다시 실행하세요', v;
    end if;
  end loop;
end $$;

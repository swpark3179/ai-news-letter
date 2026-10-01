-- 0016_mobile_showcase.sql
-- 쇼케이스 목록을 앱에 열어 주는 뷰.
--
-- ---------------------------------------------------------------------------
-- 왜 뷰인가
-- ---------------------------------------------------------------------------
-- 0014_showcase.sql 이 만든 showcase_items 는 표라서 anon 에게 닫혀 있다.
-- 0013_mobile_read_access.sql 의 방침이 「표가 아니라 뷰만 연다」이고, 이 파일은
-- 그 방침을 쇼케이스에 그대로 적용한 것이다 — 노출 범위가 뷰 정의로 고정되고,
-- is_hidden 필터를 뷰 안에 박아 우회할 길을 없앤다.
--
-- 초안은 웹 저장소의 docs/SHOWCASE_QUERY.md 5장에 준비돼 있었다. 거기서 딱
-- 한 곳만 다르다 — **type 컬럼을 더한다.** 앱의 FeedItem.fromJson 이 목록 한 줄을
-- type 으로 갈라 읽으므로, 이 값이 없으면 쇼케이스만 파서를 따로 타야 한다.
--
-- ---------------------------------------------------------------------------
-- mobile_feed 에 union 으로 합치지 않은 이유
-- ---------------------------------------------------------------------------
-- 홈은 mobile_feed 를 **필터 없이** 시간 역순으로 읽는다. 거기에 쇼케이스를 더하면
-- 이미 배포된 앱 빌드의 홈 화면 내용이 그날로 바뀐다 — 앱에 칩이 생기기도 전에
-- 쇼케이스가 뉴스 사이에 섞여 나온다. 뷰를 따로 두면 기존 빌드는 영향을 받지 않고,
-- 새 앱 버전이 긱뉴스 탭의 「쇼케이스」 칩에서만 읽는다.
-- ---------------------------------------------------------------------------

drop view if exists public.mobile_showcase;

create view public.mobile_showcase as
select
    'show'::text                                   as type,
    s.url                                          as key,
    s.title                                        as title,
    s.summary                                      as lede,
    -- mobile_feed 의 meta 규칙과 같은 모양: "my.tool · 12 points · 댓글 3"
    concat_ws(' · ',
      nullif(btrim(coalesce(s.source_domain, '')), ''),
      s.points || ' points',
      '댓글 ' || s.comment_count
    )                                              as meta,
    s.published_at                                 as published_at,
    -- mobile_feed 와 일부러 다른 곳. 긱뉴스는 요약과 댓글이 토픽 페이지에 있어
    -- 그쪽을 열지만, 쇼케이스에서 사람들이 보고 싶은 것은 「만든 것」이다.
    -- 다만 external_url 이 비어 있는 글도 있어 토픽 URL 로 떨어뜨린다.
    coalesce(nullif(btrim(coalesce(s.external_url, '')), ''), s.url) as open_url,
    coalesce(s.source_domain, '')                  as host,
    s.submitter                                    as maker,
    concat_ws(' ', s.title, s.summary)             as search_text
  from public.showcase_items s
  where s.is_hidden = false;   -- ← 뷰 안에 박아 우회할 길을 없앤다

comment on view public.mobile_showcase is
  '모바일 쇼케이스 목록 — 직접 만든 것 소개. key(토픽 URL, 담기 키)와 open_url(만든 것의 주소)이 다르다. anon SELECT 허용.';

-- 0013 과 같이 스키마 단위가 아니라 뷰 하나씩 명시한다.
grant select on public.mobile_showcase to anon;

-- 0017_mobile_hada_content.sql
-- 긱뉴스 / 쇼케이스 상세 페이지 **본문**을 앱에 열어 주는 뷰.
--
-- ---------------------------------------------------------------------------
-- 0015_hada_contents.sql 이 남겨 둔 자리
-- ---------------------------------------------------------------------------
-- 0015 는 본문 저장소를 만들면서 RLS 를 켜고 정책은 두지 않았고, 마지막 주석이
-- 이 파일을 예고해 두었다 — "모바일 앱에 본문을 열어 주는 뷰는 화면 설계가 끝난
-- 뒤 따로 추가한다." 화면(긱뉴스 탭의 본문 상세)이 정해졌으므로 여기서 연다.
--
-- 본문을 담기 시작한 이유가 그대로 이 뷰의 이유다 — 앱이 news.hada.io 로 링크를
-- 열어 주면 그 페이지에 광고가 섞여 읽기 불편하다. 본문만 앱 안에서 보여 준다.
--
-- ---------------------------------------------------------------------------
-- 내보내지 않는 것
-- ---------------------------------------------------------------------------
--   status · attempts · last_error · container 는 수집기 운영값이다. 앱은
--   「본문이 있다 / 없다」만 알면 되고, 셀렉터 이름이나 실패 사유가 anon 키로
--   읽히는 앱 바이너리를 통해 나갈 이유가 없다.
--
--   그래서 status <> 'ok' 인 행은 아예 행이 없는 것으로 다룬다. 앱은 행이 없으면
--   지금까지처럼 원문 리더로 떨어진다 — 실패를 화면에서 구분할 필요가 없다.
--
-- ---------------------------------------------------------------------------
-- is_hidden 을 여기서 다시 거는 이유
-- ---------------------------------------------------------------------------
--   hada_contents 에는 is_hidden 이 없다(목록 테이블의 열이다). 그런데 앱은 이
--   뷰에 url 을 직접 넣어 조회하므로, 운영자가 감춘 항목의 URL 을 알고 있으면
--   본문만 따로 읽을 수 있게 된다. 목록에서 감춘 글의 본문이 남는 것은 감춘 게
--   아니다. 0013·0014 의 「필터는 뷰 안에 박는다」 방침대로 부모를 확인한다.
--
--   PK 인덱스 두 개를 타는 exists 라 비용은 사실상 없다.
-- ---------------------------------------------------------------------------

drop view if exists public.mobile_hada_content;

create view public.mobile_hada_content as
select
    c.url        as key,      -- geek_news.url / showcase_items.url 과 같은 값
    c.source     as source,   -- geeknews | showcase
    c.body_md    as body_md,
    c.truncated  as truncated,
    c.fetched_at as fetched_at
  from public.hada_contents c
 where c.status = 'ok'
   and c.body_md <> ''
   and (
     (c.source = 'geeknews' and exists (
        select 1 from public.geek_news g
         where g.url = c.url and g.is_hidden = false))
     or
     (c.source = 'showcase' and exists (
        select 1 from public.showcase_items s
         where s.url = c.url and s.is_hidden = false))
   );

comment on view public.mobile_hada_content is
  '모바일 긱뉴스·쇼케이스 본문. 수집에 성공한 행만, 감추지 않은 항목만 나간다. anon SELECT 허용.';

grant select on public.mobile_hada_content to anon;

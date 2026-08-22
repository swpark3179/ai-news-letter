import DeepDive from "@/components/home/DeepDive";
import GeekAside from "@/components/home/GeekAside";
import LeadStory from "@/components/home/LeadStory";
import Masthead from "@/components/home/Masthead";
import TrendGroups from "@/components/home/TrendGroups";
import WeeklyReviews from "@/components/home/WeeklyReviews";
import s from "@/components/home/home.module.css";
import {
  countComments,
  countGeekNewsToday,
  countTrendBySource,
  getArticles,
  getGeekNews,
  getLatestDeepArticle,
  getLeadTrendItem,
  getRotations,
  getTrendItems,
} from "@/lib/data/content";
import { getLastSyncRun, storageUrl } from "@/lib/data/ops";
import { getPublishSettings } from "@/lib/data/settings";
import { formatIssue, hhmm } from "@/lib/format";

export const dynamic = "force-dynamic";

const REVIEW_CARDS = 4;

export default async function HomePage() {
  const today = new Date();

  const [settings, lead, geek, deep, allReviews, duty, geekToday, lastGeekSync, lastTrendSync] =
    await Promise.all([
      getPublishSettings(),
      getLeadTrendItem(),
      getGeekNews(8),
      getLatestDeepArticle(),
      getArticles({ section: "review", limit: 12 }),
      getRotations("weekly", 6),
      countGeekNewsToday(),
      getLastSyncRun("geeknews"),
      getLastSyncRun("trend"),
    ]);

  // 머리기사와 같은 날 수집분만 3열에 노출한다.
  const trendDate = lead?.collected_date;
  const [trendItems, trendTotals, deepComments] = await Promise.all([
    getTrendItems({ date: trendDate, excludeUrl: lead?.source_url }),
    countTrendBySource(trendDate),
    deep ? countComments(deep.id) : Promise.resolve(0),
  ]);

  const reviews = allReviews.slice(0, REVIEW_CARDS);
  const restReviews = allReviews.length - reviews.length;

  const trendToday = Object.values(trendTotals).reduce((a, b) => a + b, 0);
  const fetchedTotal = (lastTrendSync?.fetched_count ?? 0) + (lastGeekSync?.fetched_count ?? 0);

  const counts: Record<string, string> = {
    geek: geekToday > 0 ? `오늘 ${geekToday}건` : "수집 대기",
    trend: trendToday > 0 ? `오늘 ${trendToday}건` : "수집 대기",
    review: allReviews.length > 0 ? `최근 ${allReviews.length}건` : "작성 대기",
    deep: deep ? "최신 1건" : "작성 대기",
  };

  const syncOk =
    lastGeekSync?.status === "success" && lastTrendSync?.status !== "failed";
  const lastSyncAt = lastGeekSync?.finished_at ?? lastGeekSync?.started_at;
  const lastSync = {
    ok: syncOk,
    label: syncOk && lastSyncAt
      ? `자동 수집 정상 · ${hhmm(lastSyncAt)}`
      : lastGeekSync?.status === "failed"
        ? "자동 수집 실패 · 관리자 확인 필요"
        : "자동 수집 대기 중",
  };

  return (
    <div className={s.wrap}>
      <div className={s.paper}>
        <Masthead
          settings={settings}
          counts={counts}
          lastSync={lastSync}
          today={today}
        />

        <div className={s.mainGrid}>
          <div className={s.leftCol}>
            <LeadStory lead={lead} />
            <TrendGroups
              items={trendItems}
              totals={trendTotals}
              fetchedTotal={fetchedTotal || trendToday + geekToday}
            />
          </div>

          <div className={s.divider} />

          <GeekAside geek={geek} duty={duty} showEn={settings.showEnSubtitles} />
        </div>

        <div className={s.blockRuleThick} />

        <DeepDive
          deep={deep}
          commentCount={deepComments}
          photoUrl={storageUrl(deep?.photo_path)}
          showEn={settings.showEnSubtitles}
        />

        <div className={s.blockRuleThin} />

        <WeeklyReviews
          reviews={reviews}
          restCount={restReviews}
          showEn={settings.showEnSubtitles}
        />

        <div className={s.paperFooter}>
          <div className={s.footerBrand}>AI 뉴스레터</div>
          <div className={s.footerMeta}>
            {formatIssue(settings.issueNo)} · {settings.publisher} · 발행인 박세원
          </div>
          <div className={s.footerRights}>
            긱뉴스·GitHub·Hacker News·arXiv 원문의 저작권은 각 출처에 있습니다
          </div>
        </div>
      </div>
    </div>
  );
}

import GeekAside from "@/components/home/GeekAside";
import LeadStory from "@/components/home/LeadStory";
import Masthead from "@/components/home/Masthead";
import TrendGroups from "@/components/home/TrendGroups";
import s from "@/components/home/home.module.css";
import {
  countGeekNewsToday,
  countTrendBySource,
  getGeekNews,
  getLeadTrendItem,
  getTrendItems,
} from "@/lib/data/content";
import { getLastSyncRun } from "@/lib/data/ops";
import { getPublishSettings } from "@/lib/data/settings";
import { formatIssue, shortDot } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const today = new Date();

  const [settings, lead, geek, geekToday, lastGeekSync, lastTrendSync] =
    await Promise.all([
      getPublishSettings(),
      getLeadTrendItem(),
      getGeekNews(8),
      countGeekNewsToday(),
      getLastSyncRun("geeknews"),
      getLastSyncRun("trend"),
    ]);

  // 머리기사와 같은 날 수집분만 3열에 노출한다.
  const trendDate = lead?.collected_date;
  const [trendItems, trendTotals] = await Promise.all([
    getTrendItems({ date: trendDate, excludeUrl: lead?.source_url }),
    countTrendBySource(trendDate),
  ]);

  const trendToday = Object.values(trendTotals).reduce((a, b) => a + b, 0);
  const fetchedTotal = (lastTrendSync?.fetched_count ?? 0) + (lastGeekSync?.fetched_count ?? 0);

  const counts: Record<string, string> = {
    geek: geekToday > 0 ? `오늘 ${geekToday}건` : "수집 대기",
    trend: trendToday > 0 ? `오늘 ${trendToday}건` : "수집 대기",
  };

  const syncOk =
    lastGeekSync?.status === "success" && lastTrendSync?.status !== "failed";
  const lastSyncAt = lastGeekSync?.finished_at ?? lastGeekSync?.started_at;
  const lastSync = {
    ok: syncOk,
    label: syncOk && lastSyncAt
      ? `자동 수집 정상 · ${shortDot(lastSyncAt)}`
      : lastGeekSync?.status === "failed"
        ? "자동 수집 실패"
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
              collectedDate={trendDate ?? trendItems[0]?.collected_date}
            />
          </div>

          <div className={s.divider} />

          <GeekAside geek={geek} showEn={settings.showEnSubtitles} />
        </div>

        <div className={s.paperFooter}>
          <div className={s.footerBrand}>AI 뉴스레터</div>
          <div className={s.footerMeta}>
            {formatIssue(settings.issueNo)} · 발행인 박세원
          </div>
          <div className={s.footerRights}>
            긱뉴스·GitHub·Hacker News·arXiv 원문의 저작권은 각 출처에 있습니다
          </div>
        </div>
      </div>
    </div>
  );
}

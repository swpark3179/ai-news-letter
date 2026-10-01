import GeekAside from "@/components/home/GeekAside";
import LeadStory from "@/components/home/LeadStory";
import Masthead from "@/components/home/Masthead";
import TrendGroups from "@/components/home/TrendGroups";
import s from "@/components/home/home.module.css";
import {
  countBySource,
  getFeed,
  getIssue,
  getLatestCollectedDate,
  getTrendDetail,
  pickLead,
} from "@/lib/data/feed";
import { formatIssue } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const today = new Date();

  const [issue, trendDate, geek] = await Promise.all([
    getIssue(),
    getLatestCollectedDate("trend"),
    getFeed({ type: "geek", limit: 8 }),
  ]);

  // 머리기사와 3열은 가장 최근에 수집한 날의 트렌드로 채운다.
  const trendItems = trendDate ? await getFeed({ type: "trend", date: trendDate }) : [];
  const leadItem = pickLead(trendItems);
  const lead = leadItem?.public_id ? await getTrendDetail(leadItem.public_id) : null;
  const rest = trendItems.filter((t) => t.key !== leadItem?.key);

  // 오늘(KST) 수집분 — 앱 홈 마스트헤드와 같은 숫자다 (mobile_issue).
  const counts: Record<string, string> = {
    geek: issue.geek_count > 0 ? `오늘 ${issue.geek_count}건` : "수집 대기",
    trend: issue.trend_count > 0 ? `오늘 ${issue.trend_count}건` : "수집 대기",
  };

  return (
    <div className={s.wrap}>
      <div className={s.paper}>
        <Masthead
          issueNo={issue.issue_no}
          counts={counts}
          collectedDate={trendDate}
          today={today}
        />

        <div className={s.mainGrid}>
          <div className={s.leftCol}>
            <LeadStory lead={lead} />
            <TrendGroups
              items={rest}
              totals={countBySource(trendItems)}
              collectedDate={trendDate ?? undefined}
            />
          </div>

          <div className={s.divider} />

          <GeekAside geek={geek} />
        </div>

        <div className={s.paperFooter}>
          <div className={s.footerBrand}>AI 뉴스레터</div>
          <div className={s.footerMeta}>{formatIssue(issue.issue_no)} · 발행인 박세원</div>
          <div className={s.footerRights}>
            긱뉴스·GitHub·Hacker News·arXiv 원문의 저작권은 각 출처에 있습니다
          </div>
        </div>
      </div>
    </div>
  );
}

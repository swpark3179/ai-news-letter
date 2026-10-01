import GeekAside from "@/components/home/GeekAside";
import LeadStory from "@/components/home/LeadStory";
import Masthead from "@/components/home/Masthead";
import TrendGroups from "@/components/home/TrendGroups";
import s from "@/components/home/home.module.css";
import { getEdition, getIssue, getTrendDetail, pickLead } from "@/lib/data/feed";
import { formatIssue } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * 1면 — 다섯 카테고리를 마지막으로 수집한 날 것으로 한 장을 채운다 (getEdition).
 *
 *   머리기사   그날 GitHub 에서 기간 별이 가장 많은 저장소
 *   3열        GitHub · Hacker News · arXiv — 그날 것 전부
 *   사이드바   긱뉴스 · 쇼케이스 — 그날 것 전부
 */
export default async function HomePage() {
  const today = new Date();

  const [issue, edition] = await Promise.all([getIssue(), getEdition()]);
  const { slots } = edition;

  const leadItem = pickLead(slots.github.items);
  const lead = leadItem?.public_id ? await getTrendDetail(leadItem.public_id) : null;

  return (
    <div className={s.wrap}>
      <div className={s.paper}>
        <Masthead
          issueNo={issue.issue_no}
          editionDate={edition.date}
          slots={slots}
          today={today}
        />

        <div className={s.mainGrid}>
          <div className={s.leftCol}>
            <LeadStory lead={lead} />
            <TrendGroups
              slots={{ github: slots.github, hn: slots.hn, arxiv: slots.arxiv }}
              leadKey={lead ? leadItem?.key : undefined}
              today={today}
            />
          </div>

          <div className={s.divider} />

          <GeekAside geek={slots.geek} show={slots.show} today={today} />
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

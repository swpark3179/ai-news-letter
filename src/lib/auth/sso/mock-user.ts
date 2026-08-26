/**
 * 목업 SSO 가 발급하는 사용자.
 *
 * 브라우저(client.mock.ts)와 서버(목업 자동 세션 라우트) 양쪽에서 쓰기 때문에
 * 클라이언트 모듈 밖으로 빼 두었다. 서버 라우트가 client.mock.ts 를 직접
 * import 하면 브라우저용 WebSocket 클라이언트까지 서버 번들에 끌려온다.
 *
 * 사번은 0008_seed.sql 의 Unit 장과 맞춰 둔다 — 목업 로그인과 목업 자동 세션이
 * 같은 members 행으로 모이게 하려는 것이다.
 *
 * EPID 는 사번과 **다른 값**으로 둔다. 실제 체계가 그렇고, 같게 두면 목업에서
 * 「EPID 로 찾고 없으면 사번으로 찾아 백필한다」는 경로(resolveMemberFromSso)가
 * 한 번도 밟히지 않아 조용히 어긋난 채로 남는다.
 */
export const MOCK_USER = {
  epid: "KNX21084213",
  empNo: "21084213",
  name: "박세원",
  email: "s-w.park@samsung.com",
  dept: "AI Unit",
};

/**
 * 목업 SSO 가 발급하는 사용자.
 *
 * 브라우저(client.mock.ts)와 서버(목업 자동 세션 라우트) 양쪽에서 쓰기 때문에
 * 클라이언트 모듈 밖으로 빼 두었다. 서버 라우트가 client.mock.ts 를 직접
 * import 하면 브라우저용 WebSocket 클라이언트까지 서버 번들에 끌려온다.
 *
 * 사번은 0008_seed.sql 의 Unit 장과 맞춰 둔다 — 목업 로그인과 목업 자동 세션이
 * 같은 members 행으로 모이게 하려는 것이다.
 */
export const MOCK_USER = {
  empNo: "21084213",
  name: "박세원",
  email: "s-w.park@samsung.com",
  dept: "AI Unit",
};

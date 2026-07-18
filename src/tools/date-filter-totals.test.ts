/**
 * 날짜/유형 필터의 거짓 총계 회귀 테스트.
 *
 * 공통 결함: 클라이언트측 필터(한 페이지에만 적용)의 잔존수를 "총 N건"으로 보고해,
 * "2024년 손해배상 판례는 총 2건" 류의 중대 오답을 유발했다.
 * 서버 총계(totalCnt)와 필터 잔존수를 구분 표기해야 한다.
 */
import { describe, it, expect } from "vitest"
import { searchPrecedentsStructured } from "./precedent-search-core.js"
import { renderPrecedentSearchResult } from "./precedents.js"
import { searchInterpretations } from "./interpretations.js"
import type { LawApiClient } from "../lib/api-client.js"

// prec: 서버 총 347건 중 3건 조회, 그중 1건만 2024년
const PREC_XML = `<?xml version="1.0" encoding="UTF-8"?><PrecSearch><totalCnt>347</totalCnt><page>1</page>
<prec id="1"><판례일련번호>111</판례일련번호><사건명><![CDATA[손해배상(2023)]]></사건명><사건번호>2023다1111</사건번호><법원명>대법원</법원명><선고일자>2023.05.10</선고일자><판결유형>판결</판결유형></prec>
<prec id="2"><판례일련번호>222</판례일련번호><사건명><![CDATA[손해배상(2024)]]></사건명><사건번호>2024다2222</사건번호><법원명>대법원</법원명><선고일자>2024.03.15</선고일자><판결유형>판결</판결유형></prec>
<prec id="3"><판례일련번호>333</판례일련번호><사건명><![CDATA[손해배상(2022)]]></사건명><사건번호>2022다3333</사건번호><법원명>대법원</법원명><선고일자>2022.01.20</선고일자><판결유형>판결</판결유형></prec>
</PrecSearch>`

// expc: 서버 총 210건 중 2건 조회, 그중 1건만 기간 내
const EXPC_XML = `<?xml version="1.0" encoding="UTF-8"?><Expc><totalCnt>210</totalCnt><page>1</page>
<expc id="1"><법령해석례일련번호>91</법령해석례일련번호><안건명><![CDATA[근로 사건A]]></안건명><회신일자>2024.02.01</회신일자><회신기관명>법제처</회신기관명></expc>
<expc id="2"><법령해석례일련번호>92</법령해석례일련번호><안건명><![CDATA[근로 사건B]]></안건명><회신일자>2020.06.01</회신일자><회신기관명>법제처</회신기관명></expc>
</Expc>`

const stub = (xml: string) => ({
  fetchApi: async () => xml,
}) as unknown as LawApiClient

describe("search_precedents — 날짜필터 총계", () => {
  it("총계는 필터 잔존수(1)가 아니라 서버 totalCnt(347)", async () => {
    const result = await searchPrecedentsStructured(stub(PREC_XML), {
      query: "손해배상", display: 20, page: 1,
      fromDate: "20240101", toDate: "20241231",
    })
    expect(result.totalCount).toBe(347)   // 종전엔 hits.length(1)였음
    expect(result.hits).toHaveLength(1)

    const text = renderPrecedentSearchResult(result)
    expect(text).toContain("1건 표시 — 서버 매칭 총 347건")
    expect(text).toContain("기간 내 전체가 아닙니다")
    expect(text).not.toContain("총 1건,")
  })

  // 기간 내 0건이면 완화 폴백이 기간 밖 결과를 플래그 달아 반환한다(기존 설계 유지).
  // 이때도 총계는 서버 총계여야 하고(종전엔 hits.length), 기간 밖 표기가 살아 있어야 한다.
  it("완화 폴백 경로에서도 총계는 서버 totalCnt + 기간 밖 표기 유지", async () => {
    const result = await searchPrecedentsStructured(stub(PREC_XML), {
      query: "손해배상", display: 20, page: 1,
      fromDate: "19900101", toDate: "19901231",
    })
    expect(result.totalCount).toBe(347)
    const text = renderPrecedentSearchResult(result)
    expect(text).toContain("서버 매칭 총 347건")
    expect(text).toContain("요청 기간 밖")
  })
})

describe("search_interpretations — 날짜필터 총계", () => {
  it("총계는 필터 잔존수(1)가 아니라 서버 totalCnt(210)", async () => {
    const r = await searchInterpretations(stub(EXPC_XML), {
      query: "근로", display: 20, page: 1, fromDate: "20240101",
    })
    const text = r.content[0].text
    expect(text).toContain("기간 일치 1건 표시")
    expect(text).toContain("서버 매칭 총 210건")
    expect(text).not.toContain("총 1건")
  })

  it("필터 후 0건이면 페이지 한정임을 명시하고 단정 금지 경고", async () => {
    const r = await searchInterpretations(stub(EXPC_XML), {
      query: "근로", display: 20, page: 1, fromDate: "19900101", toDate: "19901231",
    })
    const text = r.content[0].text
    expect(r.isError).toBe(true)
    expect(text).toContain("서버 매칭은 총 210건")
    expect(text).toContain("단정하지 마세요")
  })

  it("무필터 경로는 기존 형식 유지", async () => {
    const r = await searchInterpretations(stub(EXPC_XML), { query: "근로", display: 20, page: 1 })
    expect(r.content[0].text).toContain("해석례 검색 결과 (총 210건, 1페이지)")
  })
})

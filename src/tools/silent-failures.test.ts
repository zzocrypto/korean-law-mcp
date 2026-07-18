/**
 * "조용한 실패 → 거짓 음성" 회귀 테스트.
 *
 * 공통 결함: 일시적 API 장애·조회 실패를 조용히 빈 결과로 대체해,
 * LLM이 "법령 없음"/"판례 변경 없음 ✅" 같은 사실 단정으로 오독하게 했다.
 */
import { describe, it, expect } from "vitest"
import { advancedSearch } from "./advanced-search.js"
import { citeCheck } from "./cite-check.js"
import type { LawApiClient } from "../lib/api-client.js"

describe("advanced_search — 인프라 에러를 0건으로 위장하지 않는다", () => {
  it("단일 대상 전체 실패 시 '0건' 대신 에러 표면화", async () => {
    const client = {
      searchLaw: async () => { throw new Error("법제처 서버 오류 (500)") },
    } as unknown as LawApiClient

    const r = await advancedSearch(client, {
      query: "근로 기준", searchType: "law", operator: "AND", display: 20,
    })
    const text = r.content[0].text
    expect(r.isError).toBe(true)
    expect(text).toContain("500")
    expect(text).not.toContain("고급 검색 결과 (0건)")
  })

  it("일부 대상만 실패하면 결과에 해당 유형 누락을 명시", async () => {
    const LAW_XML = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><totalCnt>1</totalCnt><law id="1"><법령명한글><![CDATA[근로기준법]]></법령명한글><법령ID>001872</법령ID><공포일자>20240101</공포일자></law></LawSearch>`
    const client = {
      searchLaw: async () => LAW_XML,
      fetchApi: async () => { throw new Error("법제처 서버 오류 (502)") },  // admin_rule 경로
      searchOrdinance: async () => `<?xml version="1.0"?><OrdinSearch><totalCnt>0</totalCnt></OrdinSearch>`,
    } as unknown as LawApiClient

    const r = await advancedSearch(client, {
      query: "근로", searchType: "all", operator: "OR", display: 20,
    })
    const text = r.content[0].text
    expect(text).toContain("근로기준법")            // 성공한 유형은 나오고
    expect(text).toContain("행정규칙 검색 실패")     // 실패한 유형은 명시
    expect(text).toContain("누락")
  })

  it("auth 에러는 즉시 전파(재시도 무의미)", async () => {
    const client = {
      searchLaw: async () => { throw new Error("401 Unauthorized — API 키 확인") },
    } as unknown as LawApiClient
    const r = await advancedSearch(client, {
      query: "상법", searchType: "law", operator: "AND", display: 20,
    })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toContain("401")
  })
})

describe("cite_check — 스캔 실패를 '미감지 ✅'로 위장하지 않는다", () => {
  const TARGET_XML = `<?xml version="1.0" encoding="UTF-8"?><PrecSearch><totalCnt>1</totalCnt><page>1</page>
<prec id="1"><판례일련번호>100</판례일련번호><사건명><![CDATA[대상판례]]></사건명><사건번호>2013다61381</사건번호><법원명>대법원</법원명><선고일자>2015.01.01</선고일자><판결유형>판결</판결유형></prec></PrecSearch>`
  // 후속 인용 2건 (전합 아님 — 전합 미스캔 경고 경로와 분리)
  const CITING_XML = `<?xml version="1.0" encoding="UTF-8"?><PrecSearch><totalCnt>2</totalCnt><page>1</page>
<prec id="1"><판례일련번호>201</판례일련번호><사건명><![CDATA[후속1]]></사건명><사건번호>2020다1111</사건번호><법원명>대법원</법원명><선고일자>2020.05.01</선고일자><판결유형>판결</판결유형></prec>
<prec id="2"><판례일련번호>202</판례일련번호><사건명><![CDATA[후속2]]></사건명><사건번호>2021다2222</사건번호><법원명>대법원</법원명><선고일자>2021.06.01</선고일자><판결유형>판결</판결유형></prec></PrecSearch>`

  const makeClient = (detailFails: boolean) => ({
    fetchApi: async (p: { endpoint: string; extraParams?: Record<string, string> }) => {
      if (p.endpoint === "lawSearch.do" && p.extraParams?.nb) return TARGET_XML
      if (p.endpoint === "lawSearch.do") return CITING_XML
      // lawService.do — 상세(본문) 조회
      if (detailFails) throw new Error("법제처 서버 오류 (500)")
      return JSON.stringify({ PrecService: { 판례내용: "…위 판례를 인용한다…", 사건번호: "x" } })
    },
  }) as unknown as LawApiClient

  it("본문 조회가 전부 실패하면 ✅ 대신 ⚠️ 미확인 판정", async () => {
    const r = await citeCheck(makeClient(true), { caseNumber: "2013다61381", display: 20, deepScan: true })
    const text = r.content[0].text
    expect(text).toContain("본문 조회 실패로 변경·폐기 여부 미확인")
    expect(text).not.toContain("✅")
  })

  it("본문 조회가 성공하면 기존 ✅ 판정 유지", async () => {
    const r = await citeCheck(makeClient(false), { caseNumber: "2013다61381", display: 20, deepScan: true })
    expect(r.content[0].text).toContain("✅ 후속 인용 2건")
  })
})

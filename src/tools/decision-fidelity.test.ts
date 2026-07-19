import { describe, it, expect } from "vitest"
import { getInterpretationText } from "./interpretations.js"
import { searchConstitutionalDecisions } from "./constitutional-decisions.js"
import type { LawApiClient } from "../lib/api-client.js"

/** 개선요청 20260719 A-3·B-1 회귀 테스트 (실측 형상 픽스처) */

describe("A-3 getInterpretationText — 해석례번호 라벨", () => {
  // 실측: id=313499의 공식 해석례번호는 안건번호 "12-0368"
  const DETAIL_JSON = JSON.stringify({
    ExpcService: {
      안건명: "기획재정부 - 공익사업용 토지 등에 대한 양도소득세 감면의 적용 범위",
      안건번호: "12-0368",
      법령해석례일련번호: "313499",
      해석일자: "2012.07.12",
      질의기관명: "기획재정부",
      해석기관명: "법제처",
      질의요지: "…",
      회답: "…",
    },
  })

  it("공식 번호(안건번호)를 해석례번호로, 내부 ID는 별도 라벨로", async () => {
    const client = { fetchApi: async () => DETAIL_JSON } as unknown as LawApiClient
    const t = (await getInterpretationText(client, { id: "313499" })).content[0].text
    expect(t).toContain("해석례번호: 12-0368")            // 종전엔 313499
    expect(t).toContain("내부 일련번호: 313499")
    expect(t).toContain("인용 금지")
  })

  it("공식 번호 미제공이면 N/A + 대체 인용 안내 (내부 ID를 승격시키지 않음)", async () => {
    const noNum = JSON.stringify({ ExpcService: { 안건명: "X", 법령해석례일련번호: "999", 해석일자: "2020.01.01" } })
    const client = { fetchApi: async () => noNum } as unknown as LawApiClient
    const t = (await getInterpretationText(client, { id: "999" })).content[0].text
    expect(t).toContain("해석례번호: N/A")
    expect(t).not.toContain("해석례번호: 999")
  })
})

describe("B-1 헌재 쟁점어 — 본문검색 폴백", () => {
  const EMPTY = `<?xml version="1.0" encoding="UTF-8"?><DetcSearch><totalCnt>0</totalCnt><page>1</page></DetcSearch>`
  const BODY_HIT = `<?xml version="1.0" encoding="UTF-8"?><DetcSearch><totalCnt>148</totalCnt><page>1</page><Detc id="1"><헌재결정례일련번호>5501</헌재결정례일련번호><사건명><![CDATA[구 상속세 및 증여세법 제45조의2 위헌소원]]></사건명><사건번호>2019헌바167</사건번호><종국일자>2022.11.24</종국일자></Detc></DetcSearch>`

  it("사건명 0건이면 search=2로 재시도하고 폴백 사실을 명시", async () => {
    const calls: Array<Record<string, string>> = []
    const client = {
      fetchApi: async (p: { extraParams: Record<string, string> }) => {
        calls.push(p.extraParams)
        return p.extraParams.search === "2" ? BODY_HIT : EMPTY
      },
    } as unknown as LawApiClient

    const t = (await searchConstitutionalDecisions(client, { query: "명의신탁", display: 20, page: 1 })).content[0].text
    expect(calls).toHaveLength(2)
    expect(calls[1].search).toBe("2")
    expect(t).toContain("총 148건")
    expect(t).toContain("본문검색 폴백")
    expect(t).toContain("2019헌바167")
  })

  it("사건번호 검색은 폴백하지 않는다 (정밀조회 보존 — 회귀 D절)", async () => {
    const calls: Array<Record<string, string>> = []
    const client = {
      fetchApi: async (p: { extraParams: Record<string, string> }) => { calls.push(p.extraParams); return EMPTY },
    } as unknown as LawApiClient
    await searchConstitutionalDecisions(client, { caseNumber: "2004헌바76", display: 20, page: 1 })
    expect(calls).toHaveLength(1)
  })

  it("본문검색도 0건이면 기존 NOT_FOUND 경로 유지", async () => {
    const client = { fetchApi: async () => EMPTY } as unknown as LawApiClient
    const r = await searchConstitutionalDecisions(client, { query: "존재하지않는쟁점", display: 20, page: 1 })
    expect(r.content[0].text).toContain("[NOT_FOUND]")
  })
})

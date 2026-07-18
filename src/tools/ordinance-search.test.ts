import { describe, it, expect } from "vitest"
import { searchOrdinance } from "./ordinance-search.js"
import type { LawApiClient } from "../lib/api-client.js"

// OrdinSearch 응답 축약 — 첫 항목이 쿼리와 관련/무관한 두 상황을 재현
const ordinXml = (names: string[]) => {
  const body = names.map((n, i) =>
    `<law id="${i + 1}"><자치법규일련번호>100${i + 1}</자치법규일련번호><자치법규명><![CDATA[${n}]]></자치법규명><지자체기관명>서울특별시</지자체기관명><공포일자>20240101</공포일자><시행일자>20240101</시행일자></law>`
  ).join("")
  return `<?xml version="1.0" encoding="UTF-8"?><OrdinSearch><totalCnt>${names.length}</totalCnt><page>1</page>${body}</OrdinSearch>`
}

const stub = (xml: string) => ({
  searchOrdinance: async () => xml,
}) as unknown as LawApiClient

const textOf = (r: { content: Array<{ text: string }> }) => r.content[0].text

describe("searchOrdinance — 다음 단계 힌트 게이트", () => {
  it("첫 결과가 쿼리와 관련되면 그 id를 콕 찍어 안내", async () => {
    const text = textOf(await searchOrdinance(
      stub(ordinXml(["서울특별시 경관 조례", "부산광역시 경관 조례"])),
      { query: "서울 경관 조례", display: 20 }
    ))
    expect(text).toContain(`get_ordinance(id="1001")`)
  })

  // 첫 결과는 단지 LIKE 1위일 뿐 — 무관하면 특정 id를 권하지 않아야 한다
  // (엉뚱한 조례 전문을 LLM이 그대로 인용하는 사고 방지)
  it("첫 결과가 쿼리와 무관하면 특정 id 대신 목록 안내로 격하", async () => {
    const text = textOf(await searchOrdinance(
      stub(ordinXml(["가평군 공무원 복무 조례", "광진구 공무원 복무 조례"])),
      { query: "광진구 복무 조례", display: 20 }
    ))
    expect(text).not.toContain(`get_ordinance(id="1001")`)
    expect(text).toContain("위 목록에서 원하는 자치법규를 고른 뒤")
  })
})

import { describe, it, expect } from "vitest"
import { searchAdminRule, compareAdminRuleOldNew } from "./admin-rule.js"
import { LAW_API_MAX_DISPLAY, type LawApiClient } from "../lib/api-client.js"

// 실제 lawSearch.do(target=admrul/admrulOldAndNew, query=감독규정) 응답 축약.
// 서버측 매칭은 88건인데 display 미전달 시 법제처 기본 20건만 온다.
const admrulXml = (totalCnt: number, items: number) => {
  let body = ""
  for (let i = 1; i <= items; i++) {
    body += `<admrul id="${i}"><행정규칙명>감독규정${i}</행정규칙명><행정규칙일련번호>210000024418${i}</행정규칙일련번호><행정규칙ID>8977${i}</행정규칙ID><발령일자>20240710</발령일자><행정규칙종류>고시</행정규칙종류><소관부처명>금융위원회</소관부처명></admrul>`
  }
  return `<?xml version="1.0" encoding="UTF-8"?><AdmRulSearch><target>admrul</target><totalCnt>${totalCnt}</totalCnt><page>1</page>${body}</AdmRulSearch>`
}

const textOf = (r: { content: Array<{ text: string }> }) => r.content[0].text

describe("searchAdminRule — display 전달·총 건수", () => {
  // display를 API에 안 넘기면 법제처 기본 20건 고정 → display=50이 조용히 무시되던 결함
  it("input.display를 API에 전달한다 (상한 100 캡)", async () => {
    const displays: Array<number | undefined> = []
    const client = {
      searchAdminRule: async (p: { display?: number }) => {
        displays.push(p.display)
        return admrulXml(88, 3)
      },
    } as unknown as LawApiClient
    await searchAdminRule(client, { query: "감독규정", display: 50 })
    expect(displays).toEqual([50])

    await searchAdminRule(client, { query: "감독규정", display: 500 })
    expect(displays[1]).toBe(LAW_API_MAX_DISPLAY)
  })

  it("총계는 조회 건수가 아니라 법제처 totalCnt", async () => {
    const client = {
      searchAdminRule: async () => admrulXml(88, 3),
    } as unknown as LawApiClient
    const text = textOf(await searchAdminRule(client, { query: "감독규정", display: 20 }))
    expect(text).toContain("행정규칙 검색 결과 (총 88건 중 3건 조회)")
  })
})

describe("compareAdminRuleOldNew(검색 경로) — 신구법도 같은 결함", () => {
  it("조회는 상한까지, 총계는 totalCnt, 표시 초과분은 생략 고지", async () => {
    const params: Array<Record<string, string>> = []
    const client = {
      fetchApi: async (p: { extraParams: Record<string, string> }) => {
        params.push(p.extraParams)
        return admrulXml(88, 25) // 서버 총 88건 중 25건 조회된 상황
      },
    } as unknown as LawApiClient

    const text = textOf(await compareAdminRuleOldNew(client, { query: "감독규정" }))

    // ① display가 실제로 전달됐나 (미전달 시 법제처 기본 20건 고정이던 결함)
    expect(params[0].display).toBe(String(LAW_API_MAX_DISPLAY))
    // ② 거짓 총계("총 25건") 대신 서버 총계
    expect(text).toContain("행정규칙 신구법 검색 결과 (총 88건 중 25건 조회)")
    // ③ 20건 표시 후 초과분 고지
    expect(text).toContain("외 5건 (생략")
  })
})

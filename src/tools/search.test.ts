import { describe, it, expect, beforeEach } from "vitest"
import { hasRelatedHit, parseLawsXml, searchLaw } from "./search.js"
import { LAW_API_MAX_DISPLAY, type LawApiClient } from "../lib/api-client.js"
import { lawCache } from "../lib/cache.js"

const hit = (name: string, abbr = "") => ({
  name, abbr, lawId: "0", mst: "0", promDate: "", effDate: "", statusCode: "현행", lawType: "법률",
})

// 법제처 API가 "AI법" 쿼리에 검색어를 무시하고 가나다순 전체 목록을 반환하던 사례:
// 무관한 목록을 확장쿼리 결과로 채택하면 안 됨
describe("hasRelatedHit", () => {
  it("법령명이 쿼리를 포함하면 true", () => {
    expect(hasRelatedHit([hit("화학물질관리법 시행령")], "화학물질관리법")).toBe(true)
  })

  it("쿼리가 법령명을 포함해도 true (조문 꼬리 붙은 확장쿼리)", () => {
    expect(hasRelatedHit([hit("화학물질관리법")], "화학물질관리법 제5조")).toBe(true)
  })

  it("약칭 매칭도 인정", () => {
    expect(hasRelatedHit([hit("산업안전보건법", "산안법")], "산안법")).toBe(true)
  })

  it("무관한 목록(쿼리 무시 응답)은 false", () => {
    const junk = [hit("가맹사업거래의 공정화에 관한 법률"), hit("긴급복지지원법"), hit("도시철도법")]
    expect(hasRelatedHit(junk, "AI법")).toBe(false)
  })
})

// 실제 lawSearch.do(target=law, query=상법) 응답 축약.
// 서버측 매칭은 56건이고 「상법」은 가나다순으로 「보상법」류에 밀려 뒤쪽에 온다
// — 앞 N건만 조회하면 정작 「상법」이 도착하지 못한다.
const SANGBEOP_XML = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><target>law</target><키워드>상법</키워드><section>lawNm</section><totalCnt>56</totalCnt><page>1</page><numOfRows>4</numOfRows><resultCode>00</resultCode><resultMsg>success</resultMsg>
<law id="1"><법령일련번호>3274</법령일련번호><현행연혁코드>현행</현행연혁코드><법령명한글><![CDATA[1980년해직공무원의보상등에관한특별조치법]]></법령명한글><법령ID>001348</법령ID><공포일자>19890329</공포일자><법령구분명>법률</법령구분명><시행일자>19890329</시행일자></law>
<law id="2"><법령일련번호>204611</법령일련번호><현행연혁코드>현행</현행연혁코드><법령명한글><![CDATA[1980년해직공무원의보상등에관한특별조치법시행령]]></법령명한글><법령ID>004549</법령ID><공포일자>20180918</공포일자><법령구분명>대통령령</법령구분명><시행일자>20180921</시행일자></law>
<law id="3"><법령일련번호>284121</법령일련번호><현행연혁코드>현행</현행연혁코드><법령명한글><![CDATA[5ㆍ18민주화운동 관련자 보상 등에 관한 법률]]></법령명한글><법령ID>001234</법령ID><공포일자>20260305</공포일자><법령구분명>법률</법령구분명><시행일자>20260701</시행일자></law>
<law id="4"><법령일련번호>284143</법령일련번호><현행연혁코드>현행</현행연혁코드><법령명한글><![CDATA[상법]]></법령명한글><법령ID>001702</법령ID><공포일자>20260306</공포일자><법령구분명>법률</법령구분명><시행일자>20260306</시행일자></law>
</LawSearch>`

// 「상법」(id=4)이 빠진 = 정확매칭 0건 응답
const NO_EXACT_XML = SANGBEOP_XML.replace(/<law id="4">[\s\S]*?<\/law>\n?/, "")

const EFLAW_EMPTY = `<?xml version="1.0" encoding="UTF-8"?><LawSearch><target>eflaw</target><totalCnt>0</totalCnt></LawSearch>`

/**
 * 법제처 API처럼 앞 display건만 잘라 반환한다 (totalCnt는 서버측 전체 건수라 그대로).
 * 이 자르기를 재현해야 "display를 낮추면 「상법」이 조회에 도달하지 못한다"는
 * 원래 버그가 테스트에 실제로 걸린다.
 */
function sliceLaws(xml: string, display = 20): string {
  const blocks = xml.match(/<law id="\d+">[\s\S]*?<\/law>/g) || []
  const head = xml.slice(0, xml.indexOf("<law id="))
  const kept = blocks.slice(0, Math.min(display, LAW_API_MAX_DISPLAY))
  return `${head}${kept.join("\n")}\n</LawSearch>`
}

/** target=law 호출에 넘어간 display 인자를 기록하는 스텁 */
function stubClient(lawXml: string) {
  const displayArgs: Array<number | undefined> = []
  const client = {
    searchLaw: async (_q: string, _k?: string, display?: number, target: "law" | "eflaw" = "law") => {
      if (target === "eflaw") return EFLAW_EMPTY
      displayArgs.push(display)
      return sliceLaws(lawXml, display)
    },
  } as unknown as LawApiClient
  return { client, displayArgs }
}

const textOf = (r: { content: Array<{ text: string }> }) => r.content[0].text

describe("parseLawsXml", () => {
  it("totalCnt를 서버측 전체 매칭 건수로 읽는다 (조회 건수와 별개)", () => {
    const r = parseLawsXml(SANGBEOP_XML)
    expect(r.laws).toHaveLength(4)
    expect(r.totalCnt).toBe(56)
  })

  it("totalCnt가 없는 응답이면 조회 건수로 폴백", () => {
    const r = parseLawsXml(SANGBEOP_XML.replace("<totalCnt>56</totalCnt>", ""))
    expect(r.totalCnt).toBe(4)
  })
})

describe("searchLaw — 조회량과 표시량 분리", () => {
  beforeEach(() => lawCache.clear())

  it("display를 낮춰도 API 조회는 상한으로 고정한다", async () => {
    const { client, displayArgs } = stubClient(SANGBEOP_XML)
    await searchLaw(client, { query: "상법", display: 3 })
    expect(displayArgs).toEqual([LAW_API_MAX_DISPLAY])
  })

  // 회귀: display가 "조회 건수"와 "표시 건수"를 겸직해, 호출자가 display를 낮추면
  // 「상법」이 조회 자체에 도달하지 못하고 정확매칭이 0건으로 무너지던 버그
  it("display=3에도 정확매칭 「상법」이 유지된다", async () => {
    const { client } = stubClient(SANGBEOP_XML)
    const text = textOf(await searchLaw(client, { query: "상법", display: 3 }))
    expect(text).toContain("📍 정확매칭 (1건)")
    expect(text).toContain("1. 상법")
    expect(text).not.toContain("⚠️ 정확매칭 없음")
  })

  it("display=1이면 정확매칭만 남고 빈 부분매칭 섹션을 만들지 않는다", async () => {
    const { client } = stubClient(SANGBEOP_XML)
    const text = textOf(await searchLaw(client, { query: "상법", display: 1 }))
    expect(text).toContain("📍 정확매칭 (1건)")
    expect(text).not.toContain("📂 부분매칭")
  })
})

describe("searchLaw — 총 건수 보고", () => {
  beforeEach(() => lawCache.clear())

  // 조회 건수를 총계로 보고하면 display=3인 「상법」 검색이 "총 3건"이 되어
  // 호출자가 "법제처가 3건밖에 못 찾았다 = API 한계"로 오귀인한다
  it("총계는 조회 건수가 아니라 법제처 totalCnt", async () => {
    const { client } = stubClient(SANGBEOP_XML)
    const text = textOf(await searchLaw(client, { query: "상법", display: 3 }))
    expect(text).toContain("검색 결과 (총 56건 중 4건 조회)")
  })

  it("전량 조회면 '중 N건 조회'를 붙이지 않는다", async () => {
    const { client } = stubClient(SANGBEOP_XML.replace("<totalCnt>56</totalCnt>", "<totalCnt>4</totalCnt>"))
    const text = textOf(await searchLaw(client, { query: "상법", display: 50 }))
    expect(text).toContain("검색 결과 (총 4건):")
  })
})

describe("searchLaw — 정확매칭 0건", () => {
  beforeEach(() => lawCache.clear())

  // 「상법」을 물었는데 「1980년해직공무원의보상등에관한특별조치법」 전문을 권하면
  // 💡가 ⚠️보다 먼저 나와 LLM이 무관한 법을 그대로 인용한다
  it("무관한 부분매칭으로 다음 단계 힌트를 만들지 않는다", async () => {
    const { client } = stubClient(NO_EXACT_XML)
    const text = textOf(await searchLaw(client, { query: "상법", display: 3 }))
    expect(text).not.toContain("💡 다음:")
    expect(text).toContain("⚠️ 정확매칭 없음")
  })

  it("잘린 결과면 원인을 API의 LIKE 특성으로 돌리지 않는다", async () => {
    const { client } = stubClient(NO_EXACT_XML)
    const text = textOf(await searchLaw(client, { query: "상법", display: 3 }))
    expect(text).toContain("상위 3건만 조회")
    expect(text).not.toContain("LIKE 부분검색 특성상")
  })

  it("전량 조회에도 정확매칭이 없을 때만 LIKE 특성으로 안내한다", async () => {
    const { client } = stubClient(NO_EXACT_XML.replace("<totalCnt>56</totalCnt>", "<totalCnt>3</totalCnt>"))
    const text = textOf(await searchLaw(client, { query: "상법", display: 50 }))
    expect(text).toContain("LIKE 부분검색 특성상")
    expect(text).not.toContain("상위 3건만 조회")
  })
})

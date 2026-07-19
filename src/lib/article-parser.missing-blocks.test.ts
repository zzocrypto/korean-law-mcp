import { describe, it, expect } from "vitest"
import { annotateUnrenderedBlocks, extractHangContent } from "./article-parser.js"

/**
 * 개선요청 20260719 A-1·A-2 회귀 테스트.
 * 픽스처는 법제처 eflaw JSON 실측(2026-07-19 라이브 캡처) — 구조화 API 자체가
 * 산식·세목을 응답에 포함하지 않음을 확인했다(JSON·XML 모두). 파서가 할 일은
 * 조용히 비워두는 대신 누락을 명시하는 것.
 */

describe("annotateUnrenderedBlocks — A-1 표·산식 누락 명시", () => {
  // 법인세법 시행령 §61③ 실측 항내용 (산식은 API 응답에 아예 없음)
  it("'다음 산식에 따라 …한다.'로 끝나면 누락 경고를 붙인다", () => {
    const t = "③제2항에 따른 대손실적률은 다음 산식에 따라 계산한 비율로 한다. <개정 2009.2.4> "
    const out = annotateUnrenderedBlocks(t)
    expect(out).toContain("표·산식이 법제처 구조화 API에 포함되지 않아")
  })

  it("'다음 표와 같다'로 끝나도 경고", () => {
    expect(annotateUnrenderedBlocks("…세율은 다음 표와 같다.")).toContain("표·산식")
  })

  // 소득세법 §104①8류 — 표가 텍스트로 이어지는 정상 렌더 조문은 발화 금지
  it("문구 뒤에 표 내용이 이어지면 발화하지 않는다", () => {
    const t = "…세율은 다음 표와 같다.\n과세표준 1,400만원 이하 | 세율 6%\n1,400만원 초과 | 15%"
    expect(annotateUnrenderedBlocks(t)).not.toContain("⚠️")
  })

  it("별표 참조는 발화하지 않는다 (별표는 get_annexes로 정상 조회 가능)", () => {
    expect(annotateUnrenderedBlocks("…의 기준은 별표와 같다.")).not.toContain("⚠️")
  })
})

describe("annotateUnrenderedBlocks — A-2 하위 세목 접힘 명시", () => {
  // 법인세법 시행령 §19 제19호의2 가목 실측 목내용 (세목 1)·2)가 API 응답에 없음)
  const MOK = "가.  주식매수선택권 또는 우리사주매수선택권을 부여받은 경우로서 다음의 어느 하나에 해당하는 경우 해당 금액"

  it("하위 없는 목이 '다음의 어느 하나…'로 끝나면 세목 누락 경고", () => {
    expect(annotateUnrenderedBlocks(MOK, { hasChildren: false })).toContain("하위 세목이 법제처 구조화 API에 포함되지 않아")
  })

  it("하위(호·목)가 실제로 이어지는 경우엔 발화하지 않는다", () => {
    const t = "① 다음 각 호의 어느 하나에 해당하는 경우"
    expect(annotateUnrenderedBlocks(t, { hasChildren: true })).not.toContain("⚠️")
  })
})

describe("extractHangContent 통합 — 실측 형상 항/목", () => {
  it("항③ 산식 누락 + 목 세목 누락이 각 위치에 명시된다", () => {
    const hang = [
      { 항번호: "③", 항내용: "③제2항에 따른 대손실적률은 다음 산식에 따라 계산한 비율로 한다. <개정 2009.2.4> " },
      {
        항번호: "①", 항내용: "①…다음 각 호의 구분에 따른 것으로 한다.",
        호: [{
          호번호: "19의2",
          호내용: "19의2. 다음 각 목의 어느 하나에 해당하는 금액",
          목: [{ 목번호: "가", 목내용: "가.  주식매수선택권 또는 우리사주매수선택권을 부여받은 경우로서 다음의 어느 하나에 해당하는 경우 해당 금액" }],
        }],
      },
    ]
    const out = extractHangContent(hang)
    expect(out).toContain("표·산식이 법제처 구조화 API에 포함되지 않아")   // 항③
    expect(out).toContain("하위 세목이 법제처 구조화 API에 포함되지 않아") // 목 가
    // 호는 목이 이어지므로 발화 금지 (경고는 정확히 2곳)
    expect(out.match(/⚠️/g)?.length).toBe(2)
  })
})

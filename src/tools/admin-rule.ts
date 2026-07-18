/**
 * 행정규칙 관련 Tools
 */

import { z } from "zod"
import { DOMParser } from "@xmldom/xmldom"
import { LAW_API_MAX_DISPLAY, type LawApiClient } from "../lib/api-client.js"
import { truncateResponse } from "../lib/schemas.js"
import { formatToolError, noResultHint } from "../lib/errors.js"
import { parseTotalCnt } from "../lib/xml-parser.js"

// search_admin_rule 스키마
export const SearchAdminRuleSchema = z.object({
  query: z.string().describe("검색할 행정규칙명"),
  knd: z.string().optional().describe("행정규칙 종류 (1=훈령, 2=예규, 3=고시, 4=공고, 5=일반)"),
  display: z.number().optional().default(20).describe("최대 결과 개수"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type SearchAdminRuleInput = z.infer<typeof SearchAdminRuleSchema>

export async function searchAdminRule(
  apiClient: LawApiClient,
  input: SearchAdminRuleInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const xmlText = await apiClient.searchAdminRule({
      query: input.query,
      knd: input.knd,
      // display를 API에 넘기지 않으면 법제처 기본값(20건)만 조회돼
      // display=50 같은 호출이 조용히 20건으로 잘렸다.
      display: Math.min(input.display, LAW_API_MAX_DISPLAY),
      apiKey: input.apiKey
    })

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    const rules = doc.getElementsByTagName("admrul")

    if (rules.length === 0) {
      return noResultHint(input.query || "", "행정규칙")
    }

    // "총 N건"은 법제처가 보고한 totalCnt. 조회 건수(rules.length)를 총계로 쓰면
    // 「감독규정」(실제 총 88건)이 "총 20건"으로 보고돼 호출자가 전량으로 오인한다.
    const fetchedCount = rules.length
    const totalCnt = Math.max(parseTotalCnt(xmlText), fetchedCount)

    let resultText = `행정규칙 검색 결과 (총 ${totalCnt}건`
    if (totalCnt > fetchedCount) {
      resultText += ` 중 ${fetchedCount}건 조회`
    }
    resultText += `):\n\n`

    const display = Math.min(rules.length, input.display)

    for (let i = 0; i < display; i++) {
      const rule = rules[i]

      const ruleName = rule.getElementsByTagName("행정규칙명")[0]?.textContent || "알 수 없음"
      const ruleSeq = rule.getElementsByTagName("행정규칙일련번호")[0]?.textContent || ""
      const ruleId = rule.getElementsByTagName("행정규칙ID")[0]?.textContent || ""
      const promDate = rule.getElementsByTagName("발령일자")[0]?.textContent || ""
      const ruleType = rule.getElementsByTagName("행정규칙종류")[0]?.textContent || ""
      const orgName = rule.getElementsByTagName("소관부처명")[0]?.textContent || ""

      resultText += `${i + 1}. ${ruleName}\n`
      resultText += `   - 행정규칙일련번호: ${ruleSeq}\n`
      resultText += `   - 행정규칙ID: ${ruleId}\n`
      resultText += `   - 공포일: ${promDate}\n`
      resultText += `   - 구분: ${ruleType}\n`
      resultText += `   - 소관부처: ${orgName}\n\n`
    }

    // 후속 도구 안내 제거 (LLM이 이미 도구 목록을 알고 있음)

    return {
      content: [{
        type: "text",
        text: truncateResponse(resultText)
      }]
    }
  } catch (error) {
    return formatToolError(error, "search_admin_rule")
  }
}

// get_admin_rule 스키마
export const GetAdminRuleSchema = z.object({
  id: z.string().describe("행정규칙ID (search_admin_rule에서 획득)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
})

export type GetAdminRuleInput = z.infer<typeof GetAdminRuleSchema>

export async function getAdminRule(
  apiClient: LawApiClient,
  input: GetAdminRuleInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    const xmlText = await apiClient.getAdminRule(input.id, input.apiKey)

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    // 행정규칙 정보 추출
    const ruleName = doc.getElementsByTagName("행정규칙명")[0]?.textContent || "알 수 없음"
    const promDate = doc.getElementsByTagName("공포일자")[0]?.textContent || ""
    const orgName = doc.getElementsByTagName("소관부처")[0]?.textContent || ""
    const ruleType = doc.getElementsByTagName("행정규칙종류")[0]?.textContent || ""

    let resultText = `행정규칙명: ${ruleName}\n`
    if (promDate) resultText += `공포일: ${promDate}\n`
    if (ruleType) resultText += `종류: ${ruleType}\n`
    if (orgName) resultText += `소관부처: ${orgName}\n`
    resultText += `\n---\n\n`

    // 조문 추출 - <조문내용> 태그 사용
    const joContents = doc.getElementsByTagName("조문내용")

    if (joContents.length === 0) {
      // 첨부파일 확인
      const attachments = doc.getElementsByTagName("첨부파일링크")
      if (attachments.length > 0) {
        resultText += "[주의] 이 행정규칙은 조문 형식이 아닌 첨부파일로 제공됩니다.\n\n"
        resultText += "첨부파일:\n"
        for (let i = 0; i < attachments.length; i++) {
          const link = attachments[i].textContent || ""
          if (link) {
            resultText += `   ${i + 1}. ${link}\n`
          }
        }
        return {
          content: [{
            type: "text",
            text: truncateResponse(resultText)
          }]
        }
      }

      return {
        content: [{
          type: "text",
          text: "[NOT_FOUND] 행정규칙 전문을 조회할 수 없습니다.\n\n" +
                "⚠️ LLM은 행정규칙 내용을 추측/생성하지 마세요.\n" +
                "[주의] 법제처 API 제한: 일부 행정규칙은 전문 조회가 지원되지 않습니다."
        }],
        isError: true
      }
    }

    // 조문내용이 비어있는지 확인
    let hasContent = false
    for (let i = 0; i < joContents.length; i++) {
      const content = joContents[i].textContent?.trim() || ""
      if (content.length > 0) {
        hasContent = true
        break
      }
    }

    if (!hasContent) {
      // 첨부파일 확인
      const attachments = doc.getElementsByTagName("첨부파일링크")
      if (attachments.length > 0) {
        resultText += "[주의] 이 행정규칙은 조문 형식이 아닌 첨부파일로 제공됩니다.\n\n"
        resultText += "첨부파일:\n"
        for (let i = 0; i < attachments.length; i++) {
          const link = attachments[i].textContent || ""
          if (link) {
            resultText += `   ${i + 1}. ${link}\n`
          }
        }
      } else {
        resultText += "[주의] 이 행정규칙은 조문 내용이 비어있습니다."
      }
      return {
        content: [{
          type: "text",
          text: truncateResponse(resultText)
        }]
      }
    }

    // 조문 내용 출력
    for (let i = 0; i < joContents.length; i++) {
      const joContent = joContents[i].textContent?.trim() || ""

      if (joContent.length > 0) {
        resultText += `${joContent}\n\n`
      }
    }

    // 부칙 추가
    const addendums = doc.getElementsByTagName("부칙내용")
    if (addendums.length > 0) {
      resultText += `\n---\n부칙\n---\n\n`
      for (let i = 0; i < addendums.length; i++) {
        const content = addendums[i].textContent?.trim() || ""
        if (content.length > 0) {
          resultText += `${content}\n\n`
        }
      }
    }

    // 별표 추가
    const annexes = doc.getElementsByTagName("별표내용")
    if (annexes.length > 0) {
      resultText += `\n---\n별표\n---\n\n`
      for (let i = 0; i < annexes.length; i++) {
        const title = doc.getElementsByTagName("별표제목")[i]?.textContent?.trim() || ""
        const content = annexes[i].textContent?.trim() || ""

        if (title) {
          resultText += `[${title}]\n`
        }
        if (content.length > 0) {
          resultText += `${content}\n\n`
        }
      }
    }

    return {
      content: [{
        type: "text",
        text: truncateResponse(resultText)
      }]
    }
  } catch (error) {
    return formatToolError(error, "get_admin_rule")
  }
}

// compare_admin_rule_old_new 스키마
export const CompareAdminRuleOldNewSchema = z.object({
  query: z.string().optional().describe("행정규칙명 키워드 (검색용)"),
  id: z.string().optional().describe("행정규칙ID (본문 조회용, search_admin_rule에서 획득)"),
  apiKey: z.string().optional().describe("법제처 Open API 인증키(OC). 사용자가 제공한 경우 전달")
}).refine(data => data.query || data.id, {
  message: "query(검색) 또는 id(본문조회) 중 하나는 필수입니다"
})

export type CompareAdminRuleOldNewInput = z.infer<typeof CompareAdminRuleOldNewSchema>

export async function compareAdminRuleOldNew(
  apiClient: LawApiClient,
  input: CompareAdminRuleOldNewInput
): Promise<{ content: Array<{ type: string, text: string }>, isError?: boolean }> {
  try {
    if (input.id) {
      // 본문 조회: lawService.do, target=admrulOldAndNew
      const xmlText = await apiClient.fetchApi({
        endpoint: "lawService.do",
        target: "admrulOldAndNew",
        type: "XML",
        extraParams: { ID: String(input.id) },
        apiKey: input.apiKey
      })

      const parser = new DOMParser()
      const doc = parser.parseFromString(xmlText, "text/xml")

      const ruleName = doc.getElementsByTagName("행정규칙명")[0]?.textContent || "알 수 없음"

      let resultText = `행정규칙 신구법 대조: ${ruleName}\n`
      resultText += `---\n\n`

      const oldArticles = doc.getElementsByTagName("구조문")
      const newArticles = doc.getElementsByTagName("신조문")
      const maxCount = Math.max(oldArticles.length, newArticles.length)

      if (maxCount === 0) {
        resultText += "[NOT_FOUND] 신구법 대조 데이터가 없습니다.\n⚠️ LLM은 대조 내용을 추측하지 마세요."
        return { content: [{ type: "text", text: resultText }], isError: true }
      }

      const displayCount = Math.min(maxCount, 30)
      for (let i = 0; i < displayCount; i++) {
        const oldContent = oldArticles[i]?.textContent?.trim() || ""
        const newContent = newArticles[i]?.textContent?.trim() || ""

        resultText += `---\n`
        resultText += `[개정 전] ${oldContent || "(신설)"}\n\n`
        resultText += `[개정 후] ${newContent || "(삭제)"}\n\n`
      }

      if (maxCount > displayCount) {
        resultText += `\n... 외 ${maxCount - displayCount}개 항목 (생략)\n`
      }

      return { content: [{ type: "text", text: truncateResponse(resultText) }] }
    }

    // 검색: lawSearch.do, target=admrulOldAndNew
    // display를 넘기지 않으면 법제처 기본값(20건)만 조회돼 나머지가 조용히 잘린다
    // (search_admin_rule과 동일 결함이 여기에도 있었음 — 「감독규정」 실제 88건).
    const xmlText = await apiClient.fetchApi({
      endpoint: "lawSearch.do",
      target: "admrulOldAndNew",
      type: "XML",
      extraParams: { query: String(input.query), display: String(LAW_API_MAX_DISPLAY) },
      apiKey: input.apiKey
    })

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlText, "text/xml")

    // 실제 응답(OldAndNewLawSearch)의 항목 태그는 <oldAndNew>다 — 종전 코드는
    // 존재하지 않는 <admrul>을 찾아 매 호출 0건 → 검색 경로가 한 번도 동작한 적 없었다
    // (get_law_abbreviations와 동일 부류, 라이브 스모크에서 발견).
    const rules = doc.getElementsByTagName("oldAndNew")
    if (rules.length === 0) {
      return noResultHint(input.query || "", "행정규칙 신구법")
    }

    // "총 N건"은 법제처 totalCnt — 조회 건수를 총계로 쓰면 잘림이 전량으로 위장된다.
    const fetchedCount = rules.length
    const totalCnt = Math.max(parseTotalCnt(xmlText), fetchedCount)

    let resultText = `행정규칙 신구법 검색 결과 (총 ${totalCnt}건`
    if (totalCnt > fetchedCount) {
      resultText += ` 중 ${fetchedCount}건 조회`
    }
    resultText += `):\n\n`

    const display = Math.min(rules.length, 20)
    for (let i = 0; i < display; i++) {
      const rule = rules[i]
      // 필드도 실제 응답 기준: 신구법명/신구법ID (행정규칙명/행정규칙ID 아님)
      const name = rule.getElementsByTagName("신구법명")[0]?.textContent || "알 수 없음"
      const ruleId = rule.getElementsByTagName("신구법ID")[0]?.textContent || ""
      const promDate = rule.getElementsByTagName("발령일자")[0]?.textContent || ""
      const rrCls = rule.getElementsByTagName("제개정구분명")[0]?.textContent || ""
      const orgName = rule.getElementsByTagName("소관부처명")[0]?.textContent || ""

      resultText += `${i + 1}. ${name}\n`
      resultText += `   - 행정규칙ID: ${ruleId}\n`
      if (rrCls) resultText += `   - 제개정구분: ${rrCls}\n`
      resultText += `   - 발령일: ${promDate}\n`
      resultText += `   - 소관부처: ${orgName}\n\n`
    }

    if (rules.length > display) {
      resultText += `... 외 ${rules.length - display}건 (생략 — 정식 명칭으로 좁혀 재검색 권장)\n`
    }

    // 후속 도구 안내 제거 (LLM이 이미 도구 목록을 알고 있음)

    return { content: [{ type: "text", text: truncateResponse(resultText) }] }
  } catch (error) {
    return formatToolError(error, "compare_admin_rule_old_new")
  }
}

import type {
  PaperOutline,
  SectionDraft,
  CitationEnhancement,
  CitationMeta,
  CitationRef,
  ReviewResult,
  PubMedArticle,
} from '../types'
import { searchPubMedBundle } from './pubmedService'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

export const DEFAULT_MODEL = 'claude-haiku-4-5'

export const MODEL_OPTIONS = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 (저비용/고속)' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (균형)' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8 (최고 품질)' },
]

interface CallOptions {
  apiKey: string
  model: string
  system?: string
  prompt: string
  maxTokens?: number
}

/** Anthropic Messages API 를 브라우저에서 직접 호출 */
async function callClaude({
  apiKey,
  model,
  system,
  prompt,
  maxTokens = 8000,
}: CallOptions): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // 브라우저에서 직접 호출하기 위한 헤더
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    let detail = ''
    try {
      const err = await res.json()
      detail = err?.error?.message || JSON.stringify(err)
    } catch {
      detail = await res.text()
    }
    throw new Error(`Anthropic API 오류 (${res.status}): ${detail}`)
  }

  const data = await res.json()
  const text = (data?.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('')
  return text
}

/** Claude 응답에서 JSON 블록을 안전하게 추출/파싱 */
function extractJson<T>(text: string): T {
  // ```json ... ``` 코드펜스 우선
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fence ? fence[1] : text
  // 첫 { 또는 [ 부터 마지막 } 또는 ] 까지
  const start = candidate.search(/[{[]/)
  const lastObj = candidate.lastIndexOf('}')
  const lastArr = candidate.lastIndexOf(']')
  const end = Math.max(lastObj, lastArr)
  const slice = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate
  try {
    return JSON.parse(slice) as T
  } catch {
    throw new Error(
      `Claude 응답을 JSON 으로 파싱하지 못했습니다.\n원문: ${text.slice(0, 400)}...`,
    )
  }
}

// ─────────────────────────────────────────────────────────────
// 1단계: 아웃라인 생성
// ─────────────────────────────────────────────────────────────
export async function generateOutline(
  apiKey: string,
  model: string,
  research: string,
  keywords: string,
): Promise<PaperOutline> {
  const system =
    '당신은 생의학/생명과학 분야 논문 작성을 돕는 전문 과학 저술가입니다. ' +
    '연구 내용을 바탕으로 저널 투고용 논문의 구조를 설계합니다. 반드시 한국어로 작성하되, 전문 용어는 영문 병기합니다.'

  const prompt = `다음 연구 내용을 바탕으로 학술 논문의 아웃라인을 설계하세요.

[연구 내용]
${research}

[핵심 키워드]
${keywords}

아래 JSON 스키마로만 응답하세요. 설명/서론 없이 JSON 만 출력합니다.
{
  "title": "논문 제목",
  "abstract": "200~250단어 분량의 초록",
  "keywords": ["키워드1", "키워드2", ...],
  "sections": [
    { "id": "introduction", "title": "서론", "summary": "이 섹션에서 다룰 핵심 내용" },
    { "id": "methods", "title": "연구 방법", "summary": "..." },
    { "id": "results", "title": "결과", "summary": "..." },
    { "id": "discussion", "title": "고찰", "summary": "..." },
    { "id": "conclusion", "title": "결론", "summary": "..." }
  ],
  "visualizations": [
    { "title": "Figure 1. ...", "type": "figure", "description": "어떤 그림/그래프인지" },
    { "title": "Table 1. ...", "type": "table", "description": "..." }
  ]
}`

  const text = await callClaude({ apiKey, model, system, prompt, maxTokens: 4000 })
  return extractJson<PaperOutline>(text)
}

// ─────────────────────────────────────────────────────────────
// 2단계: 섹션별 초안 작성
// ─────────────────────────────────────────────────────────────
export async function generateSectionDraft(
  apiKey: string,
  model: string,
  outline: PaperOutline,
  sectionId: string,
  research: string,
): Promise<SectionDraft> {
  const section = outline.sections.find((s) => s.id === sectionId)
  if (!section) throw new Error(`섹션을 찾을 수 없습니다: ${sectionId}`)

  const system =
    '당신은 학술 논문 본문을 작성하는 전문 과학 저술가입니다. 근거가 필요한 주장에는 반드시 [Ref] 표시를 남깁니다.'

  const prompt = `아래 논문의 "${section.title}" 섹션 본문을 작성하세요.

[논문 제목] ${outline.title}
[전체 초록] ${outline.abstract}
[이 섹션의 목표] ${section.summary}
[원 연구 내용] ${research}

작성 규칙:
- 학술적이고 객관적인 문체의 한국어로 작성 (전문 용어는 영문 병기)
- 선행연구 인용/배경지식/통계 등 외부 근거가 필요한 문장 끝에는 반드시 [Ref] 를 붙입니다.
- 표제(##) 없이 본문만 작성합니다.
- 과장하거나 데이터에 없는 내용을 지어내지 않습니다.

본문만 출력하세요.`

  const content = await callClaude({ apiKey, model, system, prompt, maxTokens: 4000 })
  return { id: section.id, title: section.title, content: content.trim() }
}

// ─────────────────────────────────────────────────────────────
// 3단계: PubMed 근거 보강
// ─────────────────────────────────────────────────────────────

interface ClaimPlan {
  placeholder: string
  claimType: string
  query: string
}

/** 초안에서 검증이 필요한 주장과 PubMed 검색 질의를 추출 */
async function planCitations(
  apiKey: string,
  model: string,
  draft: SectionDraft,
  keywords: string,
): Promise<ClaimPlan[]> {
  const system =
    '당신은 과학 논문의 주장을 검증 가능한 단위로 분해하고, 각 주장을 뒷받침할 PubMed 검색 질의를 만드는 전문가입니다.'

  const prompt = `다음 섹션 초안에서 [Ref] 로 표시된(또는 근거가 필요한) 주장들을 찾아, 각 주장을 검증할 PubMed 검색 질의를 만드세요.

[핵심 키워드] ${keywords}

[섹션 초안]
${draft.content}

아래 JSON 배열로만 응답하세요. 각 항목은 하나의 인용 위치입니다.
[
  {
    "placeholder": "[Ref]",
    "claimType": "background | method | result | comparison 중 하나",
    "query": "PubMed 검색에 바로 쓸 영어 질의 (MeSH/키워드 조합)"
  }
]
근거가 필요한 주장이 없으면 [] 를 출력하세요.`

  const text = await callClaude({ apiKey, model, system, prompt, maxTokens: 2000 })
  try {
    return extractJson<ClaimPlan[]>(text)
  } catch {
    return []
  }
}

/** 가져온 PubMed 문헌만 사용해 섹션을 다시 쓰고 [PMID:xxxx] 를 연결 */
async function rewriteWithEvidence(
  apiKey: string,
  model: string,
  draft: SectionDraft,
  articles: PubMedArticle[],
): Promise<{ content: string; usedPmids: string[] }> {
  // 검색된 문헌이 하나도 없으면 원문 그대로 유지 (안전장치)
  if (articles.length === 0) {
    return { content: draft.content, usedPmids: [] }
  }

  const system =
    '당신은 과학 논문 편집자입니다. 제공된 PubMed 문헌 목록에 실제로 존재하는 PMID 만 사용해 인용을 답니다. ' +
    '목록에 없는 문헌은 절대 만들어내지 않습니다.'

  const refList = articles
    .map(
      (a) =>
        `- PMID:${a.pmid} | ${a.title} | ${a.journal} (${a.pubDate})${
          a.abstract ? `\n  초록: ${a.abstract.slice(0, 500)}` : ''
        }`,
    )
    .join('\n')

  const prompt = `아래 섹션 초안의 [Ref] 위치를, 제공된 PubMed 문헌 중 가장 적합한 것의 [PMID:번호] 로 교체하세요.

[제공된 PubMed 문헌]
${refList}

[섹션 초안]
${draft.content}

규칙:
- 위 목록에 있는 PMID 만 사용합니다. 적합한 문헌이 없는 [Ref] 는 그냥 제거합니다.
- 한 위치에 여러 문헌이 적합하면 [PMID:1234][PMID:5678] 처럼 나열할 수 있습니다.
- 본문 내용/논지는 유지하되 인용만 정확히 연결합니다.
- 본문만 출력하세요 (설명 금지).`

  const content = await callClaude({ apiKey, model, system, prompt, maxTokens: 4000 })

  // 실제로 본문에 들어간 PMID 추출
  const usedPmids = [...content.matchAll(/\[PMID:(\d+)\]/g)].map((m) => m[1])
  const valid = new Set(articles.map((a) => a.pmid))
  const usedValid = [...new Set(usedPmids)].filter((p) => valid.has(p))

  return { content: content.trim(), usedPmids: usedValid }
}

/** 한 섹션에 대한 전체 PubMed 보강 파이프라인 */
export async function enhanceSectionWithPubMed(
  apiKey: string,
  model: string,
  draft: SectionDraft,
  keywords: string,
): Promise<CitationEnhancement> {
  // 1) 주장/질의 추출
  const plans = await planCitations(apiKey, model, draft, keywords)

  // 2) 질의별 PubMed 검색 (중복 질의 제거)
  const uniqueQueries = [...new Set(plans.map((p) => p.query).filter(Boolean))]
  const searchResults = await Promise.all(
    uniqueQueries.map((q) => searchPubMedBundle(q, 5)),
  )

  // 모든 검색 결과를 PMID 맵으로 병합
  const articleMap = new Map<string, PubMedArticle>()
  for (const list of searchResults) {
    for (const a of list) articleMap.set(a.pmid, a)
  }
  const allArticles = [...articleMap.values()]

  // 3) 검색된 문헌만으로 본문 재작성
  const { content, usedPmids } = await rewriteWithEvidence(
    apiKey,
    model,
    draft,
    allArticles,
  )

  // 4) 실제 사용된 PMID 만 참고문헌으로 구성 (Claude 환각 PMID 제거)
  const references: CitationRef[] = usedPmids
    .map((pmid): CitationRef | null => {
      const a = articleMap.get(pmid)
      if (!a) return null
      return {
        pmid: a.pmid,
        title: a.title,
        journal: a.journal,
        pubDate: a.pubDate,
        doi: a.doi,
      }
    })
    .filter((r): r is CitationRef => r !== null)

  // 인용 메타데이터 (UI 표시용): plan + 매칭된 PMID
  const citations: CitationMeta[] = plans.map((p, i) => ({
    placeholder: p.placeholder,
    claimType: p.claimType,
    query: p.query,
    pmid: usedPmids[i],
  }))

  return {
    sectionId: draft.id,
    sectionTitle: draft.title,
    content,
    citations,
    references,
    searchedArticles: allArticles.slice(0, 8),
  }
}

// ─────────────────────────────────────────────────────────────
// 4단계: 리뷰 에이전트
// ─────────────────────────────────────────────────────────────
export async function reviewPaper(
  apiKey: string,
  model: string,
  outline: PaperOutline,
  fullText: string,
): Promise<ReviewResult> {
  const system =
    '당신은 까다롭지만 공정한 동료 심사자(Reviewer #2)입니다. 논리적 비약, 근거 부족, 가독성, 구조적 문제를 날카롭게 지적합니다.'

  const prompt = `다음 논문 초안을 동료 심사자 관점에서 평가하세요.

[제목] ${outline.title}

[본문]
${fullText.slice(0, 12000)}

아래 JSON 으로만 응답하세요.
{
  "summary": "전체 총평 2~3문장",
  "scores": { "novelty": 0~10, "rigor": 0~10, "clarity": 0~10, "evidence": 0~10 },
  "issues": [
    {
      "severity": "major | minor",
      "category": "logic | evidence | readability | structure",
      "section": "관련 섹션 제목(없으면 빈 문자열)",
      "comment": "문제점",
      "suggestion": "구체적 개선 제안"
    }
  ],
  "recommendation": "accept | minor revision | major revision | reject 중 하나와 이유"
}`

  const text = await callClaude({ apiKey, model, system, prompt, maxTokens: 4000 })
  return extractJson<ReviewResult>(text)
}

// ─────────────────────────────────────────────────────────────
// 최종 논문 조립 (참고문헌 병합/중복 제거)
// ─────────────────────────────────────────────────────────────
export function assembleFinalPaper(
  outline: PaperOutline,
  enhancements: CitationEnhancement[],
): string {
  const lines: string[] = []
  lines.push(`# ${outline.title}\n`)
  lines.push(`## 초록\n\n${outline.abstract}\n`)
  if (outline.keywords?.length) {
    lines.push(`**키워드:** ${outline.keywords.join(', ')}\n`)
  }

  for (const enh of enhancements) {
    lines.push(`## ${enh.sectionTitle}\n\n${enh.content}\n`)
  }

  // 모든 섹션의 references 병합 후 PMID 기준 중복 제거
  const merged = new Map<string, CitationRef>()
  for (const enh of enhancements) {
    for (const ref of enh.references) {
      if (!merged.has(ref.pmid)) merged.set(ref.pmid, ref)
    }
  }

  if (merged.size > 0) {
    lines.push('## 참고문헌\n')
    let i = 1
    for (const ref of merged.values()) {
      const doi = ref.doi ? ` doi:${ref.doi}.` : ''
      lines.push(
        `${i}. ${ref.title}. *${ref.journal}*. ${ref.pubDate}. PMID: ${ref.pmid}.${doi}`,
      )
      i++
    }
  }

  return lines.join('\n')
}

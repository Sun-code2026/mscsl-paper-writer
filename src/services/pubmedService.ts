import type { PubMedArticle } from '../types'

// NCBI E-utilities 연동 모듈
// - esearch.fcgi : 검색 -> PMID 목록
// - esummary.fcgi: PMID -> 제목/저널/출판일/DOI
// - efetch.fcgi  : PMID -> XML(초록)
// 모든 요청에 tool/email 파라미터를 붙이는 것이 NCBI 권장사항입니다.

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const TOOL = 'mitos_paper_writer'
const EMAIL = 'insulin2021@gmail.com'

/** tool/email 을 항상 포함하는 URL 생성기 */
function buildUrl(endpoint: string, params: Record<string, string>): string {
  const url = new URL(`${EUTILS_BASE}/${endpoint}`)
  url.searchParams.set('tool', TOOL)
  url.searchParams.set('email', EMAIL)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return url.toString()
}

/** XML 텍스트에서 DOMParser 우선, 없으면 정규식 fallback 으로 안전 파싱 */
function parseAbstractsFromXml(xml: string): Record<string, string> {
  const result: Record<string, string> = {}

  // 1) 브라우저 DOMParser 경로
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(xml, 'text/xml')
      const articles = doc.getElementsByTagName('PubmedArticle')
      for (let i = 0; i < articles.length; i++) {
        const article = articles[i]
        const pmid = article.getElementsByTagName('PMID')[0]?.textContent?.trim()
        if (!pmid) continue
        const abstractNodes = article.getElementsByTagName('AbstractText')
        const parts: string[] = []
        for (let j = 0; j < abstractNodes.length; j++) {
          const label = abstractNodes[j].getAttribute('Label')
          const text = abstractNodes[j].textContent?.trim() ?? ''
          if (!text) continue
          parts.push(label ? `${label}: ${text}` : text)
        }
        if (parts.length > 0) result[pmid] = parts.join('\n')
      }
      if (Object.keys(result).length > 0) return result
    } catch {
      // 아래 정규식 fallback 으로 진행
    }
  }

  // 2) 정규식 fallback (DOMParser 부재 또는 파싱 실패 시)
  const blocks = xml.split(/<PubmedArticle[ >]/).slice(1)
  for (const block of blocks) {
    const pmidMatch = block.match(/<PMID[^>]*>(\d+)<\/PMID>/)
    if (!pmidMatch) continue
    const pmid = pmidMatch[1]
    const absMatches = [...block.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)]
    const parts = absMatches
      .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
      .filter(Boolean)
    if (parts.length > 0) result[pmid] = parts.join('\n')
  }
  return result
}

/** esearch: 검색어로 PMID 목록을 가져옵니다. 실패 시 빈 배열. */
export async function searchPmids(query: string, retmax = 8): Promise<string[]> {
  try {
    const url = buildUrl('esearch.fcgi', {
      db: 'pubmed',
      term: query,
      retmax: String(retmax),
      retmode: 'json',
      sort: 'relevance',
    })
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    const ids: string[] = data?.esearchresult?.idlist ?? []
    return Array.isArray(ids) ? ids : []
  } catch {
    return []
  }
}

/** esummary: PMID 별 제목/저널/출판일/DOI. 실패 시 빈 객체. */
export async function fetchSummaries(
  pmids: string[],
): Promise<Record<string, PubMedArticle>> {
  if (pmids.length === 0) return {}
  try {
    const url = buildUrl('esummary.fcgi', {
      db: 'pubmed',
      id: pmids.join(','),
      retmode: 'json',
    })
    const res = await fetch(url)
    if (!res.ok) return {}
    const data = await res.json()
    const uids: string[] = data?.result?.uids ?? []
    const out: Record<string, PubMedArticle> = {}
    for (const uid of uids) {
      const item = data.result[uid]
      if (!item) continue
      let doi: string | undefined
      if (Array.isArray(item.articleids)) {
        const doiEntry = item.articleids.find(
          (a: { idtype?: string; value?: string }) => a.idtype === 'doi',
        )
        doi = doiEntry?.value
      }
      out[uid] = {
        pmid: uid,
        title: (item.title ?? '').replace(/\.$/, '').trim(),
        journal: item.fulljournalname || item.source || '',
        pubDate: item.pubdate || item.epubdate || '',
        doi,
      }
    }
    return out
  } catch {
    return {}
  }
}

/** efetch: PMID 별 초록(XML). 실패 시 빈 객체. */
export async function fetchAbstracts(
  pmids: string[],
): Promise<Record<string, string>> {
  if (pmids.length === 0) return {}
  try {
    const url = buildUrl('efetch.fcgi', {
      db: 'pubmed',
      id: pmids.join(','),
      retmode: 'xml',
      rettype: 'abstract',
    })
    const res = await fetch(url)
    if (!res.ok) return {}
    const xml = await res.text()
    return parseAbstractsFromXml(xml)
  } catch {
    return {}
  }
}

/**
 * 검색 -> 요약 -> 초록 을 한 번에 수행하여 PubMedArticle[] 반환.
 * 어떤 단계가 실패해도 throw 하지 않고 가능한 범위의 결과를 돌려줍니다.
 */
export async function searchPubMedBundle(
  query: string,
  retmax = 8,
): Promise<PubMedArticle[]> {
  const pmids = await searchPmids(query, retmax)
  if (pmids.length === 0) return []

  const [summaries, abstracts] = await Promise.all([
    fetchSummaries(pmids),
    fetchAbstracts(pmids),
  ])

  return pmids
    .map((pmid) => {
      const s = summaries[pmid]
      if (!s) return null
      return { ...s, abstract: abstracts[pmid] } as PubMedArticle
    })
    .filter((a): a is PubMedArticle => a !== null)
}

/** PubMed 문헌 링크 */
export function pubmedLink(pmid: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
}

/** PubMed 검색 페이지 링크 (PMID 없을 때) */
export function pubmedSearchLink(query: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`
}

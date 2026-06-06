// 앱 전반에서 공유하는 타입 정의

/** 아웃라인의 한 섹션 */
export interface OutlineSection {
  id: string
  title: string
  /** 이 섹션에서 다룰 핵심 내용 요약 */
  summary: string
}

/** 시각화(그림/표) 제안 */
export interface VisualizationSuggestion {
  title: string
  /** 'figure' | 'table' | 'flowchart' 등 자유 문자열 */
  type: string
  description: string
}

/** 1단계: 논문 아웃라인 */
export interface PaperOutline {
  title: string
  abstract: string
  keywords: string[]
  sections: OutlineSection[]
  visualizations: VisualizationSuggestion[]
}

/** 2단계: 섹션 본문 초안 */
export interface SectionDraft {
  id: string
  title: string
  content: string
}

/** PubMed 문헌 한 건 */
export interface PubMedArticle {
  pmid: string
  title: string
  journal: string
  pubDate: string
  doi?: string
  abstract?: string
}

/** 인용 1건 (참고문헌 항목) */
export interface CitationRef {
  pmid: string
  title: string
  journal: string
  pubDate: string
  doi?: string
}

/** 보강 단계에서 만들어진 인용 placeholder 메타데이터 */
export interface CitationMeta {
  /** 본문의 [Ref] 등을 대체한 위치 표시자 */
  placeholder: string
  /** 근거가 필요한 주장 유형 (예: 'background', 'method', 'result') */
  claimType: string
  /** PubMed 검색 질의 */
  query: string
  /** 매칭된 PubMed PMID (없으면 검색 페이지로 링크) */
  pmid?: string
}

/** 3단계: 섹션별 PubMed 근거 보강 결과 */
export interface CitationEnhancement {
  sectionId: string
  sectionTitle: string
  /** [PMID:xxxx] 가 삽입된 보강 본문 */
  content: string
  citations: CitationMeta[]
  references: CitationRef[]
  /** 실제로 PubMed에서 검색된 문헌 (미리보기용) */
  searchedArticles: PubMedArticle[]
}

/** 4단계: 리뷰 에이전트 결과 */
export interface ReviewIssue {
  /** 'major' | 'minor' */
  severity: string
  /** 'logic' | 'evidence' | 'readability' | 'structure' 등 */
  category: string
  /** 관련 섹션 제목(있으면) */
  section?: string
  comment: string
  suggestion: string
}

export interface ReviewResult {
  summary: string
  scores: {
    novelty: number
    rigor: number
    clarity: number
    evidence: number
  }
  issues: ReviewIssue[]
  recommendation: string
}

/** 진행 단계 */
export type Stage = 'outline' | 'draft' | 'citation' | 'review' | 'final'

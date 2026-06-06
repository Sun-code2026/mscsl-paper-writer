import { useEffect, useState } from 'react'
import type {
  PaperOutline,
  SectionDraft,
  CitationEnhancement,
  ReviewResult,
  Stage,
} from '../types'
import {
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  generateOutline,
  generateSectionDraft,
  enhanceSectionWithPubMed,
  reviewPaper,
  assembleFinalPaper,
} from '../services/paperService'
import { pubmedLink, pubmedSearchLink } from '../services/pubmedService'

const KEY_STORAGE = 'anthropic_api_key'
const MODEL_STORAGE = 'anthropic_model'

const STEP_LABELS: { stage: Stage; label: string }[] = [
  { stage: 'outline', label: '1. 아웃라인' },
  { stage: 'draft', label: '2. 초안 작성' },
  { stage: 'citation', label: '3. PubMed 보강' },
  { stage: 'review', label: '4. 리뷰' },
  { stage: 'final', label: '완성' },
]

export default function PaperWriter() {
  // 입력 상태
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [research, setResearch] = useState('')
  const [keywords, setKeywords] = useState('')

  // 파이프라인 결과
  const [outline, setOutline] = useState<PaperOutline | null>(null)
  const [drafts, setDrafts] = useState<SectionDraft[]>([])
  const [enhancements, setEnhancements] = useState<CitationEnhancement[]>([])
  const [review, setReview] = useState<ReviewResult | null>(null)
  const [finalPaper, setFinalPaper] = useState('')

  // UI 상태
  const [stage, setStage] = useState<Stage>('outline')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  // 저장된 키/모델 복원
  useEffect(() => {
    const k = localStorage.getItem(KEY_STORAGE)
    if (k) setApiKey(k)
    const m = localStorage.getItem(MODEL_STORAGE)
    if (m) setModel(m)
  }, [])

  function saveKey(v: string) {
    setApiKey(v)
    localStorage.setItem(KEY_STORAGE, v)
  }
  function saveModel(v: string) {
    setModel(v)
    localStorage.setItem(MODEL_STORAGE, v)
  }

  const keyValid = apiKey.startsWith('sk-ant-')
  const completed: Record<Stage, boolean> = {
    outline: !!outline,
    draft: drafts.length > 0,
    citation: enhancements.length > 0,
    review: !!review,
    final: !!finalPaper,
  }

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setError('')
    setBusy(true)
    setProgress(label)
    try {
      return await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return undefined
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  // 1단계
  async function handleOutline() {
    const result = await run('아웃라인 생성 중...', () =>
      generateOutline(apiKey, model, research, keywords),
    )
    if (result) {
      setOutline(result)
      setDrafts([])
      setEnhancements([])
      setReview(null)
      setFinalPaper('')
      setStage('draft')
    }
  }

  // 2단계
  async function handleDrafts() {
    if (!outline) return
    const collected: SectionDraft[] = []
    await run('섹션 초안 작성 중...', async () => {
      for (const s of outline.sections) {
        setProgress(`초안 작성 중: ${s.title}`)
        const d = await generateSectionDraft(apiKey, model, outline, s.id, research)
        collected.push(d)
      }
    })
    if (collected.length > 0) {
      setDrafts(collected)
      setStage('citation')
    }
  }

  // 3단계
  async function handleCitations() {
    if (drafts.length === 0) return
    const collected: CitationEnhancement[] = []
    await run('PubMed 근거 보강 중...', async () => {
      for (const d of drafts) {
        setProgress(`PubMed 검색/보강 중: ${d.title}`)
        const enh = await enhanceSectionWithPubMed(apiKey, model, d, keywords)
        collected.push(enh)
      }
    })
    if (collected.length > 0) {
      setEnhancements(collected)
      setStage('review')
    }
  }

  // 4단계
  async function handleReview() {
    if (!outline || enhancements.length === 0) return
    const fullText = assembleFinalPaper(outline, enhancements)
    const result = await run('리뷰 에이전트 실행 중...', () =>
      reviewPaper(apiKey, model, outline, fullText),
    )
    if (result) {
      setReview(result)
      setFinalPaper(fullText)
      setStage('final')
    }
  }

  function copyFinal() {
    navigator.clipboard.writeText(finalPaper)
  }
  function downloadFinal() {
    const blob = new Blob([finalPaper], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(outline?.title || 'paper').replace(/[\\/:*?"<>|]/g, '_')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>🧬 자동 논문 작성기</h1>
        <p>
          연구 결과를 입력하면 Claude가 논문 초안을 작성하고, PubMed 실문헌으로 근거를
          보강한 뒤 리뷰까지 수행합니다.
        </p>
      </header>

      {/* 진행 단계 표시 */}
      <div className="steps">
        {STEP_LABELS.map(({ stage: s, label }) => (
          <span
            key={s}
            className={`step-chip ${stage === s ? 'active' : ''} ${
              completed[s] ? 'done' : ''
            }`}
          >
            {completed[s] ? '✓ ' : ''}
            {label}
          </span>
        ))}
      </div>

      {error && <div className="error">⚠️ {error}</div>}

      {/* API 키 + 모델 */}
      <div className="panel">
        <h2>① Anthropic API 키</h2>
        <div className="field">
          <label>API Key (브라우저 localStorage 에만 저장됩니다)</label>
          <input
            type="password"
            placeholder="sk-ant-..."
            value={apiKey}
            onChange={(e) => saveKey(e.target.value.trim())}
          />
          {!keyValid && apiKey.length > 0 && (
            <div className="hint">키는 sk-ant- 로 시작해야 합니다.</div>
          )}
          <div className="hint">
            키 발급:{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              Anthropic Console
            </a>
          </div>
        </div>
        <div className="field">
          <label>모델</label>
          <select value={model} onChange={(e) => saveModel(e.target.value)}>
            {MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 연구 내용 입력 */}
      <div className="panel">
        <h2>② 연구 내용 입력</h2>
        <div className="field">
          <label>연구 내용 (데이터·가설·핵심 아이디어)</label>
          <textarea
            placeholder="예) PHF20 결손이 골격근 미토콘드리아 생합성에 미치는 영향... 실험군/대조군 결과 수치..."
            value={research}
            onChange={(e) => setResearch(e.target.value)}
          />
        </div>
        <div className="field">
          <label>핵심 키워드 (PubMed 인용 검색에 사용, 쉼표 구분)</label>
          <input
            type="text"
            placeholder="PHF20, mitochondrial biogenesis, skeletal muscle, sarcopenia"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
        </div>
        <button
          onClick={handleOutline}
          disabled={busy || !keyValid || !research.trim()}
        >
          {busy && progress.includes('아웃라인') && <span className="spinner" />}
          1단계: 아웃라인 생성 시작
        </button>
      </div>

      {busy && progress && (
        <div className="panel">
          <span className="spinner" />
          {progress}
        </div>
      )}

      {/* 1단계 결과 */}
      {outline && (
        <div className="panel">
          <h2>📋 아웃라인</h2>
          <h3>{outline.title}</h3>
          <p className="small muted">{outline.abstract}</p>
          <div style={{ margin: '8px 0' }}>
            {outline.keywords?.map((k) => (
              <span className="tag" key={k}>
                {k}
              </span>
            ))}
          </div>
          {outline.sections.map((s) => (
            <div className="section-card" key={s.id}>
              <h3>{s.title}</h3>
              <div className="content muted small">{s.summary}</div>
            </div>
          ))}
          {outline.visualizations?.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>시각화 제안</h3>
              {outline.visualizations.map((v, i) => (
                <div className="section-card" key={i}>
                  <h3>
                    <span className="tag">{v.type}</span>
                    {v.title}
                  </h3>
                  <div className="content muted small">{v.description}</div>
                </div>
              ))}
            </>
          )}
          <button onClick={handleDrafts} disabled={busy}>
            {busy && progress.includes('초안') && <span className="spinner" />}
            2단계: 전체 섹션 초안 작성
          </button>
        </div>
      )}

      {/* 2단계 결과 */}
      {drafts.length > 0 && (
        <div className="panel">
          <h2>✍️ 섹션 초안 ({drafts.length}개)</h2>
          {drafts.map((d) => (
            <div className="section-card" key={d.id}>
              <h3>{d.title}</h3>
              <div className="content">{d.content}</div>
            </div>
          ))}
          <button onClick={handleCitations} disabled={busy}>
            {busy && progress.includes('PubMed') && <span className="spinner" />}
            3단계: 전체 PubMed 근거 보강
          </button>
        </div>
      )}

      {/* 3단계 결과 */}
      {enhancements.length > 0 && (
        <div className="panel">
          <h2>🔬 PubMed 근거 보강</h2>
          {enhancements.map((enh) => (
            <div className="section-card" key={enh.sectionId}>
              <h3>{enh.sectionTitle}</h3>
              <div className="stat-row">
                <span className="stat">
                  인용 <b>{enh.citations.length}</b>개
                </span>
                <span className="stat">
                  참고문헌 <b>{enh.references.length}</b>개
                </span>
                <span className="stat">
                  검색문헌 <b>{enh.searchedArticles.length}</b>개
                </span>
              </div>

              {enh.citations.length > 0 && (
                <ul className="cite-list">
                  {enh.citations.map((c, i) => (
                    <li key={i}>
                      <span className="tag">{c.claimType}</span>
                      {c.placeholder} · 질의: <i>{c.query}</i> ·{' '}
                      {c.pmid ? (
                        <a href={pubmedLink(c.pmid)} target="_blank" rel="noreferrer">
                          PMID:{c.pmid}
                        </a>
                      ) : (
                        <a
                          href={pubmedSearchLink(c.query)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          PubMed 검색
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {enh.searchedArticles.length > 0 && (
                <>
                  <div className="small muted" style={{ marginTop: 10 }}>
                    검색된 PubMed 문헌 (미리보기 최대 3건):
                  </div>
                  <ul className="cite-list">
                    {enh.searchedArticles.slice(0, 3).map((a) => (
                      <li key={a.pmid}>
                        <a href={pubmedLink(a.pmid)} target="_blank" rel="noreferrer">
                          PMID:{a.pmid}
                        </a>{' '}
                        · {a.title}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ))}
          <button onClick={handleReview} disabled={busy}>
            {busy && progress.includes('리뷰') && <span className="spinner" />}
            4단계: 리뷰 에이전트 실행
          </button>
        </div>
      )}

      {/* 4단계 결과 */}
      {review && (
        <div className="panel">
          <h2>🧐 리뷰 (Reviewer #2)</h2>
          <p className="small">{review.summary}</p>
          <div className="scores">
            {Object.entries(review.scores).map(([k, v]) => (
              <div className="score-box" key={k}>
                <div className="v">{v}</div>
                <div className="k">{k}</div>
              </div>
            ))}
          </div>
          <div style={{ margin: '10px 0' }}>
            <span className="tag">추천</span>
            {review.recommendation}
          </div>
          {review.issues?.map((iss, i) => (
            <div className={`issue ${iss.severity}`} key={i}>
              <div className="meta">
                [{iss.severity}] {iss.category}
                {iss.section ? ` · ${iss.section}` : ''}
              </div>
              <div>{iss.comment}</div>
              <div className="muted small">→ {iss.suggestion}</div>
            </div>
          ))}
        </div>
      )}

      {/* 최종 결과물 */}
      {finalPaper && (
        <div className="panel">
          <h2>📄 최종 논문</h2>
          <div className="final-output">{finalPaper}</div>
          <div className="actions">
            <button className="secondary" onClick={copyFinal}>
              복사
            </button>
            <button onClick={downloadFinal}>Markdown 다운로드</button>
          </div>
        </div>
      )}
    </div>
  )
}

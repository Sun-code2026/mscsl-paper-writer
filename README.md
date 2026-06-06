# 🧬 자동 논문 작성기 (MSCSL Paper Writer)

**🔗 웹에서 바로 사용:** https://sun-code2026.github.io/mscsl-paper-writer/

연구 내용·가설·데이터를 입력하면 **Anthropic Claude** 로 논문 초안을 작성하고,
**PubMed 실문헌** 으로 근거를 보강한 뒤, 동료 심사(Reviewer #2) 리뷰까지 수행하는
React / Vite 기반 웹 앱입니다.

> 모든 처리는 브라우저에서 직접 이뤄집니다. API 키는 서버로 전송되지 않고
> 브라우저 `localStorage` 에만 저장됩니다.

## 파이프라인 (4단계)

1. **아웃라인 생성** — 연구 내용/키워드로부터 제목·초록·섹션 구성·시각화 제안을 JSON 으로 생성
2. **섹션별 초안 작성** — 각 섹션 본문을 작성하고, 근거가 필요한 위치에 `[Ref]` 표시
3. **PubMed 근거 보강** — 검증 대상 주장과 검색 질의를 만들고, NCBI E-utilities
   (`esearch` → `esummary` → `efetch`) 로 실문헌을 가져와 `[PMID:xxxx]` 로 연결.
   실제 검색된 PMID 와 매칭되지 않는 인용은 폐기 (환각 인용 방지)
4. **리뷰 에이전트** — 논리적 비약·근거 부족·가독성·구조 문제를 평가

최종 결과물은 각 섹션의 보강 본문과, 중복 제거된 `## 참고문헌` 을 포함합니다.
화면에서 복사하거나 Markdown 으로 다운로드할 수 있습니다.

## 안전장치

- PubMed 호출 실패 시 throw 하지 않고 빈 결과 반환
- DOMParser 부재 시 정규식 fallback 으로 초록 파싱
- Claude 가 반환한 PMID 를 실제 검색 결과와 대조하여 미존재 인용 제거
- 검색된 문헌이 없으면 원문 초안을 그대로 유지

## 로컬 실행

```bash
npm install
npm run dev
```

브라우저에서 안내된 주소(기본 http://localhost:5173)로 접속한 뒤,
Anthropic API 키(`sk-ant-...`)를 입력하고 연구 내용을 작성하세요.

## 빌드

```bash
npm run build      # dist/ 생성
npm run preview    # 빌드 결과 미리보기
```

## 배포 (GitHub Pages)

`main` 브랜치에 푸시하면 `.github/workflows/deploy.yml` 가 자동으로 빌드 후
GitHub Pages 에 배포합니다. 저장소 **Settings → Pages → Source** 를
**GitHub Actions** 로 설정하세요.

## 기술 스택

- React 18 + TypeScript + Vite
- Anthropic Messages API (브라우저 직접 호출)
- NCBI PubMed E-utilities

## 주의

- Anthropic API 사용량에 따라 비용이 발생합니다.
- 생성된 초안은 **반드시 사람이 검토·수정** 해야 합니다. AI 가 만든 문장과 인용은
  투고 전 원문 검증이 필요합니다.

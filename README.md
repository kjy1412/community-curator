# 🤖 커뮤니티 AI 큐레이터

루리웹 유머베스트 · 뽐뿌 · 클리앙 글을 수집하고,
**Gemini 1.5 Flash (완전 무료)** 로 흥미도를 채점해서 RSS 피드로 제공합니다.

**비용: 완전 무료** (GitHub Actions + GitHub Pages + Gemini 무료 티어)

---

## 소스별 RSS 현황

| 사이트 | RSS 방식 | 수집 범위 |
|--------|----------|-----------|
| 루리웹 유머베스트 | ✅ 공식 RSS | 추천수 기준 베스트글만 |
| 뽐뿌 | ✅ 공식 RSS | 전체 게시물 |
| 클리앙 | ⚠️ 비공식 시도 | 실패 시 자동 스킵 |

---

## 설치 방법 (10분)

### 1단계 — 저장소 복사
GitHub에서 **Fork** 또는 파일 직접 업로드

### 2단계 — Gemini API 키 발급 (무료)
1. [aistudio.google.com](https://aistudio.google.com) 접속
2. 좌측 **Get API key** → **Create API key** → 복사
3. 저장소 → **Settings** → **Secrets and variables** → **Actions**
4. **New repository secret**
   - Name: `GEMINI_API_KEY`
   - Value: 복사한 키

### 3단계 — GitHub Pages 활성화
저장소 → **Settings** → **Pages** → Branch: `main` / Folder: `/docs` → **Save**

### 4단계 — 첫 실행
저장소 → **Actions** → **커뮤니티 큐레이션** → **Run workflow**
약 1~2분 후 완료

### 5단계 — RSS 구독
```
https://YOUR_USERNAME.github.io/community-curator/feed.xml
```

---

## 자동 실행 일정 (KST)
- 오전 8시
- 낮 12시
- 오후 6시

---

## Gemini 무료 티어 한도
- 분당 15회 요청
- 하루 1,500회 요청
- 이 프로젝트는 하루 3회 실행, 회당 2~3회 요청 → **한도의 1%도 안 씀**

---

## 커스터마이징

`scripts/curate.js` 상단 설정:

```js
const MIN_AI_SCORE = 70;         // 몇 점 이상만 피드에 포함
const MAX_FEED_ITEMS = 30;       // 최대 항목 수
const MAX_ITEMS_PER_SOURCE = 15; // 소스당 가져올 글 수
```

루리웹 다른 게시판 추가 예시:
```js
{ name: '루리웹 정보게시판', url: 'https://bbs.ruliweb.com/community/board/300148/rss', category: '정보' }
```

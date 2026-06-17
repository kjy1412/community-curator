const axios = require('axios');
const xml2js = require('xml2js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }); // 무료 티어 사용

// ──────────────────────────────────────────
// 설정
// ──────────────────────────────────────────
const SOURCES = [
  {
    name: '루리웹 유머베스트',
    url: 'https://bbs.ruliweb.com/best/board/300143/rss',
    category: '유머',
  },
  {
    name: '뽐뿌',
    url: 'https://www.ppomppu.co.kr/rss.php?id=ppomppu',
    category: '핫딜/정보',
  },
  {
    name: '클리앙',
    url: 'https://www.clien.net/service/rss',
    fallbackUrl: 'https://www.clien.net/service/board/cm_cmr/rss',
    category: 'IT/종합',
  },
];

const MAX_ITEMS_PER_SOURCE = 15;
const MIN_AI_SCORE = 70;
const MAX_FEED_ITEMS = 30;

// ──────────────────────────────────────────
// 1. RSS 수집
// ──────────────────────────────────────────
async function fetchRSS(source) {
  const urls = [source.url, source.fallbackUrl].filter(Boolean);

  for (const url of urls) {
    try {
      console.log(`  [${source.name}] 시도: ${url}`);
      const res = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CommunityCurator/1.0)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        },
      });

      const parsed = await xml2js.parseStringPromise(res.data, { explicitArray: false });
      const channel = parsed?.rss?.channel || parsed?.feed;
      if (!channel) throw new Error('채널 파싱 실패');

      const items = channel?.item || channel?.entry || [];
      const list = Array.isArray(items) ? items : [items];

      const results = [];
      for (const item of list.slice(0, MAX_ITEMS_PER_SOURCE)) {
        const title = stripCDATA(item.title || '').trim();
        const link = item.link?.$ ? item.link.$['href'] : (item.link || '');
        const pubDate = item.pubDate || item.updated || new Date().toUTCString();
        const description = stripCDATA(item.description || item.summary || '')
          .replace(/<[^>]+>/g, '')
          .trim()
          .slice(0, 200);

        if (title.length > 2) {
          results.push({ title, link, pubDate, description, source: source.name, category: source.category });
        }
      }

      console.log(`  [${source.name}] ✅ ${results.length}개 수집`);
      return results;

    } catch (e) {
      console.warn(`  [${source.name}] ❌ 실패: ${e.message}`);
    }
  }

  console.warn(`  [${source.name}] ⚠️ 스킵`);
  return [];
}

function stripCDATA(str) {
  return String(str).replace(/<!\[CDATA\[|\]\]>/g, '').trim();
}

// ──────────────────────────────────────────
// 2. Gemini AI 큐레이션
// ──────────────────────────────────────────
async function curateWithGemini(items) {
  const listText = items
    .map((item, i) => `${i + 1}. [${item.source}] ${item.title}\n   ${item.description}`)
    .join('\n\n');

  const prompt = `다음은 국내 커뮤니티의 최신 글 목록입니다.
각 글에 대해 평가해서 JSON 배열만 반환하세요. 마크다운 코드블록 없이 순수 JSON만 출력하세요.

평가 기준:
- score (0~100): 정보 가치, 실용성, 흥미도, 독창성 종합
- summary: 핵심 내용 2문장 요약 (왜 읽을 만한지 포함)
- tag: 유머/정보/리뷰/핫딜/이슈/뉴스/기타 중 하나

글 목록:
${listText}

반환 형식 (순수 JSON 배열만, 글 순서 그대로):
[{"score":85,"summary":"요약","tag":"유머"},...]`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error('Gemini 큐레이션 실패:', e.message);
    // 실패 시 기본값 반환 (스크립트가 멈추지 않도록)
    return items.map(() => ({ score: 50, summary: '요약 불가', tag: '기타' }));
  }
}

// ──────────────────────────────────────────
// 3. RSS XML 생성
// ──────────────────────────────────────────
function generateRSS(curatedItems) {
  const now = new Date().toUTCString();
  const kstNow = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  const itemsXML = curatedItems.map(item => `
  <item>
    <title><![CDATA[[${item.tag}][${item.score}점] ${item.title}]]></title>
    <link>${escapeXML(item.link)}</link>
    <description><![CDATA[
      <p><strong>📊 AI 흥미도: ${item.score}점 | 🏷️ ${item.tag} | 📰 ${item.source}</strong></p>
      <p><strong>✨ AI 요약:</strong> ${item.summary}</p>
      <hr/>
      <p>${item.description}</p>
    ]]></description>
    <pubDate>${item.pubDate}</pubDate>
    <category>${item.category}</category>
    <guid isPermaLink="false">${escapeXML(item.link)}-${Date.now()}</guid>
  </item>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>커뮤니티 AI 큐레이터 (루리웹·뽐뿌·클리앙)</title>
    <link>https://your-username.github.io/community-curator</link>
    <description>AI가 선별한 루리웹·뽐뿌·클리앙 인기글 (${kstNow} 업데이트)</description>
    <language>ko</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="https://your-username.github.io/community-curator/feed.xml" rel="self" type="application/rss+xml"/>
    <ttl>60</ttl>
${itemsXML}
  </channel>
</rss>`;
}

function escapeXML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────
// 4. 상태 페이지 HTML 생성
// ──────────────────────────────────────────
function generateHTML(curatedItems, fetchStats) {
  const kstNow = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  const statsHTML = fetchStats.map(s =>
    `<span class="stat ${s.count > 0 ? 'ok' : 'fail'}">
      ${s.count > 0 ? '✅' : '❌'} ${s.name} ${s.count > 0 ? s.count + '개' : '수집 실패'}
    </span>`
  ).join('');

  const rows = curatedItems.map(item => `
    <tr>
      <td><a href="${item.link}" target="_blank" rel="noopener">${item.title}</a></td>
      <td>${item.source}</td>
      <td><span class="tag">${item.tag}</span></td>
      <td class="score ${item.score >= 80 ? 'high' : item.score >= 70 ? 'mid' : 'low'}">${item.score}</td>
      <td>${item.summary}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>커뮤니티 AI 큐레이터</title>
<style>
body{font-family:-apple-system,sans-serif;max-width:980px;margin:0 auto;padding:2rem 1rem;color:#1a1a1a;background:#f8f8f5}
h1{font-size:22px;margin-bottom:.4rem}
.meta{font-size:13px;color:#888;margin-bottom:1rem}
.stats{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:1.25rem}
.stat{font-size:12px;padding:4px 12px;border-radius:6px;border:1px solid #e0e0dc;background:#fff}
.stat.ok{border-color:#B5D4B4;background:#F0FAF0}
.stat.fail{border-color:#F4BCBC;background:#FFF0F0;color:#c0392b}
.rss-link{display:inline-flex;align-items:center;gap:6px;font-size:13px;padding:7px 16px;background:#1a73e8;color:#fff;border-radius:8px;text-decoration:none;margin-bottom:1.5rem;font-weight:500}
.powered{font-size:11px;color:#aaa;margin-bottom:1.5rem}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)}
th{background:#1a1a1a;color:#fff;font-size:13px;font-weight:500;padding:10px 14px;text-align:left}
td{font-size:13px;padding:10px 14px;border-bottom:1px solid #f0f0ec;vertical-align:top}
tr:last-child td{border-bottom:none}
tr:hover td{background:#fafaf8}
td a{color:#185FA5;text-decoration:none}
td a:hover{text-decoration:underline}
.tag{font-size:11px;padding:2px 8px;border-radius:999px;background:#E6F1FB;color:#185FA5;white-space:nowrap}
.score{font-weight:700;font-size:15px;white-space:nowrap}
.score.high{color:#0F6E56}
.score.mid{color:#854F0B}
.score.low{color:#888}
</style>
</head>
<body>
<h1>🤖 커뮤니티 AI 큐레이터</h1>
<p class="meta">마지막 업데이트: ${kstNow} KST</p>
<div class="stats">${statsHTML}</div>
<a class="rss-link" href="feed.xml">RSS 피드 구독하기</a>
<p class="powered">✨ Powered by Gemini 1.5 Flash (무료)</p>
<table>
  <thead>
    <tr><th>제목</th><th>출처</th><th>태그</th><th>점수</th><th>AI 요약</th></tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
</body>
</html>`;
}

// ──────────────────────────────────────────
// 메인 실행
// ──────────────────────────────────────────
async function main() {
  console.log('=== 커뮤니티 큐레이션 시작 (Gemini) ===');

  // 1. RSS 수집
  const allItems = [];
  const fetchStats = [];
  for (const source of SOURCES) {
    const items = await fetchRSS(source);
    fetchStats.push({ name: source.name, count: items.length });
    allItems.push(...items);
  }
  console.log(`\n총 ${allItems.length}개 수집`);

  if (allItems.length === 0) {
    console.error('수집된 글 없음. 종료.');
    process.exit(1);
  }

  // 2. Gemini AI 큐레이션 (20개씩 배치)
  // 무료 티어: 분당 15회 제한 → 배치 사이 2초 대기
  console.log('\nGemini AI 큐레이션 시작...');
  const BATCH = 20;
  const aiResults = [];
  for (let i = 0; i < allItems.length; i += BATCH) {
    const batch = allItems.slice(i, i + BATCH);
    console.log(`  분석 중... (${i + 1}~${Math.min(i + BATCH, allItems.length)}번째)`);
    const results = await curateWithGemini(batch);
    aiResults.push(...results);
    if (i + BATCH < allItems.length) {
      await new Promise(r => setTimeout(r, 2000)); // 무료 티어 rate limit 방지
    }
  }

  // 3. 점수 합치기 & 필터링
  const scored = allItems.map((item, i) => ({
    ...item,
    score: aiResults[i]?.score ?? 50,
    summary: aiResults[i]?.summary ?? '',
    tag: aiResults[i]?.tag ?? '기타',
  }));

  const filtered = scored
    .filter(item => item.score >= MIN_AI_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FEED_ITEMS);

  console.log(`필터링 후 ${filtered.length}개 (${MIN_AI_SCORE}점 이상)`);

  // 4. 파일 생성
  const docsDir = path.join(__dirname, '..', 'docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'feed.xml'), generateRSS(filtered), 'utf8');
  fs.writeFileSync(path.join(docsDir, 'index.html'), generateHTML(filtered, fetchStats), 'utf8');

  console.log('\n=== 완료 ===');
  fetchStats.forEach(s => console.log(`  ${s.name}: ${s.count > 0 ? s.count + '개' : '❌ 실패'}`));
  console.log(`  최종 피드: ${filtered.length}개`);
}

main().catch(e => { console.error(e); process.exit(1); });

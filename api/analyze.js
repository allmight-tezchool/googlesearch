// ============================================
// 競合サイト Google流入数 自動推定 API
// ============================================
// Vercel Serverless Function として動作
// POST /api/analyze にURLを送ると、
// キーワード抽出 → 順位確認 → 流入推定 を全部自動でやる

import * as cheerio from 'cheerio';

// ============================================
// 設定値
// ============================================

// User-Agentのプール（ブロック回避用にランダムで切り替える）
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
];

// 検索順位ごとのクリック率（Advanced Web Ranking 公開データ参考）
const CTR_BY_POSITION = {
  1: 0.273, 2: 0.155, 3: 0.099, 4: 0.069, 5: 0.051,
  6: 0.038, 7: 0.030, 8: 0.025, 9: 0.020, 10: 0.018,
};
const CTR_OUT_OF_TOP10 = 0.005;  // 11位以下の平均CTR

// 1回の調査で確認するキーワードの上限
const MAX_KEYWORDS_TO_CHECK = 8;

// ============================================
// ユーティリティ
// ============================================

function pickUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ランダム待機（最小〜最大ms）
function randomSleep(min, max) {
  const ms = min + Math.floor(Math.random() * (max - min));
  return sleep(ms);
}

// URLからドメインだけ抜き出す（順位判定の比較に使う）
function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ============================================
// ステップ1: 競合サイトのHTMLを取得してキーワード抽出
// ============================================

async function fetchSiteAndExtractKeywords(targetUrl) {
  const res = await fetch(targetUrl, {
    headers: {
      'User-Agent': pickUserAgent(),
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ja,en;q=0.9',
    },
  });
  if (!res.ok) {
    throw new Error(`サイト取得失敗: ${res.status}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  // タイトル、h1〜h3、metaから単語を集める
  const sources = [];
  sources.push({ text: $('title').text(), weight: 5 });
  sources.push({ text: $('meta[name="description"]').attr('content') || '', weight: 4 });
  sources.push({ text: $('meta[name="keywords"]').attr('content') || '', weight: 5 });
  sources.push({ text: $('meta[property="og:title"]').attr('content') || '', weight: 4 });
  sources.push({ text: $('meta[property="og:description"]').attr('content') || '', weight: 3 });
  $('h1').each((_, el) => sources.push({ text: $(el).text(), weight: 4 }));
  $('h2').each((_, el) => sources.push({ text: $(el).text(), weight: 3 }));
  $('h3').each((_, el) => sources.push({ text: $(el).text(), weight: 2 }));

  // フレーズベースで重み付けスコアを作る
  // ・metaキーワードはカンマ区切りでそのまま採用
  // ・他はそのテキスト全体を1フレーズとして扱う + 長い場合は分割
  const phraseScores = new Map();

  function addPhrase(phrase, weight) {
    const cleaned = phrase
      .replace(/\s+/g, ' ')
      .replace(/[【】「」『』\[\]（）()｜|｜\/\\<>"']/g, ' ')
      .trim();
    if (!cleaned) return;
    if (cleaned.length < 2 || cleaned.length > 30) return;
    // 数字・記号オンリーは除外
    if (!/[一-龯ぁ-んァ-ヶa-zA-Z]/.test(cleaned)) return;
    phraseScores.set(cleaned, (phraseScores.get(cleaned) || 0) + weight);
  }

  for (const { text, weight } of sources) {
    if (!text) continue;
    // カンマ区切りも区切りとして処理
    text.split(/[,、，｜|\/／]/).forEach(part => {
      const t = part.trim();
      if (!t) return;
      // 区切り（｜・-）で分割して、両側のフレーズも候補に
      const subs = t.split(/\s[|｜\-–—]\s|[|｜]/).map(s => s.trim()).filter(Boolean);
      if (subs.length > 1) {
        subs.forEach(s => addPhrase(s, weight));
      } else {
        addPhrase(t, weight);
      }
    });
  }

  // スコア順に並べてトップN
  const ranked = [...phraseScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([phrase, score]) => ({ phrase, score }));

  // サイト名らしき単語（ドメインに含まれる、または全候補に頻出）を除外する簡易ロジック
  const domain = getDomain(targetUrl) || '';
  const domainParts = domain.split('.')[0];
  const filtered = ranked.filter(item =>
    !item.phrase.toLowerCase().includes(domainParts.toLowerCase()) &&
    item.phrase.length >= 3
  );

  const finalList = (filtered.length > 0 ? filtered : ranked)
    .slice(0, MAX_KEYWORDS_TO_CHECK)
    .map(item => item.phrase);

  return {
    title: $('title').text().trim(),
    keywords: finalList,
  };
}

// ============================================
// ステップ2: Google検索で順位を確認
// ============================================

async function checkRankOnGoogle(keyword, targetDomain) {
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&hl=ja&gl=jp&num=20`;

  // 1〜3秒のランダム待機（ブロック回避）
  await randomSleep(1000, 3000);

  let res;
  try {
    res = await fetch(searchUrl, {
      headers: {
        'User-Agent': pickUserAgent(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.9',
      },
    });
  } catch (e) {
    return { rank: null, error: 'fetch-failed' };
  }

  // ブロック判定
  if (res.status === 429 || res.status === 503) {
    return { rank: null, error: 'blocked', status: res.status };
  }
  if (!res.ok) {
    return { rank: null, error: `status-${res.status}` };
  }

  const html = await res.text();

  // 検索結果の判定: Googleの結果ページからURLを順番に抽出
  // 通常の検索結果は <a href="/url?q=https://..."> または <a href="https://..."> の形式
  const $ = cheerio.load(html);

  let rank = null;
  let position = 0;
  const seenDomains = new Set();

  $('a').each((_, el) => {
    if (rank !== null) return;
    let href = $(el).attr('href') || '';

    // /url?q=https://〜 形式を素のURLに直す
    if (href.startsWith('/url?')) {
      const match = href.match(/[?&]q=([^&]+)/);
      if (match) href = decodeURIComponent(match[1]);
    }

    if (!href.startsWith('http')) return;
    if (href.includes('google.com') || href.includes('googleusercontent.com')) return;
    if (href.includes('youtube.com/results')) return;

    // 順位として数えるか判定: ヘッダー(h3)を持つリンクが本物の検索結果に近い
    const hasH3 = $(el).find('h3').length > 0;
    if (!hasH3) return;

    const d = getDomain(href);
    if (!d) return;

    // 同じドメインの再カウント防止
    if (seenDomains.has(d)) return;
    seenDomains.add(d);

    position++;
    if (d === targetDomain || d.endsWith('.' + targetDomain) || targetDomain.endsWith('.' + d)) {
      rank = position;
    }
  });

  return { rank, totalChecked: position };
}

// ============================================
// ステップ3: 月間検索数の推定
// ============================================
// 完全自動で「正確な月間検索数」を取るのは無料では難しいので、
// キーワードの特徴（長さ・専門性）から概算レンジを当てはめる

function estimateSearchVolume(keyword) {
  const len = keyword.length;
  const hasGenericTerm = /(サービス|会社|企業|システム|ソフト|ツール|アプリ|採用|転職|求人)/.test(keyword);
  const isLongTail = (keyword.match(/[\s　]/g) || []).length >= 1 || len >= 10;

  // ヒューリスティック: 短く一般的 = ボリューム大、長く具体的 = ボリューム小
  if (len <= 4 && hasGenericTerm) return 30000;
  if (len <= 6 && hasGenericTerm) return 10000;
  if (len <= 8) return 3000;
  if (isLongTail && len >= 12) return 300;
  if (isLongTail) return 800;
  return 1500;
}

// ============================================
// ステップ4: 流入推定
// ============================================

function ctrFor(rank) {
  if (rank === null) return 0;
  if (rank <= 10) return CTR_BY_POSITION[rank];
  if (rank <= 20) return CTR_OUT_OF_TOP10;
  return 0;
}

function estimateTraffic(perKeywordResults) {
  let captured = 0;
  const detail = [];
  for (const r of perKeywordResults) {
    const vol = r.estimatedVolume;
    const ctr = ctrFor(r.rank);
    const traffic = Math.round(vol * ctr);
    captured += traffic;
    detail.push({
      keyword: r.keyword,
      rank: r.rank,
      estimatedVolume: vol,
      ctr: (ctr * 100).toFixed(2) + '%',
      estimatedTraffic: traffic,
      error: r.error || null,
    });
  }
  // 8キーワードでカバーできるのは全体の30%程度と仮定
  const captureRate = 0.30;
  const estimatedTotal = Math.round(captured / captureRate);
  return { detail, captured, estimatedTotal };
}

// ============================================
// メインハンドラ
// ============================================

export default async function handler(req, res) {
  // CORS（同一ドメインなら不要だが、テスト用に許可）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POSTのみ対応' });
    return;
  }

  try {
    const { url } = req.body || {};
    if (!url) {
      res.status(400).json({ error: 'urlパラメータが必須です' });
      return;
    }

    const targetDomain = getDomain(url);
    if (!targetDomain) {
      res.status(400).json({ error: 'URLの形式が不正です' });
      return;
    }

    // ステップ1: サイト取得 & キーワード抽出
    const { title, keywords } = await fetchSiteAndExtractKeywords(url);

    if (keywords.length === 0) {
      res.status(200).json({
        url,
        title,
        keywords: [],
        result: null,
        warning: 'キーワードを抽出できませんでした。サイトの内容を確認してください。',
      });
      return;
    }

    // ステップ2: 各キーワードについてGoogle順位を取得（順次・待機あり）
    const perKeywordResults = [];
    let blockedCount = 0;
    for (const kw of keywords) {
      const rankInfo = await checkRankOnGoogle(kw, targetDomain);

      if (rankInfo.error === 'blocked') {
        blockedCount++;
        // ブロック検知: 5秒待ってリトライ
        await sleep(5000);
        const retry = await checkRankOnGoogle(kw, targetDomain);
        perKeywordResults.push({
          keyword: kw,
          rank: retry.rank,
          estimatedVolume: estimateSearchVolume(kw),
          error: retry.error,
        });
      } else {
        perKeywordResults.push({
          keyword: kw,
          rank: rankInfo.rank,
          estimatedVolume: estimateSearchVolume(kw),
          error: rankInfo.error,
        });
      }
    }

    // ステップ3: 流入推定
    const trafficResult = estimateTraffic(perKeywordResults);

    res.status(200).json({
      url,
      domain: targetDomain,
      title,
      keywordsCount: keywords.length,
      blocked: blockedCount,
      result: trafficResult,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'サーバーエラー' });
  }
}

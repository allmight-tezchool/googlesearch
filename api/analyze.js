// ============================================
// 競合 MEO（Googleマップ）調査ツール API
// ============================================
// Vercel Serverless Function として動作
// POST /api/analyze にクエリを送ると、
// Google Places API で競合の評価・口コミ・順位を取得する
//
// 必要な環境変数:
//   GOOGLE_MAPS_API_KEY ... Google Maps Platform のAPIキー
//
// リクエスト形式:
//   { "mode": "area",    "query": "五反田 SES" }      ... 地域+業種検索
//   { "mode": "company", "query": "株式会社ユニティ" }  ... 会社名検索

// ============================================
// 設定値
// ============================================

// Places API (New) のエンドポイント
const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const PLACES_DETAILS_URL = 'https://places.googleapis.com/v1/places/';

// 地域検索で取得する上位件数
const MAX_AREA_RESULTS = 20;
// 会社名検索で詳細を取る件数
const MAX_COMPANY_RESULTS = 5;
// 各店舗で取得する口コミの最大件数
const MAX_REVIEWS_PER_PLACE = 5;

// ============================================
// Places API: テキスト検索
// ============================================
// 「五反田 SES」や「会社名」を投げて、該当する店舗一覧を取得

async function textSearch(query, apiKey, maxResults) {
  // fieldMask で「欲しい項目だけ」を指定する（Places API Newの仕様）
  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.rating',
    'places.userRatingCount',
    'places.websiteUri',
    'places.nationalPhoneNumber',
    'places.businessStatus',
    'places.googleMapsUri',
    'places.primaryTypeDisplayName',
  ].join(',');

  const res = await fetch(PLACES_TEXT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'ja',
      regionCode: 'JP',
      maxResultCount: maxResults,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Places API エラー (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.places || [];
}

// ============================================
// Places API: 店舗詳細（口コミ本文を取る）
// ============================================

async function placeDetails(placeId, apiKey) {
  const fieldMask = [
    'id',
    'displayName',
    'formattedAddress',
    'rating',
    'userRatingCount',
    'websiteUri',
    'nationalPhoneNumber',
    'googleMapsUri',
    'reviews',
    'regularOpeningHours',
    'primaryTypeDisplayName',
  ].join(',');

  const res = await fetch(PLACES_DETAILS_URL + encodeURIComponent(placeId), {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Places Details エラー (${res.status}): ${errText.slice(0, 300)}`);
  }

  return await res.json();
}

// ============================================
// 整形ユーティリティ
// ============================================

// Places APIの店舗データを、フロントで使いやすい形に整形
function formatPlace(place, rank) {
  return {
    rank: rank || null,
    placeId: place.id || null,
    name: place.displayName?.text || '(名称不明)',
    address: place.formattedAddress || '',
    rating: typeof place.rating === 'number' ? place.rating : null,
    reviewCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : 0,
    website: place.websiteUri || '',
    phone: place.nationalPhoneNumber || '',
    mapsUri: place.googleMapsUri || '',
    category: place.primaryTypeDisplayName?.text || '',
    businessStatus: place.businessStatus || '',
  };
}

// 口コミを整形
function formatReviews(reviews) {
  if (!Array.isArray(reviews)) return [];
  return reviews.slice(0, MAX_REVIEWS_PER_PLACE).map(r => ({
    rating: r.rating || null,
    text: r.text?.text || r.originalText?.text || '',
    author: r.authorAttribution?.displayName || '匿名',
    relativeTime: r.relativePublishTimeDescription || '',
  }));
}

// 営業時間を整形
function formatOpeningHours(hours) {
  if (!hours || !Array.isArray(hours.weekdayDescriptions)) return [];
  return hours.weekdayDescriptions;
}

// ============================================
// モード1: 地域+業種検索
// ============================================
// 「五反田 SES」→ 上位の競合一覧を順位付きで返す

async function runAreaSearch(query, apiKey) {
  const places = await textSearch(query, apiKey, MAX_AREA_RESULTS);

  const results = places.map((p, i) => formatPlace(p, i + 1));

  // 集計値
  const withRating = results.filter(r => r.rating !== null);
  const avgRating = withRating.length > 0
    ? (withRating.reduce((sum, r) => sum + r.rating, 0) / withRating.length)
    : null;
  const totalReviews = results.reduce((sum, r) => sum + r.reviewCount, 0);

  return {
    mode: 'area',
    query,
    count: results.length,
    summary: {
      averageRating: avgRating ? Number(avgRating.toFixed(2)) : null,
      totalReviewCount: totalReviews,
    },
    results,
  };
}

// ============================================
// モード2: 会社名検索
// ============================================
// 会社名 → ヒットした店舗の詳細（口コミ本文込み）

async function runCompanySearch(query, apiKey) {
  const places = await textSearch(query, apiKey, MAX_COMPANY_RESULTS);

  if (places.length === 0) {
    return {
      mode: 'company',
      query,
      count: 0,
      results: [],
      warning: 'Googleマップ上で該当する店舗・会社が見つかりませんでした。',
    };
  }

  // 上位の店舗について詳細（口コミ）を取得
  const detailed = [];
  for (let i = 0; i < places.length; i++) {
    const base = formatPlace(places[i], i + 1);
    try {
      const detail = await placeDetails(places[i].id, apiKey);
      base.reviews = formatReviews(detail.reviews);
      base.openingHours = formatOpeningHours(detail.regularOpeningHours);
    } catch (e) {
      base.reviews = [];
      base.openingHours = [];
      base.detailError = e.message;
    }
    detailed.push(base);
  }

  return {
    mode: 'company',
    query,
    count: detailed.length,
    results: detailed,
  };
}

// ============================================
// メインハンドラ
// ============================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POSTのみ対応' });
    return;
  }

  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      res.status(500).json({
        error: 'GOOGLE_MAPS_API_KEYが設定されていません（Vercelの環境変数を確認してください）',
      });
      return;
    }

    const { mode, query } = req.body || {};
    if (!query || !query.trim()) {
      res.status(400).json({ error: 'queryパラメータが必須です' });
      return;
    }

    let result;
    if (mode === 'company') {
      result = await runCompanySearch(query.trim(), apiKey);
    } else {
      // デフォルトは地域検索
      result = await runAreaSearch(query.trim(), apiKey);
    }

    res.status(200).json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'サーバーエラー' });
  }
}

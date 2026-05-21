# googlesearch — 競合 MEO（Googleマップ）調査ツール

競合のGoogleマップ上の評価・口コミ・表示順位を調べるWebツール。

## 何ができるか

**地域＋業種で検索**
「五反田 SES」のように入力 → 競合がGoogleマップの表示順で一覧表示。各社の星評価・口コミ件数が見える。

**会社名で検索**
会社名を入力 → その会社の星評価・口コミ件数・口コミ本文・営業時間が見える。

データはすべてGoogle Places API（公式）経由。SEO推定版と違い、推定ではなく実データです。

## ファイル構成

```
googlesearch/
├── api/
│   └── analyze.js          バックエンド（Places API呼び出し）
├── public/
│   └── index.html          フロントエンド画面
├── package.json            依存ライブラリ定義
├── vercel.json             Vercel設定
├── .gitignore              Git除外設定
├── README.md               このファイル
└── セットアップ手順書.md     RYOさん向けの導入手順
```

## セットアップ

`セットアップ手順書.md` を参照。Google Cloud + Vercel で約25分。

## 必要な環境変数

- `GOOGLE_MAPS_API_KEY`: Google Maps Platform のAPIキー（Places API New が有効なもの）

## 仕組み

- **地域検索**: Places API (New) の Text Search に「地域 業種」を投げ、返ってきた店舗を表示順で一覧化。評価・口コミ件数を集計。
- **会社名検索**: Text Search で会社をヒットさせ、各店舗の Place Details を取得して口コミ本文・営業時間まで表示。
- APIキーは環境変数から読み込み。コードには直書きしない。

## コスト

- Google Maps Platform: 月$200の無料クレジット枠内で運用可能
- Places API テキスト検索は1000回あたり約$32 → 月6000回程度まで実質無料
- Vercel: 無料プランで運用可能

## 制約・注意

- 表示順位は検索時点・サーバーリージョンによって変動する目安
- 口コミはPlaces APIの仕様上、1店舗あたり最大5件
- クレジットカード登録が必須（無料枠超過まで課金されない）

## 変更履歴

- v1: SEO検索流入推定ツール（手動キーワード入力）
- v2: SEO自動版（Google直接スクレイピング + Claude AI抽出）
- v3: MEO調査ツールに作り替え（Google Places API）← 現在

## ライセンス

社内利用向け。

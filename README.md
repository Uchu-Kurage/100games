# 100 Games

5歳児でも遊べるゲームを100本つくるプロジェクト。ブラウザだけで動くミニゲーム集。
素の HTML / JavaScript（ES Modules）のみ、ビルド不要。

## 構成

```
100games/
├── index.html          # 一覧ページ（games.json から自動生成）
├── games.json          # ゲームの一覧データ
├── games/
│   ├── _template/      # 新しいゲームの雛形
│   └── 001-grass-mowing/
│       ├── index.html
│       ├── main.js
│       └── README.md   # テーマ・学んだこと・反省
├── shared/             # 共通処理
│   ├── canvas.js       # 高解像度対応の canvas 準備
│   ├── loop.js         # ゲームループ（dt 付き）
│   ├── input.js        # キーボード・ポインター入力
│   ├── storage.js      # ハイスコア保存（localStorage）
│   ├── ui.js           # 読み上げ・一時停止・canvas 用フォント
│   └── game.css        # 共通スタイル・デザイントークン（ダークモード対応）
└── .github/workflows/deploy.yml  # GitHub Pages へ自動公開
```

## 新しいゲームを作る手順

1. `games/_template` をコピーして `games/002-xxx` のように名前を付ける
   ```sh
   cp -r games/_template games/002-xxx
   ```
2. `index.html` のタイトルと `main.js` を書き換える
3. `games.json` に1件追加する（`no` が一覧での位置になる）
4. `README.md` に振り返りを書く

## ローカルで動かす

ES Modules と `fetch` を使うため、`index.html` をダブルクリックで開くと動きません。簡易サーバーを使ってください。

```sh
python3 -m http.server 8000
# または
npx serve .
```

ブラウザで http://localhost:8000 を開く。

## 公開（GitHub Pages）

初回だけ GitHub の **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする。
以降は `main` に push するたびに自動で公開される。

## 進捗

| No. | タイトル | ジャンル | 日付 |
|---|---|---|---|
| 001 | [草刈りゲーム](games/001-grass-mowing/) | アクション | 2026-11-26 |
| 002 | [もぐらたたき](games/002-whack-a-mole/) | 反射 | 2026-11-26 |
| 003 | [かずすごろく](games/003-kazu-sugoroku/) | テーブル／数ボードゲーム | 2026-11-26 |
| 004 | [いろ・かたち あわせ](games/004-iro-katachi-awase/) | マッチング／分類パズル | 2026-11-26 |
| 005 | [リズム まねっこ](games/005-rhythm-manekko/) | リズム／音楽 | 2026-11-27 |
| 006 | [ならべて消す](games/006-narabete-kesu/) | パズル（連鎖消し） | 2026-11-27 |

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
| 002 | [たこやき](games/002-takoyaki/) | 反射 | 2026-11-26 |
| 003 | [おつかい すごろく](games/003-otsukai-sugoroku/) | テーブル／数ボードゲーム | 2026-11-26 |
| 004 | [おかたづけ](games/004-okatazuke/) | マッチング／分類パズル | 2026-11-26 |
| 005 | [りょうり まねっこ](games/005-ryouri-manekko/) | リズム／音楽 | 2026-11-27 |
| 006 | [しょっき あらい](games/006-shokki-arai/) | パズル（連鎖消し） | 2026-11-27 |
| 007 | [おえかき スタンプ](games/007-oekaki-stamp/) | サンドボックス／創作 | 2026-11-27 |
| 008 | [まどふき](games/008-madofuki/) | おそうじ／なぞり | 2026-11-27 |
| 009 | [さがしもの](games/009-sagashimono/) | 探し絵 | 2026-11-28 |

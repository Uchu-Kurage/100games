# 実装スニペット（素の JS / canvas、100games の shared/ 前提）

すべて初期値。1つずつ足し、遊んで確かめてから残す。

## ヒットストップ（update を止める）

```js
let freeze = 0; // 残り停止秒
export function hitStop(sec) { freeze = Math.max(freeze, sec); }

function update(dt) {
  if (freeze > 0) { freeze -= dt; input.endFrame(); return; } // 演出（フラッシュ等）だけは別で進めてよい
  // ...通常更新
}
// 小 0.03〜0.06 / 決定的瞬間 0.1〜0.2 / ボス級はそれ以上＋フラッシュ
```

## 画面シェイク（trauma 方式）

```js
let trauma = 0; // 0..1
export const addTrauma = (v) => { trauma = Math.min(1, trauma + v); };

function applyShake(ctx, dt) {
  trauma = Math.max(0, trauma - dt * 1.5);   // 減衰
  const s = trauma * trauma;                 // 揺れ量 = trauma²
  const max = 8;                             // 最大px
  ctx.translate((Math.random() * 2 - 1) * max * s, (Math.random() * 2 - 1) * max * s);
}
// render 内で ctx.save(); applyShake(ctx, dt); ...描画...; ctx.restore();
// 小さい出来事は 0.1〜0.2、大きい出来事だけ 0.5 以上。常時揺らさない
```

## 効果音（WebAudio、ピッチランダム＋音階量子化）

```js
let ac;
const audio = () => (ac ??= new AudioContext()); // 最初のユーザー入力後に呼ぶ

export function blip({ freq = 440, dur = 0.08, type = 'square', vol = 0.15, jitter = 0.04 } = {}) {
  const a = audio(), t = a.currentTime;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.value = freq * (1 + (Math.random() * 2 - 1) * jitter); // ±数%
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur);
}

// コンボ段階を音階（メジャーペンタトニック）に量子化
const PENTA = [0, 2, 4, 7, 9];
export const noteFreq = (step, base = 440) =>
  base * 2 ** ((PENTA[step % 5] + 12 * Math.floor(step / 5)) / 12);

// 完了音（DING）：低音＋高音の2層、単位が 100% になった瞬間だけ
export function ding() {
  blip({ freq: 880, dur: 0.35, type: 'sine', vol: 0.2, jitter: 0 });
  blip({ freq: 1320, dur: 0.5, type: 'triangle', vol: 0.1, jitter: 0 });
}
```

## パーティクル＋残留（permanence）

```js
const parts = [];
export function burst(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 120;
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4, rest: 3, color });
  }
}
function updateParts(dt) {
  for (const p of parts) {
    if (p.life > 0) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; }
    else p.rest -= dt; // 着地後しばらく残る
  }
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].rest <= 0) parts.splice(i, 1);
  if (parts.length > 400) parts.splice(0, parts.length - 400); // 上限で処理落ち防止
}
function drawParts(ctx) {
  for (const p of parts) {
    ctx.globalAlpha = p.life > 0 ? 1 : Math.min(1, p.rest);
    ctx.fillStyle = p.color; ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
}
```

## イージング（数字・ゲージを追いかけ表示）

```js
// 指数補間：フレームレートに依存しない lerp
export const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
// shownScore = approach(shownScore, score, 12, dt);
// カメラ追従も同じ形：cam.x = approach(cam.x, player.x + player.vx * 0.2, 6, dt);
```

## squash & stretch（着地・衝突時）

```js
// scale を一瞬崩して 1 に戻す
obj.sx = 1.3; obj.sy = 0.7;                       // 衝突時
obj.sx = approach(obj.sx, 1, 15, dt); obj.sy = approach(obj.sy, 1, 15, dt);
// 描画：ctx.translate(x, y); ctx.scale(obj.sx, obj.sy); ...
```

## 罰のないコンボ

```js
const combo = { n: 0, idle: 0, best: 0 };
function onAction() { combo.n++; combo.idle = 0; combo.best = Math.max(combo.best, combo.n); }
function updateCombo(dt) {
  combo.idle += dt;
  if (combo.idle > 1.0) combo.n = 0;   // 途切れる条件は「一定時間何もしない」だけ
}
const comboBonus = () => 1 + Math.min(combo.n, 50) * 0.01; // 上限を付けて緩やかに
// combo.best は shared/storage.js の save で自己ベストとして残す
```

## 完了単位と DING の配分

```js
// 単位（区画・オブジェクト）ごとに進捗を持ち、ちょうど 100% になった瞬間に1回だけ鳴らす
for (const cell of cells) {
  if (!cell.done && cell.cleared >= cell.total) {   // 99% では鳴らさない
    cell.done = true;
    ding(); hitStop(0.1); flash = 0.15;
  }
}
```

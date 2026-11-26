import { setupCanvas } from '../../shared/canvas.js';
import { startLoop } from '../../shared/loop.js';
import { createInput } from '../../shared/input.js';
import { loadHighScore, saveHighScore } from '../../shared/storage.js';
import { FONT, announce, reducedMotion, onHidden } from '../../shared/ui.js';

const GAME_ID = '001-click-target';
const W = 480;
const H = 320;
const TIME_LIMIT = 30;
const COUNTDOWN = 3;        // スタート前のカウントダウン秒数
const RESULT_LOCK = 0.8;    // リザルト直後の誤タップ防止（秒）
const HIT_SLOP = 6;         // タッチでも当てやすいよう当たり判定を少し広げる
const HUD_H = 40;

const canvas = document.getElementById('game');
const { ctx } = setupCanvas(canvas, W, H);
const input = createInput(canvas, { width: W, height: H });

// CSS の色トークンを canvas でも使う（ダークモード切り替えにも追従する）
const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();

// ---- ゲームの状態 ----
// scene: 'title' → 'countdown' → 'play' (⇄ 'pause') → 'result' → 'countdown' ...
const state = {
  scene: 'title',
  sceneTime: 0,
  timeLeft: TIME_LIMIT,
  score: 0,
  hits: 0,
  clicks: 0,
  best: loadHighScore(GAME_ID),
  isNewBest: false,
  target: null,
  effects: [], // 命中リング・ミス表示・得点ポップアップ
};

function setScene(scene) {
  state.scene = scene;
  state.sceneTime = 0;
}

function spawnTarget() {
  const r = 12 + Math.random() * 28;
  state.target = {
    x: r + Math.random() * (W - r * 2),
    y: HUD_H + r + Math.random() * (H - HUD_H - r * 2),
    r,
    age: 0,
  };
}

function startCountdown() {
  state.timeLeft = TIME_LIMIT;
  state.score = 0;
  state.hits = 0;
  state.clicks = 0;
  state.isNewBest = false;
  state.effects = [];
  state.target = null;
  setScene('countdown');
  announce('スタートまで 3 秒');
}

function finish() {
  state.timeLeft = 0;
  state.target = null;
  state.isNewBest = saveHighScore(GAME_ID, state.score);
  state.best = loadHighScore(GAME_ID);
  setScene('result');
  const acc = accuracy();
  announce(`タイムアップ。スコア ${state.score}、命中率 ${acc}%。${state.isNewBest ? 'ベスト更新！' : `ベストは ${state.best}`}`);
}

const accuracy = () => (state.clicks ? Math.round((state.hits / state.clicks) * 100) : 0);

function pause() {
  if (state.scene !== 'play') return;
  setScene('pause');
  announce('一時停止中');
}

// 「決定」操作（クリック・Space・Enter）でシーンを進める
function confirm() {
  switch (state.scene) {
    case 'title':
      startCountdown();
      break;
    case 'pause':
      setScene('play');
      break;
    case 'result':
      if (state.sceneTime >= RESULT_LOCK) startCountdown();
      break;
  }
}

input.onPointerDown((p) => {
  canvas.focus({ preventScroll: true });
  if (state.scene !== 'play') {
    confirm();
    return;
  }
  state.clicks++;
  const t = state.target;
  if (Math.hypot(p.x - t.x, p.y - t.y) <= t.r + HIT_SLOP) {
    // 半径が小さいほど高得点
    const points = Math.round((50 / t.r) * 10);
    state.score += points;
    state.hits++;
    state.effects.push({ kind: 'ring', x: t.x, y: t.y, r: t.r, life: 0.35, max: 0.35 });
    state.effects.push({ kind: 'text', x: t.x, y: t.y, text: `+${points}`, life: 0.6, max: 0.6 });
    spawnTarget();
  } else {
    state.effects.push({ kind: 'miss', x: p.x, y: p.y, life: 0.3, max: 0.3 });
  }
});

onHidden(pause);

function update(dt) {
  state.sceneTime += dt;

  if (input.wasPressed('Space') || input.wasPressed('Enter') || input.wasPressed('NumpadEnter')) confirm();
  if (input.wasPressed('Escape') || input.wasPressed('KeyP')) {
    if (state.scene === 'play') pause();
    else if (state.scene === 'pause') setScene('play');
  }

  if (state.scene === 'countdown' && state.sceneTime >= COUNTDOWN) {
    setScene('play');
    spawnTarget();
  }

  if (state.scene === 'play') {
    state.timeLeft -= dt;
    state.target.age += dt;
    if (state.timeLeft <= 0) finish();
  }

  if (state.scene !== 'pause') {
    for (const e of state.effects) {
      e.life -= dt;
      if (e.kind === 'text') e.y -= 40 * dt;
    }
    state.effects = state.effects.filter((e) => e.life > 0);
  }

  input.endFrame();
}

// ---- 描画 ----
function drawText(text, x, y, size, fill = color('--fg'), align = 'center', weight = 700) {
  ctx.fillStyle = fill;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function roundRect(x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawTarget(x, y, r, scale = 1) {
  ctx.beginPath();
  ctx.arc(x, y, r * scale, 0, Math.PI * 2);
  ctx.fillStyle = color('--accent');
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r * scale * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = color('--panel');
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r * scale * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = color('--accent');
  ctx.fill();
}

function drawHud() {
  drawText(`${state.score.toLocaleString('ja-JP')}`, 16, 20, 20, color('--fg'), 'left');
  drawText('SCORE', 16 + ctx.measureText(String(state.score.toLocaleString('ja-JP'))).width + 8, 21, 11, color('--muted'), 'left', 600);

  const urgent = state.timeLeft <= 5 && state.scene === 'play';
  drawText(`${state.timeLeft.toFixed(1)}`, W - 16, 20, 20, urgent ? color('--accent-ink') : color('--fg'), 'right');

  // 残り時間バー
  const barW = W - 32;
  roundRect(16, HUD_H - 6, barW, 4, 2, color('--bg-deep'));
  roundRect(16, HUD_H - 6, Math.max(4, barW * (state.timeLeft / TIME_LIMIT)), 4, 2, urgent ? color('--accent') : color('--gold'));
}

function overlay() {
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = color('--panel');
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
}

// 決定操作を促す文字（ゆっくり点滅。視差効果を減らす設定なら点滅しない）
function prompt(text, y) {
  const a = reducedMotion() ? 1 : 0.55 + 0.45 * Math.cos(state.sceneTime * 4);
  ctx.globalAlpha = a;
  drawText(text, W / 2, y, 15, color('--muted'), 'center', 600);
  ctx.globalAlpha = 1;
}

function render() {
  ctx.fillStyle = color('--panel');
  ctx.fillRect(0, 0, W, H);

  if (state.scene === 'title') {
    const bob = reducedMotion() ? 0 : Math.sin(state.sceneTime * 2.5) * 4;
    drawTarget(W / 2, H / 2 - 58 + bob, 30);
    drawText('クリックターゲット', W / 2, H / 2 + 8, 30);
    prompt('タップ / Space でスタート', H / 2 + 52);
    if (state.best > 0) drawText(`ベスト ${state.best.toLocaleString('ja-JP')}`, W / 2, H / 2 + 84, 13, color('--muted'), 'center', 500);
    return;
  }

  drawHud();

  if (state.scene === 'play' || state.scene === 'pause') {
    const t = state.target;
    // 出現時に少し弾むアニメーション（オーバーシュート付き）
    const k = Math.min(1, t.age * 7);
    const scale = reducedMotion() ? 1 : k < 1 ? k * (1.15 - 0.15 * k) + 0.15 * k * (1 - k) : 1;
    drawTarget(t.x, t.y, t.r, scale);
  }

  for (const e of state.effects) {
    const p = 1 - e.life / e.max; // 0 → 1
    ctx.globalAlpha = Math.max(0, 1 - p);
    if (e.kind === 'ring') {
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * (1 + p * 0.8), 0, Math.PI * 2);
      ctx.strokeStyle = color('--accent');
      ctx.lineWidth = 3 * (1 - p) + 1;
      ctx.stroke();
    } else if (e.kind === 'miss') {
      const s = 6 + p * 4;
      ctx.strokeStyle = color('--muted');
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(e.x - s, e.y - s); ctx.lineTo(e.x + s, e.y + s);
      ctx.moveTo(e.x + s, e.y - s); ctx.lineTo(e.x - s, e.y + s);
      ctx.stroke();
    } else {
      drawText(e.text, e.x, e.y, 18, color('--accent-ink'));
    }
    ctx.globalAlpha = 1;
  }

  if (state.scene === 'countdown') {
    const n = Math.ceil(COUNTDOWN - state.sceneTime);
    const frac = state.sceneTime % 1;
    const size = reducedMotion() ? 72 : 72 + (1 - frac) * 24;
    ctx.globalAlpha = reducedMotion() ? 1 : 1 - frac * 0.6;
    drawText(String(n), W / 2, H / 2 + 10, size, color('--accent-ink'));
    ctx.globalAlpha = 1;
    drawText('小さい的ほど高得点！', W / 2, H / 2 + 72, 14, color('--muted'), 'center', 500);
  }

  if (state.scene === 'pause') {
    overlay();
    drawText('一時停止中', W / 2, H / 2 - 12, 26);
    prompt('タップ / Space で再開', H / 2 + 28);
  }

  if (state.scene === 'result') {
    overlay();
    drawText('タイムアップ！', W / 2, H / 2 - 86, 22, color('--muted'));
    drawText(state.score.toLocaleString('ja-JP'), W / 2, H / 2 - 36, 56, color('--fg'));
    drawText(`命中率 ${accuracy()}%（${state.hits}/${state.clicks}）`, W / 2, H / 2 + 12, 14, color('--muted'), 'center', 500);

    if (state.isNewBest) {
      const pw = 130;
      roundRect(W / 2 - pw / 2, H / 2 + 30, pw, 28, 14, color('--accent-soft'));
      drawText('ベスト更新！', W / 2, H / 2 + 44, 14, color('--accent-ink'));
    } else {
      drawText(`ベスト ${state.best.toLocaleString('ja-JP')}`, W / 2, H / 2 + 44, 14, color('--muted'), 'center', 500);
    }
    if (state.sceneTime >= RESULT_LOCK) prompt('タップ / Space でもう一度', H / 2 + 92);
  }
}

startLoop({ update, render });

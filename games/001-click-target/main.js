import { setupCanvas } from '../../shared/canvas.js';
import { startLoop } from '../../shared/loop.js';
import { createInput } from '../../shared/input.js';
import { loadHighScore, saveHighScore } from '../../shared/storage.js';

const GAME_ID = '001-click-target';
const W = 480;
const H = 320;
const TIME_LIMIT = 30;

const canvas = document.getElementById('game');
const { ctx } = setupCanvas(canvas, W, H);
const input = createInput(canvas, { width: W, height: H });

// CSS の色トークンを canvas でも使う（ダークモード対応）
const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();

// ---- ゲームの状態 ----
// scene: 'title' → 'play' → 'result' → 'play' ...
const state = {
  scene: 'title',
  timeLeft: TIME_LIMIT,
  score: 0,
  best: loadHighScore(GAME_ID),
  isNewBest: false,
  target: null,
  popups: [], // 得点表示のエフェクト
};

function spawnTarget() {
  const r = 12 + Math.random() * 28;
  state.target = {
    x: r + Math.random() * (W - r * 2),
    y: r + 30 + Math.random() * (H - r * 2 - 30),
    r,
    age: 0,
  };
}

function startGame() {
  state.scene = 'play';
  state.timeLeft = TIME_LIMIT;
  state.score = 0;
  state.isNewBest = false;
  state.popups = [];
  spawnTarget();
}

input.onPointerDown((p) => {
  if (state.scene !== 'play') {
    startGame();
    return;
  }
  const t = state.target;
  if (Math.hypot(p.x - t.x, p.y - t.y) <= t.r) {
    // 半径が小さいほど高得点
    const points = Math.round(50 / t.r * 10);
    state.score += points;
    state.popups.push({ x: t.x, y: t.y, text: `+${points}`, life: 0.6 });
    spawnTarget();
  }
});

function update(dt) {
  if (state.scene !== 'play' && input.wasPressed('Space')) startGame();

  if (state.scene === 'play') {
    state.timeLeft -= dt;
    state.target.age += dt;
    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      state.scene = 'result';
      state.isNewBest = saveHighScore(GAME_ID, state.score);
      state.best = loadHighScore(GAME_ID);
    }
  }

  for (const p of state.popups) {
    p.life -= dt;
    p.y -= 40 * dt;
  }
  state.popups = state.popups.filter((p) => p.life > 0);

  input.endFrame();
}

function drawText(text, x, y, size, fill = color('--fg'), align = 'center') {
  ctx.fillStyle = fill;
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function render() {
  ctx.fillStyle = color('--panel');
  ctx.fillRect(0, 0, W, H);

  if (state.scene === 'title') {
    drawText('クリックターゲット', W / 2, H / 2 - 30, 32);
    drawText('クリック or スペースでスタート', W / 2, H / 2 + 20, 16, color('--muted'));
    drawText(`ベスト: ${state.best}`, W / 2, H / 2 + 50, 14, color('--muted'));
    return;
  }

  // HUD
  drawText(`スコア ${state.score}`, 12, 18, 16, color('--fg'), 'left');
  drawText(`残り ${state.timeLeft.toFixed(1)}秒`, W - 12, 18, 16, color('--fg'), 'right');

  if (state.scene === 'play') {
    const t = state.target;
    // 出現時に少し膨らむアニメーション
    const scale = Math.min(1, t.age * 8);
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r * scale, 0, Math.PI * 2);
    ctx.fillStyle = color('--accent');
    ctx.fill();
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r * scale * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = color('--panel');
    ctx.fill();
  }

  for (const p of state.popups) {
    ctx.globalAlpha = Math.max(0, p.life / 0.6);
    drawText(p.text, p.x, p.y, 16, color('--accent'));
    ctx.globalAlpha = 1;
  }

  if (state.scene === 'result') {
    drawText('タイムアップ！', W / 2, H / 2 - 40, 28);
    drawText(`スコア: ${state.score}`, W / 2, H / 2, 22);
    drawText(
      state.isNewBest ? 'ベスト更新！' : `ベスト: ${state.best}`,
      W / 2, H / 2 + 32, 16,
      state.isNewBest ? color('--accent') : color('--muted'),
    );
    drawText('クリック or スペースでもう一度', W / 2, H / 2 + 70, 14, color('--muted'));
  }
}

startLoop({ update, render });

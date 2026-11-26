import { setupCanvas } from '../../shared/canvas.js';
import { startLoop } from '../../shared/loop.js';
import { createInput } from '../../shared/input.js';
// 読み上げ・一時停止・canvas 用フォントなどの共通 UI ヘルパー
import { FONT, announce, onHidden } from '../../shared/ui.js';

const W = 480;
const H = 320;

const canvas = document.getElementById('game');
const { ctx } = setupCanvas(canvas, W, H);
const input = createInput(canvas, { width: W, height: H });

const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();

const player = { x: W / 2, y: H / 2, speed: 200 };

function update(dt) {
  if (input.isDown('ArrowLeft')) player.x -= player.speed * dt;
  if (input.isDown('ArrowRight')) player.x += player.speed * dt;
  if (input.isDown('ArrowUp')) player.y -= player.speed * dt;
  if (input.isDown('ArrowDown')) player.y += player.speed * dt;
  input.endFrame();
}

function render() {
  ctx.fillStyle = color('--panel');
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = color('--accent');
  ctx.fillRect(player.x - 10, player.y - 10, 20, 20);
  ctx.fillStyle = color('--muted');
  ctx.font = `600 14px ${FONT}`;
  ctx.fillText('矢印キーで移動', 12, 24);
}

// タブを離れたら一時停止する例: onHidden(() => (paused = true));
// 結果を読み上げる例:         announce(`スコア ${score}`);

startLoop({ update, render });

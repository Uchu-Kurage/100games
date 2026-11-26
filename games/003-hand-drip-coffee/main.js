// 003 ハンドドリップ珈琲
// 快感の核：「ハンドルを回すたびにゴリッと豆が砕け、お湯を注ぐと粉がふくらみ、ぽたぽたと珈琲が落ちていく」
// 土台：即時フィードバック（回した瞬間の砕ける音と破片／注いだ瞬間に粉が濃く染まる）
//       ＋痕跡（挽いた粉が引き出しにたまる／湿った粉の色が残る／サーバーに珈琲がたまる）
//       ＋小さな完了の連鎖（挽けた・全体が湿った・蒸らしOK・1〜3投目・できあがり）。
//       その上に、ふくらむ蒸らし・落ちる音の音程（たまるほど高くなる）・味の評価を積む。
import { setupCanvas } from '../../shared/canvas.js';
import { startLoop } from '../../shared/loop.js';
import { createInput } from '../../shared/input.js';
import { load, save } from '../../shared/storage.js';
import { FONT, announce, onHidden, reducedMotion } from '../../shared/ui.js';

const GAME_ID = '003-hand-drip-coffee';
const W = 640;
const H = 440;
const HUD = 40;

const canvas = document.getElementById('game');
const { ctx } = setupCanvas(canvas, W, H);
const input = createInput(canvas, { width: W, height: H });
const overlay = document.getElementById('overlay');
const muteBtn = document.getElementById('mute');

const css = getComputedStyle(document.documentElement);
const token = (name) => css.getPropertyValue(name).trim();
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
let T = {};
function readTokens() {
  const dark = darkQuery.matches;
  T = {
    panel: token('--panel'), fg: token('--fg'), muted: token('--muted'), border: token('--border'),
    accent: token('--accent'), gold: token('--gold'), bgDeep: token('--bg-deep'),
    wallTop: dark ? '#2a2320' : '#f7ede1',
    wallBot: dark ? '#221c19' : '#efe0cf',
    counter: dark ? '#4a3324' : '#b9875a',
    counterEdge: dark ? '#3a281c' : '#9a6c44',
    ink: dark ? '#f1ede8' : '#2b1d14',
    inkSoft: dark ? '#c9bfb4' : '#6a5646',
  };
}
readTokens();
darkQuery.addEventListener?.('change', readTokens);

// ---------------------------------------------------------------- 便利関数
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const wrapAngle = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
function mixColor(c1, c2, t) {
  const p = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const a = p(c1), b = p(c2);
  return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
}
function ellipse(x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU);
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// ---------------------------------------------------------------- 音
let ac = null;
let master = null;
let noiseBuf = null;
let pourSnd = null;
let grindSnd = null;
let muted = load(`${GAME_ID}:muted`, false);

function initAudio() {
  if (ac) {
    if (ac.state === 'suspended') ac.resume();
    return;
  }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return;
  }
  master = ac.createGain();
  master.gain.value = muted ? 0 : 0.9;
  master.connect(ac.destination);

  noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  // 注ぐ音：ノイズのループを帯域通過させた「ちょろちょろ〜」。音量は注ぐ量に比例
  pourSnd = loopNoise('bandpass', 1100, 0.8);
  // 挽く音の下地：低いノイズの「ゴリゴリ」。回す速さに比例
  grindSnd = loopNoise('lowpass', 380, 0.9);
}

function loopNoise(type, freq, q) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ac.createGain();
  g.gain.value = 0;
  src.connect(f).connect(g).connect(master);
  src.start();
  return { f, g };
}

function tone(freq, dur, type = 'sine', vol = 0.12, when = 0, slideTo = 0) {
  if (!ac) return;
  const t = ac.currentTime + when;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noiseHit(freq, dur, vol, type = 'bandpass', q = 1.2) {
  if (!ac) return;
  const t = ac.currentTime;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = rand(0.8, 1.2);
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.8);
  src.stop(t + dur + 0.02);
}

const PENTA = [0, 2, 4, 7, 9];
const noteFreq = (step, base = 523.25) => base * 2 ** ((PENTA[step % 5] + 12 * Math.floor(step / 5)) / 12);

const sfx = {
  // 豆が砕ける「ゴリッ」：中域のノイズ＋低い打撃。毎回ピッチをゆらす
  crunch(rough) {
    noiseHit(rand(900, 1500) * (rough ? 1.4 : 1), 0.07, rough ? 0.2 : 0.15, 'bandpass', 1.6);
    tone(rand(80, 110), 0.06, 'triangle', 0.09, 0, 50);
  },
  click() {
    tone(rand(1800, 2200), 0.02, 'square', 0.018);
  },
  // しずくの「ぽちょ」：サーバーにたまるほど音が高くなる（本物の容器と同じ）
  drip(level) {
    const f = 520 + level * 3.2 + rand(-30, 30);
    tone(f, 0.09, 'sine', 0.06, 0, f * 1.6);
  },
  bubble() {
    tone(rand(1400, 2600), 0.025, 'sine', 0.018, 0, rand(2600, 3400));
  },
  ding(step = 0) {
    tone(noteFreq(step + 3, 392), 0.14, 'triangle', 0.1);
    tone(noteFreq(step + 5) * 2, 0.24, 'sine', 0.13, 0.01);
    tone(noteFreq(step + 7) * 2, 0.5, 'sine', 0.08, 0.07);
  },
  done() {
    [0, 2, 4, 5, 7, 10].forEach((s, i) => tone(noteFreq(s, 392), 0.3, 'triangle', 0.12, i * 0.09));
    tone(130.8, 0.7, 'sine', 0.12);
    tone(noteFreq(10, 392) * 2, 1.0, 'sine', 0.07, 0.6);
  },
  splash() {
    noiseHit(2400, 0.25, 0.08, 'highpass', 0.7);
  },
  start() {
    tone(330, 0.1, 'triangle', 0.08);
    tone(494, 0.16, 'triangle', 0.08, 0.08);
  },
};

function setMuted(v) {
  muted = v;
  save(`${GAME_ID}:muted`, v);
  muteBtn.textContent = v ? '音 OFF' : '音 ON';
  muteBtn.setAttribute('aria-pressed', String(v));
  if (master) master.gain.setTargetAtTime(v ? 0 : 0.9, ac.currentTime, 0.02);
}
muteBtn.addEventListener('click', () => {
  initAudio();
  setMuted(!muted);
});
setMuted(muted);

// ---------------------------------------------------------------- 設定
// drain: ドリッパーから落ちる速さ（水量に対する割合/秒）  ext: 成分の出やすさ
const GRINDS = [
  { id: 'fine', name: '細挽き', sub: 'ゆっくり落ちて、濃く苦めに出やすい', drain: 0.055, ext: 1.14, turns: 14, dot: 3 },
  { id: 'medium', name: '中挽き', sub: 'おすすめ。バランスよく淹れやすい', drain: 0.085, ext: 1.0, turns: 12, dot: 5 },
  { id: 'coarse', name: '粗挽き', sub: 'すっと落ちて、あっさり軽めに出やすい', drain: 0.13, ext: 0.87, turns: 10, dot: 7 },
];
const MAX_RATE = 11; // 注ぐ最大量 ml/秒
const ABSORB = 40; // 粉が吸うお湯の量 ml
const CAP = 112; // ドリッパーにためられる量 ml
const TARGETS = [120, 180, 240]; // 1〜3投目の目安（注いだ合計 ml）
const SERVER_GOAL = 200; // できあがりの量 ml
const IDEAL_TIME = 75; // 理想の抽出時間（ゲーム内の秒。実際の2〜3分を縮めたもの）
const BLOOM_OK = 18; // 蒸らしの目安秒

// ---------------------------------------------------------------- 状態
let state = 'title'; // title | grind | transfer | brew | finish | result
let paused = false;
let grind = GRINDS[1];
let clock = 0;
let hitstop = 0;
let shake = 0;
let fade = 0;
const particles = [];
const floaters = [];
let banner = null;

// 挽く
const MX = 320; // ミルの中心
const CRANK_Y = 108;
const CRANK_R = 92;
const g = {
  angle: -Math.PI / 2,
  progress: 0,
  omega: 0, // 回る速さ（回転/秒）
  crunchAcc: 0,
  lastPointerAngle: null,
  good: 0,
  bad: 0,
  started: false,
  beans: [],
  doneT: 0,
  aroma: 0,
};

// 淹れる
const DX = 320;
const RIM_Y = 140;
const RIM_RX = 136;
const RIM_RY = 50;
const CONE_BOT = 262;
const GROUND_Y = 166;
const GROUND_RX = 98;
const GROUND_RY = 34;
const N = 22; // 粉の表面の格子
const cells = [];
for (let j = 0; j < N; j++)
  for (let i = 0; i < N; i++) {
    const u = ((i + 0.5) / N) * 2 - 1;
    const v = ((j + 0.5) / N) * 2 - 1;
    if (u * u + v * v <= 1.0) cells.push({ u, v, wet: 0, gas: 0, speck: Math.random(), fresh: 0 });
  }

const b = {};
function resetBrew() {
  Object.assign(b, {
    aimU: 0, aimV: 0, aimX: DX, aimY: GROUND_Y,
    rate: 0, poured: 0, pool: 0, absorbed: 0, server: 0, bypassQ: 0,
    centerMl: 0, midMl: 0, edgeMl: 0, bypassMl: 0, spilled: 0,
    started: false, startClock: 0, elapsed: 0,
    bloom: 'pre', bloomStart: 0, bloomPoured: 0, bloomStopped: false, bloomWait: -1, bloomChimed: false, bloomAmount: 0, bloomWet: 0,
    target: 0, dome: 0, wetPct: 0, dropAcc: 0, rippleAcc: 0, foamAcc: 0, idle: 0,
    overflowCool: 0, pourFromButton: false, liftT: 0, groundsIn: 0, keyAim: false,
    tilt: 0, lastPX: -1, lastPY: -1, mouseAim: false, flow: 0,
  });
  for (const c of cells) { c.wet = 0; c.gas = 0; c.fresh = 0; }
  drops.length = 0;
  ripples.length = 0;
  foam.length = 0;
  bubbles.length = 0;
}
const drops = [];
const ripples = [];
const foam = [];
const bubbles = [];

function makeBeans() {
  g.beans = [];
  for (let k = 0; k < 40; k++) {
    const a = rand(0, TAU);
    const r = Math.sqrt(Math.random());
    g.beans.push({ x: Math.cos(a) * r * 62, y: Math.sin(a) * r * 15, rot: rand(0, TAU), d: r, s: rand(0.9, 1.15) });
  }
  // 中心に近い豆から順に吸い込まれる
  g.beans.sort((p, q) => q.d - p.d);
}

function startGame(gi) {
  grind = GRINDS[gi];
  save(`${GAME_ID}:lastGrind`, gi);
  initAudio();
  hideOverlay();
  Object.assign(g, { angle: -Math.PI / 2, progress: 0, omega: 0, crunchAcc: 0, lastPointerAngle: null, good: 0, bad: 0, started: false, doneT: 0, aroma: 0 });
  makeBeans();
  resetBrew();
  particles.length = 0;
  floaters.length = 0;
  banner = null;
  state = 'grind';
  paused = false;
  clock = 0;
  fade = 1;
  sfx.start();
  canvas.focus();
  announce(`${grind.name}で挽きます。ミルのまわりを時計回りにドラッグしてハンドルを回してください`);
}

// ---------------------------------------------------------------- 演出
function addFloater(x, y, text, opts = {}) {
  floaters.push({ x, y, text, t: 0, life: opts.life || 1.3, big: opts.big, sub: opts.sub });
}
function showBanner(text, sub) {
  banner = { text, sub, t: 0 };
}
function bump(amount) {
  if (reducedMotion()) return;
  shake = Math.min(1, shake + amount);
}

// ---------------------------------------------------------------- 入力
let pointerStartedOnButton = false;
const FINISH_BTN = { x: 18, y: 380, w: 150, h: 42 };
const inBtn = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
input.onPointerDown((p) => {
  initAudio();
  pointerStartedOnButton = false;
  if (paused) return;
  if (state === 'brew' && canFinish() && inBtn(p, FINISH_BTN)) {
    pointerStartedOnButton = true;
    finishBrew();
  }
});

function togglePause(v = !paused) {
  if (state !== 'grind' && state !== 'brew') return;
  paused = v;
  announce(paused ? '一時停止中' : '再開');
}
onHidden(() => togglePause(true));

// ---------------------------------------------------------------- 更新
function update(dt) {
  if (input.wasPressed('KeyM')) {
    initAudio();
    setMuted(!muted);
  }
  if (input.wasPressed('KeyP') || input.wasPressed('Escape')) togglePause();
  else if (paused && input.wasPressed('Space')) togglePause(false);
  if (paused && input.pointer.down && !pointerStartedOnButton) {
    togglePause(false);
    pointerStartedOnButton = true; // 再開のタップでは注がない
  }

  if (paused || state === 'title' || state === 'result') {
    silence();
    input.endFrame();
    return;
  }

  fade = Math.max(0, fade - dt * 2.5);
  if (hitstop > 0) {
    hitstop -= dt;
    updateFx(dt * 0.15);
    input.endFrame();
    return;
  }
  clock += dt;
  if (state === 'grind') updateGrind(dt);
  else if (state === 'transfer') updateTransfer(dt);
  else if (state === 'brew' || state === 'finish') updateBrew(dt);
  updateFx(dt);
  input.endFrame();
}

function silence() {
  if (!ac) return;
  pourSnd.g.gain.setTargetAtTime(0, ac.currentTime, 0.03);
  grindSnd.g.gain.setTargetAtTime(0, ac.currentTime, 0.03);
}

// ---------------------------------------------------------------- 挽く
const MILL_CY = 210; // 回転の中心（ドラッグの判定用）
function updateGrind(dt) {
  let d = 0;
  const p = input.pointer;
  if (g.progress < 1) {
    if (p.down && !pointerStartedOnButton) {
      const dx = p.x - MX;
      const dy = p.y - MILL_CY;
      if (dx * dx + dy * dy > 18 * 18) {
        const a = Math.atan2(dy, dx);
        if (g.lastPointerAngle !== null) {
          const da = wrapAngle(a - g.lastPointerAngle);
          if (Math.abs(da) < 1.4) d = da;
        }
        g.lastPointerAngle = a;
      } else g.lastPointerAngle = null;
    } else g.lastPointerAngle = null;
    if (input.isDown('Space') || input.isDown('ArrowRight') || input.isDown('Enter')) d = 1.15 * TAU * dt;
  }

  // 時計回りだけが挽ける（逆回しは空回り）
  const fwd = Math.max(0, d);
  if (d < 0) {
    g.angle += d * 0.3;
    if (Math.random() < 0.3) sfx.click();
  }
  g.angle += fwd;
  const inst = dt > 0 ? fwd / TAU / dt : 0;
  g.omega = approach(g.omega, inst, 6, dt);

  if (fwd > 0 && g.progress < 1) {
    if (!g.started) g.started = true;
    g.progress = Math.min(1, g.progress + fwd / (TAU * grind.turns));
    g.aroma = Math.min(1, g.aroma + fwd * 0.08);
    g.crunchAcc += fwd;
    const step = 0.5;
    while (g.crunchAcc >= step) {
      g.crunchAcc -= step;
      crunch();
    }
    if (g.progress >= 1) grindDone();
  }
  g.aroma = Math.max(0, g.aroma - dt * 0.12);

  if (ac) {
    const v = state === 'grind' && g.progress < 1 ? Math.min(0.22, g.omega * 0.12) : 0;
    grindSnd.g.gain.setTargetAtTime(v, ac.currentTime, 0.05);
    grindSnd.f.frequency.setTargetAtTime(300 + g.omega * 160, ac.currentTime, 0.05);
    pourSnd.g.gain.setTargetAtTime(0, ac.currentTime, 0.05);
  }

  if (g.progress >= 1) {
    g.doneT += dt;
    if (g.doneT > 1.5) {
      state = 'transfer';
      b.groundsIn = 0;
      fade = 1;
    }
  }
}

function crunch() {
  const rough = g.omega > 2.1;
  if (rough) g.bad++;
  else g.good++;
  sfx.crunch(rough);
  bump(0.18);
  // 豆が1粒ずつ吸い込まれていく
  const left = Math.ceil(g.beans.length * (1 - g.progress));
  const visible = g.beans.filter((bn) => !bn.gone);
  if (visible.length > left) {
    const bn = visible[visible.length - 1];
    bn.gone = true;
    particles.push({ kind: 'bean', x: MX + bn.x, y: 152 + bn.y, vx: -bn.x * 1.5, vy: -bn.y * 2 + 10, rot: bn.rot, vr: rand(-6, 6), life: 0.35, t: 0 });
  }
  // 砕けた破片が少し跳ねる
  for (let k = 0; k < 4; k++) {
    particles.push({
      kind: 'chip', x: MX + rand(-14, 14), y: 154, vx: rand(-60, 60), vy: rand(-110, -40),
      life: rand(0.35, 0.6), t: 0, s: rand(1.2, 2.4), c: Math.random() < 0.5 ? '#6b4226' : '#8a5a36',
    });
  }
  // 引き出しの窓にも粉が落ちる
  particles.push({ kind: 'powder', x: MX + rand(-30, 30), y: 300, vx: rand(-10, 10), vy: rand(20, 50), life: 0.4, t: 0, s: rand(1, 1.8) });
}

function grindDone() {
  hitstop = 0.12;
  sfx.ding(0);
  bump(0.4);
  showBanner('挽けた！', `${grind.name} 20g`);
  const even = evenness();
  announce(`挽けました。粒のそろい ${Math.round(even * 100)}パーセント`);
}
const evenness = () => (g.good + g.bad ? g.good / (g.good + g.bad) : 1);

// ---------------------------------------------------------------- 粉をドリッパーへ
function updateTransfer(dt) {
  b.groundsIn = Math.min(1, b.groundsIn + dt * 0.9);
  if (Math.random() < 0.9) {
    for (let k = 0; k < 3; k++)
      particles.push({ kind: 'fall', x: DX + rand(-24, 24), y: rand(44, 70), vx: rand(-15, 15), vy: rand(80, 160), life: 0.6, t: 0, s: rand(1.2, 2.2) });
  }
  if (Math.random() < 0.15) noiseHit(rand(3000, 5000), 0.05, 0.03, 'highpass');
  if (b.groundsIn >= 1) {
    state = 'brew';
    b.lastPX = input.pointer.x;
    b.lastPY = input.pointer.y;
    bump(0.2);
    tone(180, 0.1, 'triangle', 0.08);
    announce('粉が入りました。押しているあいだお湯が出ます。まず少しだけ注いで全体を湿らせましょう');
  }
}

// ---------------------------------------------------------------- 淹れる
function surface() {
  // お湯がたまっていればその水面、なければ粉の表面
  const lift = (b.pool / CAP) * (GROUND_Y - RIM_Y - 10);
  const y = GROUND_Y - b.dome - lift;
  const rx = GROUND_RX + (lift / (GROUND_Y - RIM_Y)) * 30;
  return { y, rx, ry: rx * (GROUND_RY / GROUND_RX) };
}
const canFinish = () => state === 'brew' && b.poured >= 100;

function updateBrew(dt) {
  const s = surface();
  const p = input.pointer;
  const brewing = state === 'brew';

  // ---- 狙い
  let kx = 0, ky = 0;
  if (input.isDown('ArrowLeft') || input.isDown('KeyA')) kx -= 1;
  if (input.isDown('ArrowRight') || input.isDown('KeyD')) kx += 1;
  if (input.isDown('ArrowUp') || input.isDown('KeyW')) ky -= 1;
  if (input.isDown('ArrowDown') || input.isDown('KeyS')) ky += 1;
  if (kx || ky) {
    b.keyAim = true;
    b.aimU += kx * 1.3 * dt;
    b.aimV += ky * 1.3 * dt;
  } else if (p.x !== b.lastPX || p.y !== b.lastPY || p.down) {
    b.keyAim = false;
    b.mouseAim = true;
    b.lastPX = p.x;
    b.lastPY = p.y;
  }
  if (b.mouseAim && !b.keyAim) {
    b.aimU = (p.x - DX) / s.rx;
    b.aimV = (p.y - s.y) / s.ry;
  }
  const ar = Math.hypot(b.aimU, b.aimV);
  if (ar > 1.4) {
    b.aimU *= 1.4 / ar;
    b.aimV *= 1.4 / ar;
  }
  b.aimX = approach(b.aimX, DX + b.aimU * s.rx, 30, dt);
  b.aimY = approach(b.aimY, s.y + b.aimV * s.ry, 30, dt);

  // ---- 注ぐ（押した長さで少しずつ傾く）
  const want = brewing && ((p.down && !pointerStartedOnButton) || input.isDown('Space'));
  b.rate = approach(b.rate, want ? MAX_RATE : 0, want ? 5 : 14, dt);
  if (b.rate < 0.05) b.rate = 0;
  b.tilt = approach(b.tilt, want ? 1 : 0, 10, dt);
  const dm = b.rate * dt;
  const u = (b.aimX - DX) / s.rx;
  const v = (b.aimY - s.y) / s.ry;
  const r = Math.hypot(u, v);

  if (dm > 0) {
    if (!b.started) {
      b.started = true;
      b.startClock = clock;
    }
    b.poured += dm;
    b.idle = 0;
    if (r > 1.05) {
      // フィルターの紙に直接かかる → 粉を通らずに落ちる（薄くなる）
      b.bypassMl += dm;
      b.bypassQ += dm;
    } else {
      if (r < 0.72) b.centerMl += dm;
      else if (r < 0.9) b.midMl += dm;
      else b.edgeMl += dm;
      b.pool += dm;
      // 注いだあたりの粉が湿る
      for (const c of cells) {
        const du = c.u - u, dv = c.v - v;
        const dd = du * du + dv * dv;
        if (dd < 0.09) {
          const before = c.wet;
          c.wet = Math.min(1.4, c.wet + dm * 0.42 * (1 - dd / 0.09));
          if (before < 0.5 && c.wet >= 0.5) wetCell(c);
        }
      }
      b.rippleAcc += dt;
      if (b.rippleAcc > 0.09 && b.pool > 4) {
        b.rippleAcc = 0;
        ripples.push({ u, v, t: 0 });
      }
      b.foamAcc += dm;
      while (b.foamAcc > 0.6) {
        b.foamAcc -= 0.6;
        const a = rand(0, TAU);
        foam.push({ u: u + Math.cos(a) * 0.05, v: v + Math.sin(a) * 0.05, vu: Math.cos(a) * rand(0.1, 0.35), vv: Math.sin(a) * rand(0.1, 0.35), t: 0, life: rand(2.5, 5), s: rand(1.2, 2.6) });
      }
      if (Math.random() < 0.5)
        particles.push({ kind: 'splash', x: b.aimX + rand(-4, 4), y: b.aimY, vx: rand(-50, 50), vy: rand(-80, -30), life: 0.25, t: 0, s: rand(1, 1.8) });
    }
  } else b.idle += dt;
  if (b.started && brewing) b.elapsed = clock - b.startClock;

  // ---- 粉がお湯を吸う（湿っている面積の分だけ）
  b.wetPct = cells.reduce((a, c) => a + Math.min(1, c.wet), 0) / cells.length;
  const cap = ABSORB * b.wetPct;
  if (b.absorbed < cap && b.pool > 0) {
    const a = Math.min(cap - b.absorbed, b.pool, 40 * dt);
    b.absorbed += a;
    b.pool -= a;
  }
  // たまったお湯は全体に広がって粉を湿らせる
  if (b.pool > 3) {
    const k = dt * 0.5 * Math.min(1, b.pool / 10);
    for (const c of cells) {
      if (c.wet < 1) {
        const before = c.wet;
        c.wet = Math.min(1, c.wet + k);
        if (before < 0.5 && c.wet >= 0.5) wetCell(c, true);
      }
    }
  }

  // ---- 落ちる
  const sat = b.absorbed / ABSORB;
  let flow = sat > 0.6 && brewing ? grind.drain * b.pool * sat + (b.pool > 0.3 ? 0.4 : 0) : 0;
  flow = Math.min(flow, b.pool / Math.max(dt, 1e-3));
  b.pool -= flow * dt;
  let bypassFlow = 0;
  if (b.bypassQ > 0 && brewing) {
    bypassFlow = Math.min(b.bypassQ, 9 * dt);
    b.bypassQ -= bypassFlow;
  }
  if (brewing) b.server += flow * dt + bypassFlow;
  const totalFlow = flow + bypassFlow / Math.max(dt, 1e-3);
  b.dropAcc += totalFlow * dt;
  if (totalFlow < 3.5) {
    while (b.dropAcc > 1.1) {
      b.dropAcc -= 1.1;
      drops.push({ y: CONE_BOT + 12, vy: 30 });
    }
  } else b.dropAcc = 0;
  b.flow = totalFlow;

  // ---- あふれる
  b.overflowCool -= dt;
  if (b.pool > CAP) {
    b.spilled += b.pool - CAP;
    b.pool = CAP;
    if (b.overflowCool <= 0) {
      b.overflowCool = 2.5;
      addFloater(DX + RIM_RX - 20, RIM_Y - 20, 'あふれる！');
      sfx.splash();
      bump(0.25);
    }
    if (Math.random() < 0.6) {
      const side = Math.random() < 0.5 ? -1 : 1;
      particles.push({ kind: 'spill', x: DX + side * RIM_RX * rand(0.8, 1), y: RIM_Y + rand(0, 20), vx: side * rand(10, 30), vy: rand(20, 60), life: 0.8, t: 0, s: rand(1.4, 2.4) });
    }
  }

  // ---- 蒸らし（粉がふくらみ、泡が出てくる）
  let gasSum = 0;
  for (const c of cells) {
    if (c.gas > 0) {
      c.gas = Math.max(0, c.gas - dt / 16);
      gasSum += c.gas;
      if (Math.random() < c.gas * dt * 0.5 && bubbles.length < 90) {
        bubbles.push({ u: c.u + rand(-0.03, 0.03), v: c.v + rand(-0.03, 0.03), t: 0, life: rand(0.8, 2.2), s: rand(2, 4.5) });
      }
    }
    c.fresh = Math.max(0, c.fresh - dt * 2);
  }
  const domeTarget = (gasSum / cells.length) * 16 * (b.pool < 20 ? 1 : 0.4);
  b.dome = approach(b.dome, domeTarget, 1.5, dt);

  if (brewing) updateBloom();

  // ---- 1〜3投目
  if (brewing && b.target < TARGETS.length && b.poured >= TARGETS[b.target]) {
    sfx.ding(b.target + 1);
    addFloater(DX, RIM_Y - 36, `${b.target + 1}投目 OK`, { sub: `${TARGETS[b.target]}ml` });
    b.target++;
    if (b.target === TARGETS.length) {
      showBanner('注ぎ終わり', '落ちきるのを待とう');
      announce('注ぎ終わりました。落ちきるのを待つか、できあがりを押してください');
    }
  }

  // ---- できあがり
  if (brewing) {
    if (b.server >= SERVER_GOAL) finishBrew();
    else if (b.poured >= 200 && b.pool < 0.5 && b.bypassQ <= 0 && b.idle > 2.5) finishBrew();
    if (input.wasPressed('Enter') && canFinish()) finishBrew();
  }
  if (state === 'finish') {
    b.liftT += dt;
    if (b.liftT > 1.8) showResult();
  }

  // ---- 音
  if (ac) {
    const tnow = ac.currentTime;
    pourSnd.g.gain.setTargetAtTime(b.rate > 0 ? 0.05 + (b.rate / MAX_RATE) * 0.13 : 0, tnow, 0.04);
    // 粉に当たると高め、水面に当たると低めの「とぽとぽ」
    pourSnd.f.frequency.setTargetAtTime(b.pool > 8 ? 650 + b.rate * 20 : 1300 + b.rate * 40, tnow, 0.08);
    grindSnd.g.gain.setTargetAtTime(0, tnow, 0.05);
  }
}

function wetCell(c, quiet) {
  if (c.gas === 0 && b.bloom === 'pre') {
    c.gas = 1;
    c.fresh = 1;
    if (!quiet && Math.random() < 0.15) sfx.bubble();
  } else if (c.gas === 0) c.gas = 0.4;
}

function updateBloom() {
  if (b.bloom === 'pre') {
    if (b.wetPct >= 0.92) {
      b.bloom = 'wait';
      b.bloomStart = clock;
      b.bloomPoured = b.poured;
      b.bloomAmount = b.poured;
      b.bloomWet = b.wetPct;
      b.bloomStopped = b.rate < 0.3;
      sfx.ding(0);
      addFloater(DX, RIM_Y - 30, '全体が湿った！', { sub: '手を止めて蒸らそう' });
      announce('全体が湿りました。注ぐのを止めて蒸らしましょう');
    }
    return;
  }
  if (b.bloom === 'wait') {
    if (b.rate < 0.3) b.bloomStopped = true;
    const waited = clock - b.bloomStart;
    if (b.bloomStopped && b.rate > 2) {
      b.bloomWait = waited;
      b.bloom = 'done';
      if (waited < 10) addFloater(150, 200, '蒸らし短め…', { life: 1.2 });
    } else if (!b.bloomStopped && b.poured - b.bloomPoured > 25) {
      b.bloomWait = 0;
      b.bloom = 'done';
      addFloater(150, 200, '蒸らしなし…', { life: 1.2 });
    } else {
      b.bloomAmount = b.poured;
    }
    if (waited >= BLOOM_OK && !b.bloomChimed && b.bloom === 'wait') {
      b.bloomChimed = true;
      sfx.ding(2);
      addFloater(DX, RIM_Y - 30, '蒸らしOK！', { sub: '中心から「の」の字に注ごう' });
      announce('蒸らし完了。中心から円を描くように注ぎましょう');
    }
  }
}

function finishBrew() {
  if (state !== 'brew') return;
  if (b.bloom === 'wait') b.bloomWait = clock - b.bloomStart;
  state = 'finish';
  b.elapsed = clock - b.startClock;
  b.liftT = 0;
  b.rate = 0;
  hitstop = 0.1;
  sfx.done();
  showBanner('できあがり！', `${Math.round(b.server)}ml`);
}

// ---------------------------------------------------------------- 演出の更新
function updateFx(dt) {
  shake = Math.max(0, shake - dt * 2.8);
  for (let i = particles.length - 1; i >= 0; i--) {
    const q = particles[i];
    q.t += dt;
    if (q.t >= q.life) {
      particles.splice(i, 1);
      continue;
    }
    q.x += q.vx * dt;
    q.y += q.vy * dt;
    if (q.kind !== 'bean') q.vy += (q.kind === 'powder' ? 60 : 420) * dt;
    if (q.kind === 'bean') {
      q.rot += q.vr * dt;
    }
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    floaters[i].t += dt;
    if (floaters[i].t >= floaters[i].life) floaters.splice(i, 1);
  }
  if (banner) {
    banner.t += dt;
    if (banner.t > 1.6) banner = null;
  }
  // しずく
  const level = serverLevelY();
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.vy += 900 * dt;
    d.y += d.vy * dt;
    if (d.y >= level) {
      drops.splice(i, 1);
      sfx.drip(b.server);
      ripples.push({ server: true, t: 0 });
    }
  }
  for (let i = ripples.length - 1; i >= 0; i--) {
    ripples[i].t += dt;
    if (ripples[i].t > 0.7) ripples.splice(i, 1);
  }
  for (let i = foam.length - 1; i >= 0; i--) {
    const f = foam[i];
    f.t += dt;
    f.u += f.vu * dt;
    f.v += f.vv * dt;
    f.vu *= 1 - dt * 1.5;
    f.vv *= 1 - dt * 1.5;
    if (f.t > f.life || f.u * f.u + f.v * f.v > 1) foam.splice(i, 1);
  }
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const q = bubbles[i];
    q.t += dt;
    if (q.t > q.life) {
      bubbles.splice(i, 1);
      if (Math.random() < 0.25) sfx.bubble();
    }
  }
}

// ---------------------------------------------------------------- 描画
function render() {
  ctx.save();
  if (shake > 0) {
    const s = shake * shake * 3;
    ctx.translate(rand(-s, s), rand(-s, s));
  }
  drawRoom();
  if (state === 'grind' || state === 'title') drawGrindScene();
  else drawBrewScene();
  drawParticles();
  drawFloaters();
  if (banner) drawBanner();
  ctx.restore();
  drawHud();
  if (fade > 0) {
    ctx.fillStyle = T.wallTop;
    ctx.globalAlpha = fade;
    ctx.fillRect(0, HUD, W, H - HUD);
    ctx.globalAlpha = 1;
  }
  if (paused) drawPause();
}

function drawRoom() {
  const gr = ctx.createLinearGradient(0, HUD, 0, H);
  gr.addColorStop(0, T.wallTop);
  gr.addColorStop(1, T.wallBot);
  ctx.fillStyle = gr;
  ctx.fillRect(-10, HUD, W + 20, H - HUD + 10);
  // カウンター
  ctx.fillStyle = T.counter;
  ctx.fillRect(-10, 424, W + 20, 30);
  ctx.fillStyle = T.counterEdge;
  ctx.fillRect(-10, 424, W + 20, 3);
}

function text(str, x, y, size = 14, color = T.ink, align = 'left', weight = 700) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

// ---- 挽く場面
function drawGrindScene() {
  const ca = g.angle;
  const hx = MX + Math.cos(ca) * CRANK_R;
  const hy = CRANK_Y + Math.sin(ca) * CRANK_R * 0.32;
  const behind = Math.sin(ca) < 0;

  // 影
  ctx.fillStyle = 'rgba(60,30,10,0.18)';
  ellipse(MX, 424, 110, 8);
  ctx.fill();

  // 本体（木の箱）
  ctx.fillStyle = '#7a4a28';
  roundRect(236, 196, 168, 228, 8);
  ctx.fill();
  const wood = ctx.createLinearGradient(236, 0, 404, 0);
  wood.addColorStop(0, '#9c6337');
  wood.addColorStop(0.5, '#b97a46');
  wood.addColorStop(1, '#8c5630');
  ctx.fillStyle = wood;
  roundRect(240, 198, 160, 222, 7);
  ctx.fill();
  // 木目
  ctx.strokeStyle = 'rgba(80,40,15,0.18)';
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 6; k++) {
    ctx.beginPath();
    const y0 = 214 + k * 34;
    ctx.moveTo(244, y0);
    ctx.bezierCurveTo(290, y0 + 6, 340, y0 - 6, 396, y0 + 3);
    ctx.stroke();
  }
  // 上の縁
  ctx.fillStyle = '#6b3f20';
  roundRect(228, 188, 184, 14, 5);
  ctx.fill();

  // 引き出し（ガラス窓から粉が見える）
  ctx.fillStyle = '#6b3f20';
  roundRect(256, 300, 128, 92, 6);
  ctx.fill();
  ctx.fillStyle = '#a56a3b';
  roundRect(260, 304, 120, 84, 5);
  ctx.fill();
  ctx.fillStyle = '#efe3d3';
  roundRect(272, 312, 96, 50, 6);
  ctx.fill();
  ctx.save();
  roundRect(272, 312, 96, 50, 6);
  ctx.clip();
  const pile = g.progress * 40;
  if (pile > 0.5) {
    ctx.fillStyle = mixColor('#9a6a42', '#7a4c2c', grind.dot / 8);
    ctx.beginPath();
    ctx.moveTo(272, 362);
    ctx.quadraticCurveTo(320, 362 - pile * 1.6, 368, 362);
    ctx.closePath();
    ctx.fill();
    // 粒
    ctx.fillStyle = 'rgba(60,30,12,0.45)';
    for (let k = 0; k < pile * 3; k++) {
      const x = 276 + ((k * 37) % 88);
      const top = 362 - pile * 1.6 * (1 - ((x - 320) / 48) ** 2) * 0.5;
      const y = top + ((k * 53) % 17) + 2;
      if (y < 361) ctx.fillRect(x, y, grind.dot * 0.35, grind.dot * 0.35);
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(278, 316, 6, 40);
  ctx.restore();
  // つまみ
  ctx.fillStyle = '#d9b27a';
  ellipse(MX, 376, 9, 7);
  ctx.fill();
  ctx.fillStyle = '#5a3216';
  ellipse(MX, 377, 4, 3);
  ctx.fill();

  // ホッパー（豆を入れるお椀）
  ctx.fillStyle = '#c9ccd1';
  ctx.beginPath();
  ctx.moveTo(MX - 80, 150);
  ctx.quadraticCurveTo(MX - 72, 192, MX - 48, 194);
  ctx.lineTo(MX + 48, 194);
  ctx.quadraticCurveTo(MX + 72, 192, MX + 80, 150);
  ctx.closePath();
  ctx.fill();
  const metal = ctx.createLinearGradient(MX - 80, 0, MX + 80, 0);
  metal.addColorStop(0, 'rgba(255,255,255,0)');
  metal.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  metal.addColorStop(0.45, 'rgba(255,255,255,0)');
  ctx.fillStyle = metal;
  ctx.fill();
  ctx.fillStyle = '#9aa0a8';
  ellipse(MX, 150, 80, 24);
  ctx.fill();
  ctx.fillStyle = '#6f757d';
  ellipse(MX, 152, 74, 20);
  ctx.fill();

  // 豆
  ctx.save();
  ellipse(MX, 152, 74, 20);
  ctx.clip();
  for (const bn of g.beans) {
    if (bn.gone) continue;
    drawBean(MX + bn.x, 152 + bn.y, bn.rot, bn.s);
  }
  // 中心の刃の穴
  ctx.fillStyle = 'rgba(20,20,24,0.55)';
  ellipse(MX, 152, 10, 4);
  ctx.fill();
  ctx.restore();

  // ハンドル（奥にあるときは軸より先に描く）
  const drawArm = () => {
    ctx.strokeStyle = '#3d3f44';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(MX, CRANK_Y);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(MX, CRANK_Y - 1.5);
    ctx.lineTo(hx, hy - 1.5);
    ctx.stroke();
    // 握り玉
    ctx.fillStyle = '#5a3216';
    roundRect(hx - 7, hy - 30, 14, 30, 6);
    ctx.fill();
    ctx.fillStyle = '#8a5530';
    ellipse(hx, hy - 30, 11, 11);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ellipse(hx - 3, hy - 34, 4, 3);
    ctx.fill();
  };
  const drawShaft = () => {
    ctx.fillStyle = '#55585e';
    ctx.fillRect(MX - 4, CRANK_Y, 8, 44);
    ctx.fillStyle = '#2f3135';
    ellipse(MX, CRANK_Y, 9, 4);
    ctx.fill();
  };
  if (behind) {
    drawArm();
    drawShaft();
  } else {
    drawShaft();
    drawArm();
  }

  // 香り（挽くほど立ちのぼる）
  if (g.aroma > 0.02) drawSteam(MX, 130, 60, g.aroma * 0.5, 3, 90);

  // 回し方の案内（最初だけ）
  if (!g.started && state === 'grind') {
    const t = clock;
    ctx.save();
    ctx.strokeStyle = T.accent;
    ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 4);
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 10]);
    ctx.lineDashOffset = -t * 30;
    ctx.beginPath();
    ctx.ellipse(MX, MILL_CY, 175, 150, 0, -Math.PI * 0.9, Math.PI * 0.6);
    ctx.stroke();
    ctx.setLineDash([]);
    // 矢印の先
    const ea = Math.PI * 0.6;
    const ex = MX + Math.cos(ea) * 175, ey = MILL_CY + Math.sin(ea) * 150;
    ctx.fillStyle = T.accent;
    ctx.translate(ex, ey);
    ctx.rotate(ea + Math.PI / 2 + 0.2);
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-8, -9);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    text('ぐるぐる回して挽こう', MX, 72, 17, T.ink, 'center');
  }

  // 左：情報
  text(`${grind.name}`, 24, 76, 18);
  text('豆 20g', 24, 100, 14, T.inkSoft, 'left', 600);
  const turns = Math.min(grind.turns, Math.floor(g.progress * grind.turns));
  text(`${turns} / ${grind.turns} 回転`, 24, 124, 14, T.inkSoft, 'left', 600);

  // 右：回す速さのメーター
  const mx = 462, mw = 156, my = 92;
  text('回すはやさ', mx, 72, 14, T.inkSoft, 'left', 700);
  ctx.fillStyle = T.bgDeep;
  roundRect(mx, my, mw, 14, 7);
  ctx.fill();
  const toX = (w) => mx + clamp(w / 3, 0, 1) * mw;
  ctx.fillStyle = 'rgba(143,191,90,0.55)';
  roundRect(toX(0.4), my, toX(2.1) - toX(0.4), 14, 7);
  ctx.fill();
  ctx.fillStyle = 'rgba(230,90,60,0.35)';
  roundRect(toX(2.1), my, mx + mw - toX(2.1), 14, 7);
  ctx.fill();
  const fast = g.omega > 2.1;
  ctx.fillStyle = fast ? '#d9480f' : T.ink;
  roundRect(toX(g.omega) - 3, my - 5, 6, 24, 3);
  ctx.fill();
  text(fast ? '速すぎ！ 粒がばらつく' : g.omega > 0.4 ? 'いいペース' : 'ゆっくり一定がコツ', mx, my + 32, 13, fast ? '#d9480f' : T.inkSoft, 'left', 700);
  if (g.good + g.bad > 4) text(`粒のそろい ${Math.round(evenness() * 100)}%`, mx, my + 54, 13, T.inkSoft, 'left', 600);
}

function drawBean(x, y, rot, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s, s);
  ctx.fillStyle = '#4a2a17';
  ellipse(0, 0, 7, 4.6);
  ctx.fill();
  ctx.fillStyle = '#6b3d21';
  ellipse(-1, -1, 5.6, 3.4);
  ctx.fill();
  ctx.strokeStyle = '#2a170b';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-5, 0.5);
  ctx.quadraticCurveTo(0, -1.5, 5, 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawSteam(x, y, height, alpha, count, spread) {
  ctx.save();
  ctx.lineCap = 'round';
  for (let k = 0; k < count; k++) {
    const ph = clock * 0.7 + k * 1.7;
    const loop = ph % 1;
    const bx = x + (k - (count - 1) / 2) * (spread / count);
    ctx.strokeStyle = `rgba(255,255,255,${alpha * Math.sin(loop * Math.PI)})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let s = 0; s <= 10; s++) {
      const yy = y - loop * height * 0.6 - (s / 10) * height * 0.5;
      const xx = bx + Math.sin(s * 0.7 + ph * 3) * 6;
      if (s === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// ---- 淹れる場面
const SERVER_TOP = 292;
const SERVER_BOT = 422;
function serverLevelY() {
  return SERVER_BOT - 6 - clamp(b.server / 260, 0, 1) * (SERVER_BOT - SERVER_TOP - 22);
}
const coneHalf = (y) => lerp(RIM_RX, 30, (y - RIM_Y) / (CONE_BOT - RIM_Y));

function coffeeColor(alpha = 1) {
  return `rgba(58,30,14,${alpha})`;
}

function drawBrewScene() {
  const lift = state === 'finish' ? easeInOut(clamp(b.liftT / 0.9, 0, 1)) : 0;
  drawServer();

  // ドリッパー一式（できあがりで持ち上げる）
  ctx.save();
  ctx.translate(0, -lift * 70);
  ctx.globalAlpha = 1 - lift;
  drawDripper();
  ctx.restore();

  // しずく・流れ
  if (state === 'brew' || state === 'transfer') {
    ctx.fillStyle = coffeeColor(0.95);
    for (const d of drops) {
      ellipse(DX, d.y, 2.2, 3.4);
      ctx.fill();
    }
    if (b.flow >= 3.5) {
      const w = clamp(1 + b.flow * 0.25, 1.5, 4);
      ctx.fillRect(DX - w / 2, CONE_BOT + 12, w, serverLevelY() - CONE_BOT - 12);
    }
  }

  if (state === 'brew') {
    drawKettle();
    drawBrewUi();
  } else if (state === 'transfer') {
    text('粉をドリッパーへ', DX, 64, 16, T.ink, 'center');
  }
}
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function drawServer() {
  const top = SERVER_TOP, bot = SERVER_BOT;
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(DX - 60, top);
    ctx.bezierCurveTo(DX - 64, top + 20, DX - 104, top + 40, DX - 104, top + 80);
    ctx.lineTo(DX - 100, bot - 10);
    ctx.quadraticCurveTo(DX - 98, bot, DX - 86, bot);
    ctx.lineTo(DX + 86, bot);
    ctx.quadraticCurveTo(DX + 98, bot, DX + 100, bot - 10);
    ctx.lineTo(DX + 104, top + 80);
    ctx.bezierCurveTo(DX + 104, top + 40, DX + 64, top + 20, DX + 60, top);
    ctx.closePath();
  };
  // 影
  ctx.fillStyle = 'rgba(60,30,10,0.16)';
  ellipse(DX, bot + 2, 118, 7);
  ctx.fill();
  // ガラス
  path();
  ctx.fillStyle = 'rgba(210,230,240,0.28)';
  ctx.fill();
  // 珈琲
  ctx.save();
  path();
  ctx.clip();
  const ly = serverLevelY();
  if (b.server > 0.5) {
    const cg = ctx.createLinearGradient(0, ly, 0, bot);
    cg.addColorStop(0, '#6a3a1a');
    cg.addColorStop(1, '#2a140a');
    ctx.fillStyle = cg;
    ctx.fillRect(DX - 110, ly, 220, bot - ly + 2);
    ctx.fillStyle = 'rgba(190,120,60,0.6)';
    ellipse(DX, ly, 100, 6);
    ctx.fill();
    ctx.fillStyle = '#3a1e0e';
    ellipse(DX, ly + 1, 96, 4.5);
    ctx.fill();
    for (const rp of ripples) {
      if (!rp.server) continue;
      const k = rp.t / 0.7;
      ctx.strokeStyle = `rgba(230,180,120,${0.5 * (1 - k)})`;
      ctx.lineWidth = 1.2;
      ellipse(DX, ly + 1, 4 + k * 40, 1 + k * 3);
      ctx.stroke();
    }
  }
  ctx.restore();
  // 目盛り
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.fillStyle = T.inkSoft;
  ctx.lineWidth = 2;
  for (const ml of [100, 150, 200]) {
    const y = SERVER_BOT - 6 - (ml / 260) * (SERVER_BOT - SERVER_TOP - 22);
    ctx.beginPath();
    ctx.moveTo(DX + 70, y);
    ctx.lineTo(DX + 86, y);
    ctx.stroke();
    text(String(ml), DX + 66, y, 11, ml === SERVER_GOAL ? T.accent : 'rgba(255,255,255,0.9)', 'right', 700);
  }
  // ハイライト
  path();
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(DX - 88, top + 70, 7, 90);
  // 湯気
  if (b.server > 20 && state !== 'brew') drawSteam(DX, top - 10, 50, 0.3, 3, 60);
}

function drawDripper() {
  // 台（サーバーに乗るリング）
  ctx.fillStyle = '#e9e2d8';
  ellipse(DX, CONE_BOT + 8, 62, 12);
  ctx.fill();
  ctx.fillStyle = '#cfc6b9';
  ellipse(DX, CONE_BOT + 10, 62, 10);
  ctx.fill();
  ctx.fillStyle = '#3b2a1e';
  ellipse(DX, CONE_BOT + 9, 6, 2.5);
  ctx.fill();

  // 円すいの外側（白い陶器）
  ctx.beginPath();
  ctx.moveTo(DX - RIM_RX - 6, RIM_Y);
  ctx.lineTo(DX - 32, CONE_BOT + 4);
  ctx.quadraticCurveTo(DX, CONE_BOT + 14, DX + 32, CONE_BOT + 4);
  ctx.lineTo(DX + RIM_RX + 6, RIM_Y);
  ctx.closePath();
  const ceramic = ctx.createLinearGradient(DX - RIM_RX, 0, DX + RIM_RX, 0);
  ceramic.addColorStop(0, '#d9d1c6');
  ceramic.addColorStop(0.35, '#fbf8f3');
  ceramic.addColorStop(1, '#cdc3b6');
  ctx.fillStyle = ceramic;
  ctx.fill();
  // リブ
  ctx.strokeStyle = 'rgba(150,135,115,0.25)';
  ctx.lineWidth = 2;
  for (let k = -3; k <= 3; k++) {
    ctx.beginPath();
    ctx.moveTo(DX + k * 30, RIM_Y + RIM_RY * 0.9);
    ctx.lineTo(DX + k * 7, CONE_BOT);
    ctx.stroke();
  }
  // 紙にかかったお湯のしみ（縁に注ぐと見える）
  if (b.bypassMl > 0) {
    ctx.fillStyle = `rgba(180,140,90,${Math.min(0.35, b.bypassMl / 60)})`;
    ellipse(DX, RIM_Y + 2, RIM_RX + 2, RIM_RY + 2);
    ctx.fill();
  }

  // 口（縁）
  ctx.fillStyle = '#f4efe8';
  ellipse(DX, RIM_Y, RIM_RX + 8, RIM_RY + 6);
  ctx.fill();
  ctx.strokeStyle = '#d2c8ba';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // 内側（ペーパーフィルター）
  const inner = ctx.createLinearGradient(0, RIM_Y - RIM_RY, 0, RIM_Y + RIM_RY);
  inner.addColorStop(0, '#e6dccb');
  inner.addColorStop(1, '#fbf6ec');
  ctx.fillStyle = inner;
  ellipse(DX, RIM_Y, RIM_RX - 4, RIM_RY - 4);
  ctx.fill();

  // 内側：粉と水面
  ctx.save();
  ellipse(DX, RIM_Y, RIM_RX - 4, RIM_RY - 4);
  ctx.clip();
  // フィルターのひだ
  ctx.strokeStyle = 'rgba(170,150,120,0.28)';
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 14; k++) {
    const a = Math.PI + (k / 13) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(DX + Math.cos(a) * (RIM_RX - 6), RIM_Y + Math.sin(a) * (RIM_RY - 6));
    ctx.lineTo(DX + Math.cos(a) * 40, GROUND_Y + Math.sin(a) * 10);
    ctx.stroke();
  }
  const fill = state === 'transfer' ? easeInOut(b.groundsIn) : 1;
  drawGrounds(fill);
  ctx.restore();
}

function drawGrounds(fill) {
  const gy = GROUND_Y + (1 - fill) * 40 - b.dome;
  const grx = GROUND_RX * (0.4 + 0.6 * fill);
  const gry = GROUND_RY * (0.4 + 0.6 * fill);
  // 粉の表面（格子ごとに乾いた色→湿った色）
  ctx.save();
  ellipse(DX, gy, grx, gry);
  ctx.clip();
  const cw = (grx * 2) / N + 1;
  const ch = (gry * 2) / N + 1;
  const dryA = '#b88a5f', dryB = '#a77a50';
  for (const c of cells) {
    const x = DX + c.u * grx - cw / 2;
    const y = gy + c.v * gry - ch / 2;
    const w = Math.min(1, c.wet);
    const base = c.speck > 0.5 ? dryA : dryB;
    ctx.fillStyle = mixColor(base, c.speck > 0.7 ? '#3e2414' : '#4a2b18', w);
    ctx.fillRect(x, y, cw, ch);
  }
  // ふくらみの陰影
  const dg = ctx.createRadialGradient(DX - grx * 0.25, gy - gry * 0.4, 4, DX, gy, grx);
  dg.addColorStop(0, `rgba(255,240,220,${0.12 + b.dome * 0.02})`);
  dg.addColorStop(0.7, 'rgba(0,0,0,0)');
  dg.addColorStop(1, 'rgba(40,20,5,0.35)');
  ctx.fillStyle = dg;
  ctx.fillRect(DX - grx, gy - gry, grx * 2, gry * 2);
  // 粒々
  ctx.fillStyle = 'rgba(40,20,8,0.25)';
  const dot = grind.dot * 0.3;
  for (let k = 0; k < cells.length; k += 2) {
    const c = cells[k];
    ctx.fillRect(DX + (c.u + c.speck * 0.05) * grx, gy + (c.v - c.speck * 0.05) * gry, dot, dot);
  }
  // 蒸らしの泡
  for (const q of bubbles) {
    const k = q.t / q.life;
    const rr = q.s * (k < 0.8 ? 0.5 + k * 0.7 : 1);
    const x = DX + q.u * grx, y = gy + q.v * gry - b.dome * 0.2;
    ctx.fillStyle = `rgba(214,170,120,${0.8 * (1 - k * 0.6)})`;
    ellipse(x, y, rr, rr * 0.8);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,240,215,0.7)';
    ellipse(x - rr * 0.35, y - rr * 0.35, rr * 0.3, rr * 0.25);
    ctx.fill();
  }
  ctx.restore();

  // たまったお湯
  if (b.pool > 0.8) {
    const s = surface();
    const a = clamp(b.pool / 25, 0, 1);
    ctx.fillStyle = `rgba(70,36,16,${0.55 + a * 0.35})`;
    ellipse(DX, s.y, s.rx, s.ry);
    ctx.fill();
    ctx.fillStyle = `rgba(255,220,180,${0.12 * a})`;
    ellipse(DX - s.rx * 0.2, s.y - s.ry * 0.3, s.rx * 0.5, s.ry * 0.35);
    ctx.fill();
    // 波紋
    for (const rp of ripples) {
      if (rp.server) continue;
      const k = rp.t / 0.7;
      ctx.strokeStyle = `rgba(255,230,200,${0.35 * (1 - k)})`;
      ctx.lineWidth = 1.3;
      ellipse(DX + rp.u * s.rx, s.y + rp.v * s.ry, 3 + k * 30, 1 + k * 10);
      ctx.stroke();
    }
  }
  // 注いだあたりの細かい泡（水面でも粉の上でも見える）
  const s2 = surface();
  for (const f of foam) {
    const k = f.t / f.life;
    ctx.fillStyle = `rgba(222,186,140,${0.85 * (1 - k)})`;
    ellipse(DX + f.u * s2.rx, s2.y + f.v * s2.ry, f.s, f.s * 0.75);
    ctx.fill();
  }
}

function drawKettle() {
  const tipX = b.aimX;
  const tipY = b.aimY - 96 - (1 - b.tilt) * 10;
  // お湯の流れ
  if (b.rate > 0.05) {
    const w = 1.2 + b.rate * 0.28;
    const wob = Math.sin(clock * 30) * 0.6;
    ctx.strokeStyle = 'rgba(225,240,250,0.85)';
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tipX, tipY + 2);
    ctx.quadraticCurveTo(tipX - 3 + wob, (tipY + b.aimY) / 2, b.aimX + wob, b.aimY);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(0.6, w * 0.3);
    ctx.stroke();
  }
  // ねらいの印（注いでいないとき）
  if (b.rate < 0.5) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ellipse(b.aimX, b.aimY, 8, 3);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // 細口ケトル（注ぐときは口を中心に傾く）
  ctx.save();
  ctx.translate(tipX, tipY);
  ctx.rotate(-0.32 * b.tilt);
  ctx.scale(0.82, 0.82);
  // 注ぎ口（グースネック）
  ctx.strokeStyle = '#3f4248';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(14, -10, 34, 6);
  ctx.bezierCurveTo(60, 30, 70, 80, 112, 96);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // 本体
  const kb = ctx.createLinearGradient(100, 0, 210, 0);
  kb.addColorStop(0, '#55595f');
  kb.addColorStop(0.35, '#8b9097');
  kb.addColorStop(1, '#3a3d42');
  ctx.fillStyle = kb;
  ctx.beginPath();
  ctx.moveTo(108, 150);
  ctx.lineTo(118, 76);
  ctx.quadraticCurveTo(155, 62, 192, 76);
  ctx.lineTo(202, 150);
  ctx.quadraticCurveTo(155, 160, 108, 150);
  ctx.closePath();
  ctx.fill();
  // ふた
  ctx.fillStyle = '#2f3237';
  ellipse(155, 74, 36, 8);
  ctx.fill();
  ctx.fillStyle = '#1f2024';
  ellipse(155, 66, 7, 5);
  ctx.fill();
  // 取っ手
  ctx.strokeStyle = '#2a2b2f';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(196, 86);
  ctx.quadraticCurveTo(240, 92, 232, 120);
  ctx.quadraticCurveTo(226, 140, 200, 140);
  ctx.stroke();
  ctx.restore();
  // 注ぎ口の湯気
  drawSteam(tipX + 10, tipY - 4, 30, 0.35, 1, 0);
}

function drawBrewUi() {
  // 右：注いだ量のゲージ
  const gx = 590, gTop = 66, gBot = 360, gMax = 270;
  const toY = (ml) => gBot - (clamp(ml, 0, gMax) / gMax) * (gBot - gTop);
  text('注いだ量', gx + 12, gTop - 14, 12, T.inkSoft, 'center', 700);
  ctx.fillStyle = T.bgDeep;
  roundRect(gx, gTop, 24, gBot - gTop, 12);
  ctx.fill();
  const fy = toY(b.poured);
  ctx.save();
  roundRect(gx, gTop, 24, gBot - gTop, 12);
  ctx.clip();
  const wg = ctx.createLinearGradient(0, gTop, 0, gBot);
  wg.addColorStop(0, '#7cc4e8');
  wg.addColorStop(1, '#3d8fc4');
  ctx.fillStyle = wg;
  ctx.fillRect(gx, fy, 24, gBot - fy);
  ctx.restore();
  const marks = [{ ml: 40, label: '蒸らし' }, ...TARGETS.map((ml, i) => ({ ml, label: `${i + 1}投目` }))];
  marks.forEach((m, i) => {
    const y = toY(m.ml);
    const done = i === 0 ? b.bloom !== 'pre' : b.target >= i;
    const next = i === 0 ? b.bloom === 'pre' : !done && b.target === i - 1 && b.bloom !== 'pre';
    ctx.fillStyle = done ? T.gold : next ? T.accent : T.inkSoft;
    ctx.fillRect(gx - 8, y - 1.5, 40, 3);
    text(m.label, gx - 12, y - 8, 12, done ? T.gold : next ? T.accent : T.inkSoft, 'right', 700);
    text(`${m.ml}`, gx - 12, y + 7, 11, T.inkSoft, 'right', 600);
  });
  text(`${Math.round(b.poured)}ml`, gx + 12, gBot + 16, 14, T.ink, 'center', 700);

  // 左：いまやること
  let msg = '', sub = '';
  if (b.bloom === 'pre') {
    msg = b.poured < 1 ? '少しだけ注いで' : '粉全体を湿らせよう';
    sub = b.poured < 1 ? '粉全体を湿らせよう' : `湿り ${Math.floor(b.wetPct * 100)}%`;
  } else if (b.bloom === 'wait') {
    msg = b.bloomChimed ? '蒸らしOK！' : '手を止めて蒸らす';
    sub = b.bloomChimed ? '中心から「の」の字に' : 'ふくらむのを待とう';
  } else if (b.target < TARGETS.length) {
    msg = b.pool > 70 ? '水位が下がるのを待とう' : '「の」の字に注ごう';
    sub = `${b.target + 1}投目：${TARGETS[b.target]}ml まで`;
  } else {
    msg = '落ちきるのを待とう';
    sub = 'Enter / ボタンで完成';
  }
  text(msg, 22, 70, 16, T.ink, 'left', 700);
  text(sub, 22, 92, 13, T.inkSoft, 'left', 600);

  // 蒸らしタイマー
  if (b.bloom === 'wait') {
    const waited = clock - b.bloomStart;
    const k = clamp(waited / BLOOM_OK, 0, 1);
    const cx = 74, cy = 160, rr = 34;
    ctx.lineWidth = 7;
    ctx.strokeStyle = T.bgDeep;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = k >= 1 ? T.gold : T.accent;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + TAU * k);
    ctx.stroke();
    text(`${Math.floor(waited)}`, cx, cy - 2, 22, T.ink, 'center', 700);
    text('秒', cx, cy + 18, 11, T.inkSoft, 'center', 600);
  }

  // 水位（ドリッパーの中）
  if (b.bloom !== 'pre' || b.pool > 5) {
    const lx = 22, ly = 214;
    text('ドリッパーの水位', lx, ly, 12, T.inkSoft, 'left', 700);
    ctx.fillStyle = T.bgDeep;
    roundRect(lx, ly + 12, 120, 10, 5);
    ctx.fill();
    const lk = b.pool / CAP;
    ctx.fillStyle = lk > 0.85 ? '#d9480f' : '#6a3a1a';
    roundRect(lx, ly + 12, Math.max(10, 120 * lk), 10, 5);
    ctx.fill();
    if (lk > 0.85) text('あふれそう！', lx, ly + 36, 12, '#d9480f', 'left', 700);
  }

  // できあがりボタン
  if (canFinish()) {
    const r = FINISH_BTN;
    const pulse = b.target >= TARGETS.length ? 0.5 + 0.5 * Math.sin(clock * 5) : 0;
    ctx.fillStyle = T.accent;
    ctx.globalAlpha = 0.85 + pulse * 0.15;
    roundRect(r.x, r.y, r.w, r.h, 21);
    ctx.fill();
    ctx.globalAlpha = 1;
    text('できあがり', r.x + r.w / 2, r.y + r.h / 2, 15, '#fff', 'center', 700);
  }
}

function drawParticles() {
  for (const q of particles) {
    const k = q.t / q.life;
    if (q.kind === 'bean') {
      ctx.globalAlpha = 1 - k;
      drawBean(q.x, q.y, q.rot, 1 - k * 0.6);
      ctx.globalAlpha = 1;
      continue;
    }
    if (q.kind === 'chip' || q.kind === 'powder' || q.kind === 'fall') {
      ctx.fillStyle = q.c || '#8a5a36';
      ctx.globalAlpha = 1 - k * 0.6;
      ctx.fillRect(q.x, q.y, q.s, q.s);
    } else if (q.kind === 'splash') {
      ctx.fillStyle = 'rgba(230,240,250,0.9)';
      ctx.globalAlpha = 1 - k;
      ellipse(q.x, q.y, q.s, q.s);
      ctx.fill();
    } else if (q.kind === 'spill') {
      ctx.fillStyle = coffeeColor(0.8);
      ctx.globalAlpha = 1 - k;
      ellipse(q.x, q.y, q.s, q.s * 1.4);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function drawFloaters() {
  for (const f of floaters) {
    const k = f.t / f.life;
    const pop = Math.min(1, f.t / 0.15);
    const scale = 0.6 + 0.4 * (1 - (1 - pop) ** 3) + (f.t < 0.2 ? 0.15 * Math.sin((f.t / 0.2) * Math.PI) : 0);
    ctx.save();
    ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    ctx.translate(f.x, f.y - k * 18);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.font = `700 20px ${FONT}`;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(50,25,10,0.85)';
    ctx.strokeText(f.text, 0, 0);
    ctx.fillStyle = '#ffe066';
    ctx.fillText(f.text, 0, 0);
    if (f.sub) {
      ctx.font = `700 12px ${FONT}`;
      ctx.lineWidth = 4;
      ctx.strokeText(f.sub, 0, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(f.sub, 0, 18);
    }
    ctx.restore();
  }
}

function drawBanner() {
  const t = banner.t;
  const pop = clamp(t / 0.35, 0, 1);
  const scale = 0.5 + 0.5 * (1 - (1 - pop) ** 3) + 0.12 * Math.sin(Math.min(1, t / 0.5) * Math.PI);
  ctx.save();
  ctx.globalAlpha = t > 1.3 ? 1 - (t - 1.3) / 0.3 : 1;
  ctx.translate(W / 2, 236);
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.font = `700 50px ${FONT}`;
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(50,25,10,0.9)';
  ctx.strokeText(banner.text, 0, 0);
  ctx.fillStyle = '#ffe066';
  ctx.fillText(banner.text, 0, 0);
  if (banner.sub) {
    ctx.font = `700 18px ${FONT}`;
    ctx.lineWidth = 6;
    ctx.strokeText(banner.sub, 0, 40);
    ctx.fillStyle = '#fff';
    ctx.fillText(banner.sub, 0, 40);
  }
  ctx.restore();
}

function drawHud() {
  ctx.fillStyle = T.panel;
  ctx.fillRect(0, 0, W, HUD);
  ctx.fillStyle = T.border;
  ctx.fillRect(0, HUD - 2, W, 2);
  // 手順
  const steps = ['挽く', '蒸らす', '注ぐ', '完成'];
  let cur = 0;
  if (state === 'transfer' || (state === 'brew' && b.bloom !== 'done')) cur = 1;
  if (state === 'brew' && b.bloom === 'done') cur = 2;
  if (state === 'finish' || state === 'result') cur = 3;
  if (state === 'grind' && g.progress >= 1) cur = 1;
  let x = 12;
  steps.forEach((s, i) => {
    const active = i === cur && state !== 'title';
    const done = i < cur;
    ctx.font = `700 13px ${FONT}`;
    const w = ctx.measureText(s).width + 34;
    ctx.fillStyle = active ? T.accent : done ? T.bgDeep : 'transparent';
    roundRect(x, 8, w, 24, 12);
    ctx.fill();
    ctx.fillStyle = active ? '#fff' : done ? T.muted : T.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${done ? '✓' : i + 1} ${s}`, x + 10, 20.5);
    x += w + 6;
  });
  // 右：進捗と時間
  ctx.textAlign = 'right';
  ctx.fillStyle = T.muted;
  ctx.font = `600 14px ${FONT}`;
  if (state === 'grind') {
    const bx = W - 190, bw = 120;
    ctx.fillStyle = T.bgDeep;
    roundRect(bx, 13, bw, 14, 7);
    ctx.fill();
    ctx.fillStyle = '#8a5a36';
    if (g.progress > 0.01) {
      roundRect(bx, 13, Math.max(14, bw * g.progress), 14, 7);
      ctx.fill();
    }
    ctx.fillStyle = T.fg;
    ctx.fillText(`${Math.floor(g.progress * 100)}%`, W - 14, HUD / 2);
  } else if (state === 'brew' || state === 'finish') {
    ctx.fillStyle = T.fg;
    ctx.fillText(`抽出 ${fmtTime(b.elapsed)}`, W - 14, HUD / 2);
    ctx.fillStyle = T.muted;
    ctx.fillText(`サーバー ${Math.round(b.server)}ml`, W - 110, HUD / 2);
  }
}
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function drawPause() {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, HUD, W, H - HUD);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.font = `700 32px ${FONT}`;
  ctx.fillText('一時停止中', W / 2, H / 2 - 12);
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText('タップ / P / スペースで再開', W / 2, H / 2 + 24);
}

// ---------------------------------------------------------------- 味の評価
function evaluate() {
  const even = evenness();
  const poured = Math.max(1, b.poured);
  const bypassFrac = b.bypassMl / poured;
  // 抽出の進み具合：時間が長いほど・細かいほど・ムラがあるほど進む（1.0 がちょうどよい）
  const E = (b.elapsed / IDEAL_TIME) ** 0.7 * grind.ext * (1 + (1 - even) * 0.25) * (1 - bypassFrac * 0.7);
  // 香り：蒸らしの時間と量
  const w = Math.max(0, b.bloomWait);
  let bloomK = w >= 15 && w <= 35 ? 1 : w < 15 ? w / 15 : Math.max(0.6, 1 - (w - 35) / 40);
  const amt = b.bloomAmount;
  const amtK = amt >= 25 && amt <= 65 ? 1 : 0.7;
  const aroma = clamp(bloomK * amtK * (0.6 + 0.4 * b.bloomWet), 0, 1);
  // バランス
  const balance = clamp(1 - (Math.abs(E - 1) - 0.07) / 0.38, 0, 1);
  // すっきり：注ぐ位置・粒のそろい・あふれ
  const inGrounds = Math.max(1, b.centerMl + b.midMl + b.edgeMl);
  const pourQ = (b.centerMl + b.midMl * 0.8 + b.edgeMl * 0.35) / inGrounds;
  const clarity = clamp(0.5 * pourQ + 0.5 * even - bypassFrac * 1.2 - b.spilled / 120, 0, 1);
  // 量
  const amount = clamp(1 - Math.max(0, Math.abs(b.server - SERVER_GOAL) - 8) / 70, 0, 1);
  const score = Math.round(aroma * 25 + balance * 35 + clarity * 25 + amount * 15);
  return { E, aroma, balance, clarity, amount, score, even, pourQ, bypassFrac };
}

function rankOf(score) {
  if (score >= 90) return { title: '喫茶店のマスターの一杯', stars: 5 };
  if (score >= 78) return { title: 'ていねいに淹れた一杯', stars: 4 };
  if (score >= 62) return { title: 'ほっとする、おうちの一杯', stars: 3 };
  if (score >= 45) return { title: 'まだまだ修行中の一杯', stars: 2 };
  return { title: '…個性的な一杯', stars: 1 };
}

function tasteComment(ev) {
  const parts = [];
  if (ev.E < 0.86) parts.push('酸味が立って、あっさり軽め');
  else if (ev.E > 1.14) parts.push('苦みが強く、どっしり重め');
  else parts.push('甘みと苦みのバランスがいい');
  if (b.server > SERVER_GOAL + 25) parts.push('少し水っぽい');
  else if (b.server < SERVER_GOAL - 30) parts.push('量が少なく濃いめ');
  if (ev.aroma > 0.85) parts.push('香りがふわっと広がる');
  if (ev.clarity > 0.8) parts.push('後味すっきり');
  else if (ev.clarity < 0.5) parts.push('雑味が少し残る');
  return parts.join('。') + '。';
}

function tipFor(ev) {
  const items = [
    { k: ev.aroma, msg: b.bloomWait < 15 ? '全体を湿らせたら、15〜30秒ほど手を止めて蒸らすと香りが立ちます。' : '蒸らしは少しのお湯（30〜60ml）で全体を湿らせるのがコツ。' },
    { k: ev.balance, msg: ev.E < 1 ? '少し早く落ちすぎ。水位が下がるのを待ちながらゆっくり注ぐか、細かめに挽いてみよう。' : '時間がかかりすぎて苦め。注ぐペースを上げるか、粗めに挽いてみよう。' },
    { k: ev.clarity, msg: ev.even < 0.8 ? 'ミルはゆっくり一定のペースで回すと、粒がそろって雑味が減ります。' : b.spilled > 5 ? 'お湯がドリッパーからあふれました。水位を見ながら注ごう。' : '縁（紙）に直接お湯をかけず、中心から「の」の字に注ごう。' },
    { k: ev.amount, msg: b.server < SERVER_GOAL ? 'あと少しお湯を足すと、ちょうど 200ml になります。' : 'サーバーが 200ml になったところでドリッパーを外すと、ちょうどいい濃さに。' },
  ];
  items.sort((p, q) => p.k - q.k);
  return items[0].k > 0.92 ? '完璧！ ほかの挽き目でも淹れてみよう。' : items[0].msg;
}

// ---------------------------------------------------------------- 画面（DOM オーバーレイ）
function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
}
function hideOverlay() {
  overlay.hidden = true;
  overlay.replaceChildren();
}
function showOverlay(card, focusEl) {
  overlay.replaceChildren(card);
  overlay.hidden = false;
  (focusEl || card.querySelector('button'))?.focus();
}
const recKey = (gi) => `${GAME_ID}:best:${GRINDS[gi].id}`;

function showTitle() {
  state = 'title';
  paused = false;
  makeBeans();
  const card = el('div', 'card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', '挽き目を選ぶ');
  card.append(el('h2', '', 'ハンドドリップ珈琲'));
  const cups = load(`${GAME_ID}:cups`, 0);
  card.append(el('p', 'lead', cups ? `豆を挽いて、お湯を注いで、一杯を淹れよう。これまでに ${cups} 杯淹れました。` : '豆を挽いて、お湯を注いで、一杯を淹れよう。まずは挽き目を選んでください。'));
  const ul = el('ul', 'choices');
  const last = load(`${GAME_ID}:lastGrind`, 1);
  let focus = null;
  GRINDS.forEach((gr, i) => {
    const li = el('li');
    const bt = el('button', 'choice');
    bt.type = 'button';
    const dots = el('span', 'dots');
    dots.setAttribute('aria-hidden', 'true');
    for (let k = 0; k < 6; k++) {
      const d = el('i');
      d.style.width = d.style.height = `${gr.dot + 1}px`;
      dots.append(d);
    }
    bt.append(dots);
    const nm = el('span', 'name', gr.name);
    nm.append(el('small', '', gr.sub));
    bt.append(nm);
    const rec = load(recKey(i), null);
    bt.append(el('span', 'rec', rec ? `ベスト\n${rec.score} 点` : ''));
    bt.addEventListener('click', () => startGame(i));
    li.append(bt);
    ul.append(li);
    if (i === last) focus = bt;
  });
  card.append(ul);
  showOverlay(card, focus);
}

function showResult() {
  if (state === 'result') return;
  state = 'result';
  silence();
  const ev = evaluate();
  const rank = rankOf(ev.score);
  const gi = GRINDS.indexOf(grind);
  const prev = load(recKey(gi), null);
  const isBest = !prev || ev.score > prev.score;
  if (isBest) save(recKey(gi), { score: ev.score });
  const cups = load(`${GAME_ID}:cups`, 0) + 1;
  save(`${GAME_ID}:cups`, cups);

  const card = el('div', 'card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', '淹れた結果');
  card.append(el('h2', '', rank.title));
  card.append(el('p', 'lead', tasteComment(ev)));
  card.append(drawCup(ev));

  const sc = el('p', 'score', String(ev.score));
  sc.append(el('small', '', '点'));
  const st = el('span', 'stars', '★'.repeat(rank.stars) + '☆'.repeat(5 - rank.stars));
  st.setAttribute('aria-label', `星${rank.stars}つ`);
  sc.append(st);
  card.append(sc);

  const meters = el('div', 'meters');
  const bar = (label, k) => {
    meters.append(el('span', 'label', label));
    const m = el('div', 'meter');
    m.setAttribute('role', 'img');
    m.setAttribute('aria-label', `${label} ${Math.round(k * 100)}%`);
    const s = el('span');
    s.style.width = `${Math.max(4, k * 100)}%`;
    m.append(s);
    meters.append(m);
  };
  meters.append(el('span', 'label', '味'));
  const taste = el('div', 'taste');
  taste.setAttribute('role', 'img');
  const tpos = clamp(0.5 + (ev.E - 1) * 1.6, 0.03, 0.97);
  taste.setAttribute('aria-label', ev.E < 0.86 ? '酸味より' : ev.E > 1.14 ? '苦味より' : 'ちょうどいい');
  const mk = el('span');
  mk.style.left = `${tpos * 100}%`;
  taste.append(mk);
  meters.append(taste);
  const ends = el('div', 'taste-ends');
  ends.append(el('span', '', '酸味・軽い'), el('span', '', 'ちょうどいい'), el('span', '', '苦味・重い'));
  meters.append(el('span'), ends);
  bar('香り', ev.aroma);
  bar('すっきり', ev.clarity);
  bar('量', ev.amount);
  card.append(meters);

  const dl = el('dl', 'stats');
  const row = (label, value, isNew) => {
    dl.append(el('dt', '', label));
    const dd = el('dd', '', value);
    if (isNew) dd.append(el('span', 'new', '自己ベスト！'));
    dl.append(dd);
  };
  row('点数', `${ev.score} 点`, isBest && prev);
  row('挽き目・粒のそろい', `${grind.name}・${Math.round(ev.even * 100)}%`);
  row('蒸らし', b.bloomWait > 0 ? `${Math.round(b.bloomWait)} 秒（${Math.round(b.bloomAmount)}ml）` : 'なし');
  row('抽出時間', fmtTime(b.elapsed));
  row('できた量', `${Math.round(b.server)} ml`);
  if (b.spilled > 1 || b.bypassMl > 3) row('あふれた / 縁に注いだ', `${Math.round(b.spilled)} / ${Math.round(b.bypassMl)} ml`);
  card.append(dl);

  card.append(el('p', 'tip', tipFor(ev)));

  const actions = el('div', 'actions');
  const menu = el('button', 'btn btn-ghost', '挽き目を変える');
  menu.type = 'button';
  menu.addEventListener('click', showTitle);
  const again = el('button', 'btn btn-primary', 'もう一杯淹れる');
  again.type = 'button';
  again.addEventListener('click', () => startGame(gi));
  actions.append(menu, again);
  card.append(actions);
  showOverlay(card, again);
  announce(`${rank.title}。${ev.score}点。${tasteComment(ev)}`);
}

// 淹れた一杯をカップに注いだ絵（濃さで色が変わる）
function drawCup(ev) {
  const cv = document.createElement('canvas');
  const cw = 320, chh = 170, dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = cw * dpr;
  cv.height = chh * dpr;
  cv.className = 'cup';
  cv.setAttribute('role', 'img');
  cv.setAttribute('aria-label', 'できあがった珈琲のカップ');
  const c = cv.getContext('2d');
  c.scale(dpr, dpr);
  const strength = clamp((SERVER_GOAL / Math.max(60, b.server)) * ev.E, 0.5, 1.6);
  const col = mixColor('#9a6034', '#1e0e06', clamp((strength - 0.5) / 1.0, 0, 1));
  // ソーサー
  c.fillStyle = '#e8e0d4';
  c.beginPath();
  c.ellipse(160, 132, 130, 30, 0, 0, TAU);
  c.fill();
  c.fillStyle = '#d6ccbe';
  c.beginPath();
  c.ellipse(160, 130, 90, 18, 0, 0, TAU);
  c.fill();
  // カップ
  c.fillStyle = '#fbf8f3';
  c.beginPath();
  c.moveTo(80, 60);
  c.quadraticCurveTo(84, 128, 160, 132);
  c.quadraticCurveTo(236, 128, 240, 60);
  c.closePath();
  c.fill();
  c.strokeStyle = '#fbf8f3';
  c.lineWidth = 10;
  c.beginPath();
  c.ellipse(250, 84, 20, 16, 0, -1.3, 1.6);
  c.stroke();
  c.fillStyle = '#efe8de';
  c.beginPath();
  c.ellipse(160, 60, 80, 20, 0, 0, TAU);
  c.fill();
  // 珈琲
  c.fillStyle = col;
  c.beginPath();
  c.ellipse(160, 62, 72, 16, 0, 0, TAU);
  c.fill();
  c.strokeStyle = 'rgba(200,140,80,0.5)';
  c.lineWidth = 2;
  c.beginPath();
  c.ellipse(160, 62, 70, 15, 0, 0, TAU);
  c.stroke();
  c.fillStyle = 'rgba(255,230,200,0.22)';
  c.beginPath();
  c.ellipse(138, 58, 26, 5, -0.1, 0, TAU);
  c.fill();
  // 湯気
  c.strokeStyle = 'rgba(160,140,120,0.35)';
  c.lineWidth = 5;
  c.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    c.beginPath();
    const x0 = 128 + k * 32;
    c.moveTo(x0, 44);
    c.bezierCurveTo(x0 - 12, 30, x0 + 12, 22, x0, 6);
    c.stroke();
  }
  return cv;
}

// ---------------------------------------------------------------- 開始
makeBeans();
resetBrew();
startLoop({ update, render });
if (document.fonts?.ready) document.fonts.ready.then(showTitle);
else showTitle();

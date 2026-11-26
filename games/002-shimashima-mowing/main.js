// 002 しましま草刈り
// 快感の核：「通った跡の草が一気に消えて、しましまの芝生が残っていく」
// 土台：即時フィードバック（刈った瞬間に音・色・破片）＋痕跡（刈った向きで縞模様が残る）
//       ＋小さな完了の連鎖（区画ごとのチャイム）。その上に抵抗→解放、罰のないコンボ、
//       ステージごとの草刈り機の成長（刈り幅が広がる）を積む。
import { setupCanvas } from '../../shared/canvas.js';
import { startLoop } from '../../shared/loop.js';
import { createInput } from '../../shared/input.js';
import { load, save } from '../../shared/storage.js';
import { FONT, announce, onHidden, reducedMotion } from '../../shared/ui.js';

const GAME_ID = '002-shimashima-mowing';
const W = 640;
const HUD = 40;
const CELL = 8;
const COLS = 80;
const ROWS = 48;
const FW = COLS * CELL; // 640
const FH = ROWS * CELL; // 384
const H = HUD + FH;
const RS = 2; // 地面レイヤーの解像度倍率

const canvas = document.getElementById('game');
const { ctx } = setupCanvas(canvas, W, H);
const input = createInput(canvas, { width: W, height: H });
const overlay = document.getElementById('overlay');
const muteBtn = document.getElementById('mute');

const css = getComputedStyle(document.documentElement);
const token = (name) => css.getPropertyValue(name).trim();
const dark = window.matchMedia('(prefers-color-scheme: dark)');
let T = {};
function readTokens() {
  T = {
    panel: token('--panel'), fg: token('--fg'), muted: token('--muted'), border: token('--border'),
    accent: token('--accent'), gold: token('--gold'), bgDeep: token('--bg-deep'),
  };
}
readTokens();
dark.addEventListener?.('change', readTokens);

// ---------------------------------------------------------------- 便利関数
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const approach = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const rand = (a, b) => a + Math.random() * (b - a);
let stageSeed = 1;
function hash(i, k) {
  let x = (Math.imul(i, 374761393) + Math.imul(k, 668265263) + Math.imul(stageSeed, 2246822519)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------- 音
let ac = null;
let master = null;
let noiseBuf = null;
let engine = null;
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

  noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.25, ac.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  // エンジン音：のこぎり波＋矩形波を低域通過フィルターで丸めた「ブロロロ」
  const o1 = ac.createOscillator();
  const o2 = ac.createOscillator();
  const f = ac.createBiquadFilter();
  const g = ac.createGain();
  o1.type = 'sawtooth';
  o2.type = 'square';
  o1.frequency.value = 55;
  o2.frequency.value = 111;
  f.type = 'lowpass';
  f.frequency.value = 420;
  g.gain.value = 0;
  const g2 = ac.createGain();
  g2.gain.value = 0.35;
  o1.connect(f);
  o2.connect(g2).connect(f);
  f.connect(g).connect(master);
  o1.start();
  o2.start();
  engine = { o1, o2, f, g };
}

function tone(freq, dur, type = 'sine', vol = 0.12, when = 0) {
  if (!ac) return;
  const t = ac.currentTime + when;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// 刈る音：ノイズを帯域通過させた「シャッ」。ピッチと音量を毎回ゆらす
function snip(n, tall) {
  if (!ac) return;
  const t = ac.currentTime;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = rand(0.85, 1.15);
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = (tall ? 2000 : 3200) * rand(0.85, 1.15);
  bp.Q.value = 1.1;
  const g = ac.createGain();
  const vol = Math.min(0.16, 0.035 + n * 0.006);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (tall ? 0.09 : 0.06));
  src.connect(bp).connect(g).connect(master);
  src.start(t, Math.random() * 0.15);
  src.stop(t + 0.1);
}

const PENTA = [0, 2, 4, 7, 9];
const noteFreq = (step, base = 523.25) => base * 2 ** ((PENTA[step % 5] + 12 * Math.floor(step / 5)) / 12);

const sfx = {
  ding() {
    tone(392, 0.14, 'triangle', 0.1);
    tone(1568, 0.22, 'sine', 0.16, 0.01);
    tone(2093, 0.5, 'sine', 0.11, 0.07);
  },
  combo(level) {
    tone(noteFreq(level + 2), 0.16, 'triangle', 0.11);
    tone(noteFreq(level + 4), 0.2, 'sine', 0.06, 0.05);
  },
  clear() {
    [0, 2, 4, 5, 7, 10].forEach((s, i) => tone(noteFreq(s, 392), 0.28, 'triangle', 0.13, i * 0.085));
    tone(130.8, 0.6, 'sine', 0.14, 0.0);
    tone(noteFreq(10, 392) * 2, 0.9, 'sine', 0.08, 0.55);
  },
  bump() {
    tone(95, 0.12, 'square', 0.05);
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

// ---------------------------------------------------------------- ステージ
// type: 0 = 通れる地面（草なし）, 1 = 草, 2 = 通れない
// deco: 地面の見た目
const D = { GRASS: 0, PATH: 1, BED: 2, POND: 3, TRUNK: 4, ROOF: 5, WALL: 6, HEDGE: 7, ROCK: 8 };

const MOWERS = [
  { name: '手押し芝刈り機', kind: 'push', r: 13, speed: 112, color: '#e03e2d' },
  { name: 'エンジン芝刈り機', kind: 'push', r: 16, speed: 124, color: '#f08c00' },
  { name: '乗用芝刈り機', kind: 'ride', r: 22, speed: 138, color: '#d9342b' },
  { name: 'トラクター草刈り機', kind: 'ride', r: 31, speed: 148, color: '#f2b705' },
];

const STAGES = [
  {
    name: 'うらにわ', sub: 'まずは小さな庭から', mower: 0, zones: [2, 2], tall: false,
    build(g) {
      g.fill(D.HEDGE, 2, 0, 0, COLS, ROWS);
      g.fill(D.ROOF, 2, 10, 0, 60, 4);
      g.fill(D.WALL, 2, 10, 4, 60, 2);
      g.grass(12, 6, 56, 37);
      g.fill(D.PATH, 0, 12, 43, 56, 2);
    },
    rect: [12, 6, 56, 37],
  },
  {
    name: 'まえにわ', sub: '花壇をよけて刈ろう', mower: 1, zones: [3, 2], tall: false,
    build(g) {
      g.fill(D.HEDGE, 2, 0, 0, COLS, ROWS);
      g.grass(3, 3, 74, 42);
      g.fill(D.PATH, 0, 38, 3, 4, 42);
      g.fill(D.BED, 2, 9, 8, 12, 6);
      g.fill(D.BED, 2, 58, 31, 13, 7);
      g.fill(D.BED, 2, 56, 8, 4, 4);
    },
    rect: [3, 3, 74, 42],
  },
  {
    name: 'こうえん', sub: '乗用の草刈り機で広い芝生へ', mower: 2, zones: [4, 3], tall: false,
    trees: [[15, 11], [64, 10], [22, 37], [60, 36], [38, 8]],
    pond: [41, 26, 9.5, 6.5],
    build(g, st) {
      g.fill(D.HEDGE, 2, 0, 0, COLS, ROWS);
      g.grass(1, 1, 78, 46);
      const [px, py, rx, ry] = st.pond;
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const dx = (c + 0.5 - px) / rx, dy = (r + 0.5 - py) / ry;
          if (dx * dx + dy * dy < 1) g.set(c, r, D.POND, 2);
        }
      for (const [tc, tr] of st.trees) g.fill(D.TRUNK, 2, tc - 1, tr - 1, 2, 2);
    },
    rect: [1, 1, 78, 46],
  },
  {
    name: 'あきち', sub: '伸び放題の空き地を一気に', mower: 3, zones: [4, 3], tall: true,
    rocks: [[12, 9], [30, 33], [52, 14], [67, 37], [44, 40], [20, 22], [70, 8]],
    build(g, st) {
      g.fill(D.HEDGE, 2, 0, 0, COLS, ROWS);
      g.grass(1, 1, 78, 46);
      for (const [rc, rr] of st.rocks) g.fill(D.ROCK, 2, rc - 1, rr - 1, 3, 3);
    },
    rect: [1, 1, 78, 46],
  },
];

// ---------------------------------------------------------------- フィールド
const N = COLS * ROWS;
const type = new Uint8Array(N);
const deco = new Uint8Array(N);
const cut = new Uint8Array(N); // 0 = 未刈り, 1..4 = 刈った向き
const zoneOf = new Int8Array(N);
let zones = [];
let stage = null;
let stageIndex = 0;
let mowerDef = MOWERS[0];

const G = document.createElement('canvas');
G.width = FW * RS;
G.height = FH * RS;
const gctx = G.getContext('2d');
gctx.scale(RS, RS);
const beforeImg = document.createElement('canvas');
beforeImg.width = FW;
beforeImg.height = FH;

function buildStage(i) {
  stageIndex = i;
  stage = STAGES[i];
  mowerDef = MOWERS[stage.mower];
  stageSeed = 17 + i * 31;
  type.fill(0);
  deco.fill(D.PATH);
  cut.fill(0);
  zoneOf.fill(-1);
  const g = {
    set(c, r, d, t) {
      if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
      const k = r * COLS + c;
      deco[k] = d;
      type[k] = t;
    },
    fill(d, t, c0, r0, w, h) {
      for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) this.set(c, r, d, t);
    },
    grass(c0, r0, w, h) {
      this.fill(D.GRASS, 1, c0, r0, w, h);
    },
  };
  stage.build(g, stage);

  // 区画（小さな完了の単位）
  const [rc, rr, rw, rh] = stage.rect;
  const [zc, zr] = stage.zones;
  zones = [];
  for (let y = 0; y < zr; y++)
    for (let x = 0; x < zc; x++) {
      const c0 = rc + Math.round((rw * x) / zc), c1 = rc + Math.round((rw * (x + 1)) / zc);
      const r0 = rr + Math.round((rh * y) / zr), r1 = rr + Math.round((rh * (y + 1)) / zr);
      zones.push({ c0, c1, r0, r1, total: 0, cut: 0, done: false, sweeping: false, flash: 0 });
    }
  zones.forEach((z, zi) => {
    for (let r = z.r0; r < z.r1; r++)
      for (let c = z.c0; c < z.c1; c++) {
        const k = r * COLS + c;
        if (type[k] === 1) {
          zoneOf[k] = zi;
          z.total++;
        }
      }
  });
  zones = zones.filter((z) => z.total > 0);
  // filter で番号がずれるので振り直す
  zoneOf.fill(-1);
  zones.forEach((z, zi) => {
    for (let r = z.r0; r < z.r1; r++)
      for (let c = z.c0; c < z.c1; c++) if (type[r * COLS + c] === 1) zoneOf[r * COLS + c] = zi;
  });

  drawWholeGround();
  const bctx = beforeImg.getContext('2d');
  bctx.clearRect(0, 0, FW, FH);
  bctx.drawImage(G, 0, 0, FW, FH);
}

// ---------------------------------------------------------------- 地面の描画（差分更新）
const UNCUT = ['#2c6526', '#2f6b29'];
const UNCUT_TALL = ['#2a5420', '#2e5a22'];
const BLADE = ['#3c8a30', '#468f35', '#3a7f2d', '#52a03c'];
const BLADE_TALL = ['#4a8a2e', '#5b9636', '#3f7a2a', '#6f9e3a', '#7d8f3a'];
// 刈った向きで色を変える（本物の芝生の縞と同じ発想）。明暗差は大きめに
const SHADE = [null, '#b9e47e', '#8ec756', '#a8dc6e', '#7dbb47'];

function drawBase(c, r) {
  const k = r * COLS + c;
  const x = c * CELL, y = r * CELL;
  const h = hash(k, 1);
  switch (deco[k]) {
    case D.GRASS: {
      if (cut[k]) {
        const s = cut[k];
        gctx.fillStyle = SHADE[s];
        gctx.fillRect(x, y, CELL, CELL);
        gctx.fillStyle = s % 2 ? 'rgba(255,255,255,0.10)' : 'rgba(20,60,10,0.10)';
        if (s <= 2) gctx.fillRect(x, y + ((h * 6) | 0), CELL, 1);
        else gctx.fillRect(x + ((h * 6) | 0), y, 1, CELL);
        gctx.fillStyle = 'rgba(40,90,20,0.18)';
        gctx.fillRect(x + ((hash(k, 2) * 7) | 0), y + ((hash(k, 3) * 7) | 0), 1, 1);
      } else {
        const pal = stage.tall ? UNCUT_TALL : UNCUT;
        gctx.fillStyle = pal[h < 0.5 ? 0 : 1];
        gctx.fillRect(x, y, CELL, CELL);
      }
      break;
    }
    case D.PATH:
      gctx.fillStyle = '#d8ccb2';
      gctx.fillRect(x, y, CELL, CELL);
      gctx.fillStyle = '#c4b597';
      if (h < 0.5) gctx.fillRect(x + ((h * 12) | 0), y + ((hash(k, 2) * 6) | 0), 2, 1);
      if (((c >> 1) + (r >> 1) * 3) % 4 === 0) {
        gctx.fillStyle = '#ebe2cf';
        gctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      }
      break;
    case D.BED:
      gctx.fillStyle = '#7a5236';
      gctx.fillRect(x, y, CELL, CELL);
      if (h < 0.55) {
        gctx.fillStyle = '#3f8a30';
        gctx.fillRect(x + 2, y + 3, 4, 3);
        gctx.fillStyle = ['#ff7eb6', '#ffd43b', '#ffffff', '#ff8a4c'][(hash(k, 4) * 4) | 0];
        gctx.beginPath();
        gctx.arc(x + 4, y + 3, 2, 0, Math.PI * 2);
        gctx.fill();
      }
      break;
    case D.POND: {
      gctx.fillStyle = '#4aa3df';
      gctx.fillRect(x, y, CELL, CELL);
      if (h < 0.18) {
        gctx.fillStyle = 'rgba(255,255,255,0.45)';
        gctx.fillRect(x + 1, y + 3, 4, 1);
      }
      gctx.fillStyle = '#9c9184';
      const edge = (cc, rr) => cc < 0 || rr < 0 || cc >= COLS || rr >= ROWS || deco[rr * COLS + cc] !== D.POND;
      if (edge(c, r - 1)) gctx.fillRect(x, y, CELL, 2);
      if (edge(c, r + 1)) gctx.fillRect(x, y + CELL - 2, CELL, 2);
      if (edge(c - 1, r)) gctx.fillRect(x, y, 2, CELL);
      if (edge(c + 1, r)) gctx.fillRect(x + CELL - 2, y, 2, CELL);
      break;
    }
    case D.TRUNK:
      gctx.fillStyle = '#6b4a2b';
      gctx.fillRect(x, y, CELL, CELL);
      break;
    case D.ROCK:
      gctx.fillStyle = '#6f6a5e';
      gctx.fillRect(x, y, CELL, CELL);
      break;
    case D.ROOF:
      gctx.fillStyle = r % 2 ? '#b5523b' : '#a8483a';
      gctx.fillRect(x, y, CELL, CELL);
      gctx.fillStyle = 'rgba(0,0,0,0.15)';
      gctx.fillRect(x + (r % 2 ? 0 : 4), y, 1, CELL);
      break;
    case D.WALL:
      gctx.fillStyle = '#efe3cf';
      gctx.fillRect(x, y, CELL, CELL);
      gctx.fillStyle = '#d8c8ae';
      gctx.fillRect(x, y + CELL - 1, CELL, 1);
      if (c % 12 === 4 || c % 12 === 5) {
        gctx.fillStyle = '#7fb6d9';
        gctx.fillRect(x, y + (r === 4 ? 2 : 0), CELL, CELL - 2);
      }
      break;
    case D.HEDGE:
    default:
      gctx.fillStyle = '#285222';
      gctx.fillRect(x, y, CELL, CELL);
      gctx.fillStyle = h < 0.5 ? '#336a2b' : '#2e5f27';
      gctx.beginPath();
      gctx.arc(x + 2 + h * 4, y + 2 + hash(k, 2) * 4, 3, 0, Math.PI * 2);
      gctx.fill();
      break;
  }
}

function drawBlades(c, r) {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
  const k = r * COLS + c;
  if (type[k] !== 1 || cut[k]) return;
  const x = c * CELL, y = r * CELL;
  const tall = stage.tall;
  const n = tall ? 4 : 3;
  const pal = tall ? BLADE_TALL : BLADE;
  gctx.lineCap = 'round';
  for (let j = 0; j < n; j++) {
    const bx = x + 1 + hash(k, 10 + j) * 6;
    const by = y + CELL - hash(k, 20 + j) * 2;
    const bh = tall ? 9 + hash(k, 30 + j) * 6 : 5 + hash(k, 30 + j) * 4;
    const lean = (hash(k, 40 + j) - 0.5) * 3;
    gctx.strokeStyle = pal[(hash(k, 50 + j) * pal.length) | 0];
    gctx.lineWidth = tall ? 1.7 : 1.5;
    gctx.beginPath();
    gctx.moveTo(bx, by);
    gctx.quadraticCurveTo(bx, by - bh * 0.6, bx + lean, by - bh);
    gctx.stroke();
  }
  if (tall && hash(k, 60) < 0.06) {
    gctx.fillStyle = hash(k, 61) < 0.5 ? '#ffd43b' : '#f5f5e8';
    gctx.beginPath();
    gctx.arc(x + 4, y - 4, 1.8, 0, Math.PI * 2);
    gctx.fill();
  }
}

function drawWholeGround() {
  gctx.clearRect(0, 0, FW, FH);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) drawBase(c, r);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) drawBlades(c, r);
}

// 1マスだけ描き直す。上下左右のマスから伸びた葉の重なりも描き直す
function redrawCell(c, r) {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
  const x = c * CELL, y = r * CELL;
  gctx.save();
  gctx.beginPath();
  gctx.rect(x, y, CELL, CELL);
  gctx.clip();
  drawBase(c, r);
  for (let rr = r; rr <= r + 2; rr++) for (let cc = c - 1; cc <= c + 1; cc++) drawBlades(cc, rr);
  gctx.restore();
}

// 刈った草の切れ端を地面に焼き付ける（残留物：自分の仕事の跡）
function stampClipping(x, y, col) {
  gctx.globalAlpha = 0.55;
  gctx.fillStyle = col;
  gctx.fillRect(x - 1, y - 0.5, 2, 1);
  gctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- 状態
let state = 'title'; // title | play | clearing | result
let paused = false;
const mower = { x: 0, y: 0, vx: 0, vy: 0, a: 0, sx: 1, sy: 1, blade: 0, load: 0, bumpCd: 0 };
let time = 0;
let started = false;
let totalGrass = 0;
let totalCut = 0;
let shownPct = 0;
let freeze = 0;
let trauma = 0;
let flash = 0;
let clearT = 0;
const combo = { cells: 0, idle: 9, level: 0, best: 0 };
const parts = [];
const floaters = [];
const sweepQ = [];
let snipAcc = 0;
let snipCd = 0;
let lastZone = -1;

function startStage(i) {
  buildStage(i);
  const [rc, rr, rw, rh] = stage.rect;
  // スタート位置：区画の左下あたりの、通れる場所
  mower.x = (rc + 3) * CELL;
  mower.y = (rr + rh - 3) * CELL;
  if (i === 2 || i === 3) {
    mower.x = 6 * CELL;
    mower.y = (ROWS - 5) * CELL;
  }
  if (i === 0) mower.y = (rr + rh) * CELL + 4; // 小道から入る
  mower.vx = mower.vy = 0;
  mower.a = -Math.PI / 2;
  mower.sx = mower.sy = 1;
  mower.load = 0;
  totalGrass = zones.reduce((s, z) => s + z.total, 0);
  totalCut = 0;
  shownPct = 0;
  time = 0;
  started = false;
  freeze = trauma = flash = clearT = 0;
  combo.cells = 0; combo.idle = 9; combo.level = 0; combo.best = 0;
  parts.length = floaters.length = sweepQ.length = 0;
  paused = false;
  state = 'play';
  hideOverlay();
  canvas.focus();
  initAudio();
  sfx.start();
  announce(`${stage.name}。${mowerDef.name}で草を刈ろう`);
  floaters.push({ text: stage.name, sub: mowerDef.name, x: W / 2, y: HUD + FH / 2, t: 0, life: 1.8, big: true });
}

// ---------------------------------------------------------------- 草を刈る
function cellRect(k) {
  return [(k % COLS) * CELL, ((k / COLS) | 0) * CELL];
}

function cutCell(k, shade, sparkle = false) {
  if (type[k] !== 1 || cut[k]) return false;
  cut[k] = shade;
  const c = k % COLS, r = (k / COLS) | 0;
  redrawCell(c, r);
  redrawCell(c, r - 1);
  if (r - 2 >= 0 && stage.tall) redrawCell(c, r - 2);
  totalCut++;
  const zi = zoneOf[k];
  if (zi >= 0) {
    const z = zones[zi];
    z.cut++;
    if (!z.done && z.cut >= z.total) zoneComplete(zi);
    else if (!z.sweeping && z.cut / z.total >= 0.97) startSweep(zi);
  }
  if (sparkle) {
    const [x, y] = cellRect(k);
    parts.push({ x: x + 4, y: y + 4, vx: rand(-30, 30), vy: rand(-60, -20), life: 0.45, max: 0.45, col: '#fff6c2', size: 2, fly: true, spark: true });
  }
  return true;
}

// 区画が 97% になったら、残りの取りこぼしを波紋のように一掃して 100% にする
// （ピクセル探しのストレスを消し、「完了の瞬間」だけを残す）
function startSweep(zi) {
  const z = zones[zi];
  z.sweeping = true;
  for (let r = z.r0; r < z.r1; r++)
    for (let c = z.c0; c < z.c1; c++) {
      const k = r * COLS + c;
      if (type[k] === 1 && !cut[k]) {
        const d = Math.hypot(c * CELL + 4 - mower.x, r * CELL + 4 - mower.y);
        sweepQ.push({ k, t: 0.05 + d / 900 });
      }
    }
}

function neighborShade(k) {
  const c = k % COLS;
  const cand = [k - 1, k + 1, k - COLS, k + COLS];
  for (const n of cand) {
    if (n < 0 || n >= N) continue;
    if (Math.abs((n % COLS) - c) > 1) continue;
    if (cut[n]) return cut[n];
  }
  return 1;
}

function zoneComplete(zi) {
  const z = zones[zi];
  z.done = true;
  z.flash = 1;
  const doneCount = zones.filter((q) => q.done).length;
  const cx = ((z.c0 + z.c1) / 2) * CELL, cy = ((z.r0 + z.r1) / 2) * CELL;
  if (doneCount === zones.length) {
    stageClear();
    return;
  }
  sfx.ding();
  freeze = Math.max(freeze, 0.07);
  addTrauma(0.22);
  floaters.push({ text: '区画クリア！', sub: `${doneCount} / ${zones.length}`, x: cx, y: HUD + cy, t: 0, life: 1.3 });
  for (let i = 0; i < 26; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(60, 170);
    parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6, max: 0.6, col: i % 2 ? '#ffe066' : '#ffffff', size: 3, fly: true, spark: true });
  }
  announce(`区画クリア ${doneCount} / ${zones.length}`);
}

function stageClear() {
  state = 'clearing';
  clearT = 0;
  sfx.clear();
  freeze = 0.2;
  flash = reducedMotion() ? 0.3 : 0.8;
  addTrauma(0.5);
  for (const z of zones) z.flash = 1;
  for (let i = 0; i < 140; i++) {
    parts.push({
      x: rand(0, FW), y: rand(-40, 0), vx: rand(-40, 40), vy: rand(60, 200), life: rand(1.2, 2.2), max: 2.2,
      col: ['#ff6b6b', '#ffd43b', '#69db7c', '#4dabf7', '#ffffff', '#ff922b'][i % 6], size: 4, fly: true, confetti: true, rot: rand(0, 6),
    });
  }
  combo.best = Math.max(combo.best, combo.cells);
}

function tryCut(dt) {
  const r = mower.blade;
  const speed = Math.hypot(mower.vx, mower.vy);
  // 刈った向き：主に動いている軸と符号で4種類
  let ax = mower.vx, ay = mower.vy;
  if (speed < 8) { ax = Math.cos(mower.a); ay = Math.sin(mower.a); }
  const shade = Math.abs(ax) >= Math.abs(ay) ? (ax >= 0 ? 1 : 2) : (ay >= 0 ? 4 : 3);
  const c0 = Math.max(0, Math.floor((mower.x - r) / CELL)), c1 = Math.min(COLS - 1, Math.floor((mower.x + r) / CELL));
  const r0 = Math.max(0, Math.floor((mower.y - r) / CELL)), r1 = Math.min(ROWS - 1, Math.floor((mower.y + r) / CELL));
  let n = 0;
  const side = mower.a + Math.PI / 2; // 右側の排出口から飛ばす
  const pal = stage.tall ? BLADE_TALL : BLADE;
  for (let rr = r0; rr <= r1; rr++)
    for (let cc = c0; cc <= c1; cc++) {
      const k = rr * COLS + cc;
      if (type[k] !== 1 || cut[k]) continue;
      // マスと円が少しでも重なれば刈る
      const nx = clamp(mower.x, cc * CELL, cc * CELL + CELL), ny = clamp(mower.y, rr * CELL, rr * CELL + CELL);
      if ((nx - mower.x) ** 2 + (ny - mower.y) ** 2 > r * r) continue;
      if (cutCell(k, shade)) {
        n++;
        if (parts.length < 700) {
          const a = side + rand(-0.6, 0.6) + Math.PI * 0.15, sp = rand(70, 170) * (stage.tall ? 1.2 : 1);
          const ex = mower.x + Math.cos(side) * r * 0.7, ey = mower.y + Math.sin(side) * r * 0.7;
          parts.push({ x: ex, y: ey, vx: Math.cos(a) * sp + mower.vx * 0.5, vy: Math.sin(a) * sp + mower.vy * 0.5, life: rand(0.25, 0.5), max: 0.5, col: pal[(Math.random() * pal.length) | 0], size: stage.tall ? 3 : 2, fly: true, stamp: true, rot: rand(0, 6), vr: rand(-15, 15) });
        }
      }
    }
  return n;
}

// ---------------------------------------------------------------- 当たり判定
function solidAt(c, r) {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return true;
  return type[r * COLS + c] === 2;
}
function collides(x, y, rad) {
  const c0 = Math.floor((x - rad) / CELL), c1 = Math.floor((x + rad) / CELL);
  const r0 = Math.floor((y - rad) / CELL), r1 = Math.floor((y + rad) / CELL);
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      if (!solidAt(c, r)) continue;
      const nx = clamp(x, c * CELL, c * CELL + CELL), ny = clamp(y, r * CELL, r * CELL + CELL);
      if ((nx - x) ** 2 + (ny - y) ** 2 < rad * rad) return true;
    }
  return false;
}

// ---------------------------------------------------------------- 演出
function addTrauma(v) {
  if (reducedMotion()) return;
  trauma = Math.min(1, trauma + v);
}

// ---------------------------------------------------------------- 更新
const KEYS = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
};
const anyDown = (list) => list.some((k) => input.isDown(k));

function togglePause(v = !paused) {
  if (state !== 'play') return;
  paused = v;
  announce(paused ? '一時停止中' : '再開');
}
onHidden(() => togglePause(true));

function update(dt) {
  if (input.wasPressed('KeyM')) {
    initAudio();
    setMuted(!muted);
  }
  if (input.wasPressed('KeyP') || input.wasPressed('Escape')) togglePause();
  if (paused && (input.pointer.down || input.wasPressed('Space'))) togglePause(false);

  updateEngine(dt);
  if (state === 'title' || state === 'result' || paused) {
    updateFx(dt * (state === 'play' ? 0 : 1));
    input.endFrame();
    return;
  }

  flash = Math.max(0, flash - dt * 2.5);
  for (const z of zones) z.flash = Math.max(0, z.flash - dt * 1.6);
  if (freeze > 0) {
    freeze -= dt;
    input.endFrame();
    return;
  }

  if (state === 'clearing') {
    clearT += dt;
    mower.vx = approach(mower.vx, 0, 6, dt);
    mower.vy = approach(mower.vy, 0, 6, dt);
    updateFx(dt);
    if (clearT > 1.6) showResult();
    input.endFrame();
    return;
  }

  // --- 入力 → 目標速度
  const def = mowerDef;
  mower.blade = def.r * (1 + combo.level * 0.03);
  const boost = 1 + combo.level * 0.05;
  const resist = 1 - mower.load * (stage.tall ? 0.28 : 0.2);
  const maxSp = def.speed * boost * resist;
  let tx = 0, ty = 0;
  let kx = (anyDown(KEYS.right) ? 1 : 0) - (anyDown(KEYS.left) ? 1 : 0);
  let ky = (anyDown(KEYS.down) ? 1 : 0) - (anyDown(KEYS.up) ? 1 : 0);
  if (kx || ky) {
    const l = Math.hypot(kx, ky);
    tx = (kx / l) * maxSp;
    ty = (ky / l) * maxSp;
  } else if (input.pointer.down) {
    const px = input.pointer.x, py = input.pointer.y - HUD;
    const dx = px - mower.x, dy = py - mower.y;
    const d = Math.hypot(dx, dy);
    if (d > 4) {
      const s = maxSp * Math.min(1, d / 36);
      tx = (dx / d) * s;
      ty = (dy / d) * s;
    }
  }
  if ((tx || ty) && !started) started = true;
  mower.vx = approach(mower.vx, tx, 9, dt);
  mower.vy = approach(mower.vy, ty, 9, dt);
  const speed = Math.hypot(mower.vx, mower.vy);
  if (speed > 12) {
    const target = Math.atan2(mower.vy, mower.vx);
    let diff = target - mower.a;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    mower.a += diff * (1 - Math.exp(-11 * dt));
  }

  // --- 移動（軸ごとに当たり判定）
  const body = def.r * 0.78;
  let bumped = false;
  const nx = mower.x + mower.vx * dt;
  if (!collides(nx, mower.y, body)) mower.x = nx;
  else { bumped = Math.abs(mower.vx) > 40; mower.vx *= -0.2; }
  const ny = mower.y + mower.vy * dt;
  if (!collides(mower.x, ny, body)) mower.y = ny;
  else { bumped = bumped || Math.abs(mower.vy) > 40; mower.vy *= -0.2; }
  mower.bumpCd -= dt;
  if (bumped && mower.bumpCd <= 0) {
    mower.bumpCd = 0.25;
    sfx.bump();
    addTrauma(0.08);
    mower.sx = 0.86; mower.sy = 1.12;
  }
  mower.sx = approach(mower.sx, 1, 14, dt);
  mower.sy = approach(mower.sy, 1, 14, dt);

  if (started) time += dt;

  // --- 刈る
  const n = tryCut(dt);
  mower.load = approach(mower.load, n > 0 ? 1 : 0, n > 0 ? 10 : 5, dt);
  snipAcc += n;
  snipCd -= dt;
  if (snipAcc > 0 && snipCd <= 0) {
    snip(snipAcc, stage.tall);
    snipAcc = 0;
    snipCd = 0.045;
  }

  // --- 罰のないコンボ：刈り続けるとスピードと刈り幅が少し上がる。止まって1秒で静かに戻るだけ
  if (n > 0) {
    combo.idle = 0;
    combo.cells += n;
    const lv = Math.min(5, Math.floor(combo.cells / Math.round(mowerDef.r * 5)));
    if (lv > combo.level) {
      combo.level = lv;
      sfx.combo(lv);
      floaters.push({ text: `コンボ Lv${lv}`, sub: 'スピードアップ', x: mower.x, y: HUD + mower.y - 30, t: 0, life: 0.9, small: true });
    }
  } else {
    combo.idle += dt;
    if (combo.idle > 1.0 && combo.cells > 0) {
      combo.best = Math.max(combo.best, combo.cells);
      combo.cells = 0;
      combo.level = 0;
    }
  }

  // --- 取りこぼしの一掃
  for (let i = sweepQ.length - 1; i >= 0; i--) {
    const s = sweepQ[i];
    s.t -= dt;
    if (s.t <= 0) {
      sweepQ.splice(i, 1);
      cutCell(s.k, neighborShade(s.k), true);
      snipAcc += 1;
      if (state !== 'play') break;
    }
  }

  // 今いる区画
  const mk = Math.floor(mower.y / CELL) * COLS + Math.floor(mower.x / CELL);
  const z = zoneOf[mk] ?? -1;
  if (z >= 0) lastZone = z;

  // エンジンの排気
  if (Math.random() < dt * 6) {
    const back = mower.a + Math.PI;
    const d = def.kind === 'ride' ? def.r * 1.4 : def.r * 0.6;
    parts.push({ x: mower.x + Math.cos(back) * d, y: mower.y + Math.sin(back) * d, vx: rand(-8, 8), vy: rand(-25, -10), life: 0.7, max: 0.7, col: 'rgba(240,240,240,0.5)', size: 3, fly: true, smoke: true });
  }

  updateFx(dt);
  input.endFrame();
}

function updateFx(dt) {
  trauma = Math.max(0, trauma - dt * 1.6);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.rot !== undefined) p.rot += (p.vr || 4) * dt;
    if (p.confetti) {
      p.vx += Math.sin(p.life * 6 + i) * 30 * dt;
    } else if (p.smoke) {
      p.size += dt * 6;
    } else {
      p.vx *= 1 - 5 * dt;
      p.vy *= 1 - 5 * dt;
    }
    if (p.life <= 0) {
      if (p.stamp && p.x > 0 && p.y > 0 && p.x < FW && p.y < FH) stampClipping(p.x, p.y, p.col);
      parts.splice(i, 1);
    }
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    floaters[i].t += dt;
    if (floaters[i].t > floaters[i].life) floaters.splice(i, 1);
  }
  shownPct = approach(shownPct, totalGrass ? totalCut / totalGrass : 0, 10, dt);
}

function updateEngine() {
  if (!engine) return;
  const t = ac.currentTime;
  const playing = (state === 'play' || state === 'clearing') && !paused;
  const def = mowerDef;
  const sp = clamp(Math.hypot(mower.vx, mower.vy) / def.speed, 0, 1.4);
  const base = def.kind === 'ride' ? 44 : 58;
  const f = base + sp * 30 - mower.load * 9 + combo.level * 2.5;
  engine.o1.frequency.setTargetAtTime(f, t, 0.08);
  engine.o2.frequency.setTargetAtTime(f * 2.01, t, 0.08);
  engine.f.frequency.setTargetAtTime(320 + sp * 280 + mower.load * 120, t, 0.1);
  engine.g.gain.setTargetAtTime(playing ? 0.025 + sp * 0.03 : 0, t, 0.12);
}

// ---------------------------------------------------------------- 描画
function render() {
  ctx.save();
  ctx.fillStyle = '#285222';
  ctx.fillRect(0, 0, W, H);

  // 画面シェイク（trauma²）
  const s = trauma * trauma;
  if (s > 0) ctx.translate((Math.random() * 2 - 1) * 7 * s, (Math.random() * 2 - 1) * 7 * s);

  ctx.save();
  ctx.translate(0, HUD);
  ctx.drawImage(G, 0, 0, FW, FH);

  // 区画の境目：今いる区画をうっすら、完了した区画は一瞬光らせる
  if (state === 'play' || state === 'clearing') {
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      const x = z.c0 * CELL, y = z.r0 * CELL, w = (z.c1 - z.c0) * CELL, h = (z.r1 - z.r0) * CELL;
      if (z.flash > 0) {
        ctx.fillStyle = `rgba(255,255,220,${z.flash * 0.35})`;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = `rgba(255,224,102,${z.flash})`;
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      } else if (i === lastZone && !z.done) {
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
        ctx.setLineDash([]);
      }
    }
  }

  drawRocks();
  // 飛んでいる破片（地面に着いたら地面レイヤーに焼き付く）
  for (const p of parts) {
    if (p.confetti || p.spark || p.smoke) continue;
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.col;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot || 0);
    ctx.fillRect(-p.size / 2, -0.75, p.size, 1.5);
    ctx.restore();
  }
  if (state !== 'title') drawMower();
  for (const p of parts) {
    if (!p.smoke) continue;
    ctx.globalAlpha = Math.max(0, p.life / p.max) * 0.6;
    ctx.fillStyle = p.col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  drawTrees();
  for (const p of parts) {
    if (!p.spark && !p.confetti) continue;
    ctx.globalAlpha = clamp(p.life / (p.max * 0.5), 0, 1);
    ctx.fillStyle = p.col;
    if (p.confetti) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    } else {
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  drawFloaters();
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,240,${flash * 0.55})`;
    ctx.fillRect(0, HUD, W, FH);
  }
  if (state === 'clearing') drawClearBanner();
  ctx.restore();

  drawHud();
  if (paused) drawPause();
}

function drawRocks() {
  if (!stage?.rocks) return;
  for (const [rc, rr] of stage.rocks) {
    const x = (rc + 0.5) * CELL, y = (rr + 0.5) * CELL;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 4, 13, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9a958a';
    ctx.beginPath();
    ctx.ellipse(x, y, 13, 11, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#b9b4a8';
    ctx.beginPath();
    ctx.ellipse(x - 3, y - 4, 6, 4, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTrees() {
  if (!stage?.trees) return;
  for (const [tc, tr] of stage.trees) {
    const x = tc * CELL, y = tr * CELL;
    const near = Math.hypot(mower.x - x, mower.y - y) < 40;
    ctx.globalAlpha = near ? 0.45 : 0.95;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.arc(x + 6, y + 8, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2f7a32';
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3e9640';
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + tc;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 13, y + Math.sin(a) * 13 - 3, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#5bb055';
    ctx.beginPath();
    ctx.arc(x - 8, y - 10, 8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
}

function drawMower() {
  const def = mowerDef;
  const r = def.r;
  const jit = state === 'play' ? mower.load * 0.7 : 0;
  ctx.save();
  ctx.translate(mower.x + rand(-jit, jit), mower.y + rand(-jit, jit));
  ctx.rotate(mower.a);
  ctx.scale(mower.sx, mower.sy);
  // 影
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(-r * (def.kind === 'ride' ? 0.4 : 0.3) + 2, 3, r * (def.kind === 'ride' ? 1.7 : 1.5), r * 1.05, 0, 0, Math.PI * 2);
  ctx.fill();

  if (def.kind === 'push') {
    // ハンドル
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, -r * 0.6);
    ctx.lineTo(-r * 1.9, -r * 0.55);
    ctx.moveTo(-r * 0.6, r * 0.6);
    ctx.lineTo(-r * 1.9, r * 0.55);
    ctx.moveTo(-r * 1.9, -r * 0.7);
    ctx.lineTo(-r * 1.9, r * 0.7);
    ctx.stroke();
  }
  // デッキ（刃のカバー）
  const deckX = def.kind === 'ride' ? -r * 0.1 : -r * 0.95;
  const deckW = def.kind === 'ride' ? r * 1.15 : r * 1.95;
  // タイヤ
  ctx.fillStyle = '#222';
  const wheel = (wx, wy, ww, wh) => { roundRect(wx - ww / 2, wy - wh / 2, ww, wh, 2); ctx.fill(); };
  if (def.kind === 'push') {
    wheel(-r * 0.7, -r * 0.98, r * 0.5, r * 0.22);
    wheel(-r * 0.7, r * 0.98, r * 0.5, r * 0.22);
    wheel(r * 0.7, -r * 0.98, r * 0.5, r * 0.22);
    wheel(r * 0.7, r * 0.98, r * 0.5, r * 0.22);
  } else {
    wheel(-r * 1.25, -r * 0.82, r * 0.7, r * 0.32);
    wheel(-r * 1.25, r * 0.82, r * 0.7, r * 0.32);
    wheel(r * 0.05, -r * 0.62, r * 0.4, r * 0.2);
    wheel(r * 0.05, r * 0.62, r * 0.4, r * 0.2);
  }
  ctx.fillStyle = def.kind === 'ride' ? '#3b3b3b' : def.color;
  roundRect(deckX, -r, deckW, r * 2, r * 0.45);
  ctx.fill();
  if (def.kind === 'push') {
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    roundRect(deckX + 2, -r + 2, deckW - 4, r * 0.55, r * 0.3);
    ctx.fill();
    // エンジン
    ctx.fillStyle = '#2b2b2b';
    ctx.beginPath();
    ctx.arc(-r * 0.05, 0, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.arc(-r * 0.05, 0, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 車体
    ctx.fillStyle = def.color;
    roundRect(-r * 1.55, -r * 0.62, r * 1.65, r * 1.24, r * 0.3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    roundRect(-r * 1.5, -r * 0.58, r * 1.55, r * 0.35, r * 0.2);
    ctx.fill();
    // 座席とハンドル
    ctx.fillStyle = '#2b2b2b';
    roundRect(-r * 1.25, -r * 0.4, r * 0.55, r * 0.8, r * 0.15);
    ctx.fill();
    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(-r * 0.35, 0, r * 0.25, 0, Math.PI * 2);
    ctx.stroke();
    // 運転手の帽子
    ctx.fillStyle = '#f8f0d8';
    ctx.beginPath();
    ctx.arc(-r * 0.95, 0, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFloaters() {
  for (const f of floaters) {
    const k = f.t / f.life;
    const pop = Math.min(1, f.t / 0.15);
    const scale = 0.6 + 0.4 * (1 - (1 - pop) ** 3) + (f.t < 0.2 ? 0.15 * Math.sin((f.t / 0.2) * Math.PI) : 0);
    ctx.save();
    ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    ctx.translate(f.x, f.y - k * (f.big ? 10 : 24));
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const size = f.big ? 40 : f.small ? 15 : 24;
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.lineWidth = f.big ? 8 : 5;
    ctx.strokeStyle = 'rgba(20,50,15,0.85)';
    ctx.strokeText(f.text, 0, 0);
    ctx.fillStyle = f.big ? '#ffffff' : '#ffe066';
    ctx.fillText(f.text, 0, 0);
    if (f.sub) {
      ctx.font = `700 ${Math.round(size * 0.5)}px ${FONT}`;
      ctx.lineWidth = 4;
      ctx.strokeText(f.sub, 0, size * 0.8);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(f.sub, 0, size * 0.8);
    }
    ctx.restore();
  }
}

function drawClearBanner() {
  const t = clearT;
  const pop = clamp(t / 0.35, 0, 1);
  const scale = 0.5 + 0.5 * (1 - (1 - pop) ** 3) + 0.15 * Math.sin(Math.min(1, t / 0.5) * Math.PI);
  ctx.save();
  ctx.translate(W / 2, HUD + FH / 2);
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.font = `700 54px ${FONT}`;
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(20,50,15,0.9)';
  ctx.strokeText('刈りきった！', 0, 0);
  ctx.fillStyle = '#ffe066';
  ctx.fillText('刈りきった！', 0, 0);
  ctx.restore();
}

function drawHud() {
  ctx.fillStyle = T.panel;
  ctx.fillRect(0, 0, W, HUD);
  ctx.fillStyle = T.border;
  ctx.fillRect(0, HUD - 2, W, 2);
  if (!stage) return;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = T.accent;
  ctx.font = `700 18px ${FONT}`;
  ctx.fillText(String(stageIndex + 1), 14, HUD / 2);
  ctx.fillStyle = T.fg;
  ctx.font = `700 15px ${FONT}`;
  ctx.fillText(stage.name, 32, HUD / 2);

  // 進捗バー（全体）＋区画数
  const bx = 120, bw = 290, by = 13, bh = 14;
  ctx.fillStyle = T.bgDeep;
  roundRect(bx, by, bw, bh, 7);
  ctx.fill();
  const pct = shownPct;
  ctx.fillStyle = '#8fd14f';
  if (pct > 0.005) {
    roundRect(bx, by, Math.max(bh, bw * pct), bh, 7);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    roundRect(bx + 3, by + 2, Math.max(0, bw * pct - 6), 4, 2);
    ctx.fill();
  }
  // 区画の完了状況（金色の点）
  ctx.font = `700 13px ${FONT}`;
  ctx.fillStyle = T.fg;
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.floor(pct * 100)}%`, bx + bw + 44, HUD / 2);
  ctx.textAlign = 'left';
  const dotX = bx + bw + 56;
  for (let i = 0; i < zones.length; i++) {
    ctx.fillStyle = zones[i].done ? T.gold : T.border;
    ctx.beginPath();
    ctx.arc(dotX + (i % 6) * 9, HUD / 2 + (zones.length > 6 ? (i < 6 ? -5 : 5) : 0), 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = T.muted;
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText(fmtTime(time), W - 14, HUD / 2);
  if (combo.level > 0 && state === 'play') {
    ctx.fillStyle = T.accent;
    ctx.font = `700 12px ${FONT}`;
    ctx.fillText(`Lv${combo.level}`, W - 58, HUD / 2);
  }
}

function drawPause() {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, HUD, W, FH);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.font = `700 32px ${FONT}`;
  ctx.fillText('一時停止中', W / 2, HUD + FH / 2 - 12);
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText('タップ / P / スペースで再開', W / 2, HUD + FH / 2 + 24);
}

// ---------------------------------------------------------------- 美しさ（縞のそろい具合）
function stripeBeauty() {
  let same = 0, pairs = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const k = r * COLS + c;
      if (!cut[k]) continue;
      if (c + 1 < COLS && cut[k + 1]) { pairs++; if (cut[k + 1] === cut[k]) same++; }
      if (r + 1 < ROWS && cut[k + COLS]) { pairs++; if (cut[k + COLS] === cut[k]) same++; }
    }
  return pairs ? Math.round((same / pairs) * 100) : 0;
}
const beautyRank = (b) => (b >= 85 ? 'プロの仕上がり' : b >= 75 ? 'きれいなしましま' : b >= 62 ? 'いい感じ' : 'ワイルド仕上げ');

// ---------------------------------------------------------------- 画面（DOM オーバーレイ）
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
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
const recKey = (i) => `${GAME_ID}:stage${i + 1}`;

function showTitle() {
  state = 'title';
  const unlocked = load(`${GAME_ID}:unlocked`, 1);
  const card = el('div', 'card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'ステージを選ぶ');
  card.append(el('h2', '', 'しましま草刈り'));
  card.append(el('p', 'lead', '伸び放題の庭を刈って、しましまの芝生にしよう。時間制限はなし。'));
  const ul = el('ul', 'stages');
  let focus = null;
  STAGES.forEach((st, i) => {
    const li = el('li');
    const b = el('button', 'stage-btn');
    b.type = 'button';
    const rec = load(recKey(i), null);
    const lockedStage = i >= unlocked;
    b.disabled = lockedStage;
    b.append(el('span', 'num', String(i + 1)));
    const nm = el('span', 'name', st.name);
    nm.append(el('small', '', lockedStage ? '前のステージをクリアで解放' : `${MOWERS[st.mower].name}・${st.sub}`));
    b.append(nm);
    const r = el('span', rec ? 'rec clear' : 'rec', rec ? `ベスト ${fmtTime(rec.time)}\nしま ${rec.beauty}%` : lockedStage ? '🔒' : '');
    r.style.whiteSpace = 'pre';
    b.append(r);
    b.addEventListener('click', () => startStage(i));
    li.append(b);
    ul.append(li);
    if (!lockedStage) focus = b;
  });
  card.append(ul);
  showOverlay(card, focus);
}

function showResult() {
  state = 'result';
  const beauty = stripeBeauty();
  const key = recKey(stageIndex);
  const prev = load(key, null);
  const rec = {
    time: prev ? Math.min(prev.time, time) : time,
    beauty: prev ? Math.max(prev.beauty, beauty) : beauty,
    combo: prev ? Math.max(prev.combo || 0, combo.best) : combo.best,
  };
  save(key, rec);
  const unlocked = load(`${GAME_ID}:unlocked`, 1);
  if (stageIndex + 2 > unlocked) save(`${GAME_ID}:unlocked`, Math.min(STAGES.length, stageIndex + 2));
  const last = stageIndex === STAGES.length - 1;

  const card = el('div', 'card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'ステージ結果');
  card.append(el('h2', '', last ? `${stage.name} 完了！ 全ステージ制覇！` : `${stage.name} 完了！`));
  card.append(el('p', 'lead', beautyRank(beauty)));

  // ビフォー／アフター
  const ba = el('div', 'ba');
  const mk = (src, label) => {
    const fig = el('figure');
    const cv = document.createElement('canvas');
    cv.width = FW / 2;
    cv.height = FH / 2;
    cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', label);
    fig.append(cv, el('figcaption', '', label));
    return fig;
  };
  ba.append(mk(beforeImg, 'ビフォー'), mk(G, 'アフター'));
  card.append(ba);

  const dl = el('dl', 'stats');
  const row = (label, value, isNew) => {
    dl.append(el('dt', '', label));
    const dd = el('dd', '', value);
    if (isNew) dd.append(el('span', 'new', '自己ベスト！'));
    dl.append(dd);
  };
  row('タイム', fmtTime(time), !prev || time < prev.time);
  row('しま模様のきれいさ', `${beauty}%`, !prev || beauty > prev.beauty);
  row('最大コンボ', `${combo.best} マス`, !prev || combo.best > (prev.combo || 0));
  card.append(dl);

  if (!last) {
    const next = MOWERS[STAGES[stageIndex + 1].mower];
    const ratio = (next.r / mowerDef.r).toFixed(1);
    card.append(el('p', 'upgrade', `パワーアップ！ 次は「${next.name}」。刈り幅 ${ratio} 倍で、もっと広い場所へ。`));
  } else {
    card.append(el('p', 'upgrade', 'お疲れさまでした！ しまの「きれいさ」やタイムの自己ベストにも挑戦できます。'));
  }

  const actions = el('div', 'actions');
  const again = el('button', 'btn btn-ghost', 'もう一度');
  again.type = 'button';
  again.addEventListener('click', () => startStage(stageIndex));
  const menu = el('button', 'btn btn-ghost', 'ステージ選択');
  menu.type = 'button';
  menu.addEventListener('click', showTitle);
  actions.append(menu, again);
  let primary = null;
  if (!last) {
    primary = el('button', 'btn btn-primary', '次のステージへ');
    primary.type = 'button';
    primary.addEventListener('click', () => startStage(stageIndex + 1));
    actions.append(primary);
  }
  card.append(actions);
  showOverlay(card, primary || again);
  announce(`${stage.name} 完了。タイム ${fmtTime(time)}、しま模様のきれいさ ${beauty}パーセント`);
}

// ---------------------------------------------------------------- 開始
buildStage(0);
mower.x = 20 * CELL;
mower.y = 44 * CELL;
startLoop({ update, render });
if (document.fonts?.ready) document.fonts.ready.then(showTitle);
else showTitle();
